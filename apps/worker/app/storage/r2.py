import aioboto3

class R2Client:
    def __init__(self, endpoint_url: str, access_key_id: str, secret_access_key: str, bucket_name: str):
        self.session = aioboto3.Session(
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )
        self.endpoint_url = endpoint_url
        self.bucket_name = bucket_name

    async def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str):
        async with self.session.client("s3", endpoint_url=self.endpoint_url) as s3:
            await s3.put_object(
                Bucket=Bucket,
                Key=Key,
                Body=Body,
                ContentType=ContentType,
            )

    async def close(self):
        pass
"""
Cloudflare R2 storage integration for media files
"""
import asyncio
import hashlib
import mimetypes
from datetime import datetime, timedelta
from io import BytesIO
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import aiohttp
from PIL import Image
import aioboto3
from botocore.exceptions import ClientError

from ..config import settings
from ..logging_config import setup_logging

logger = setup_logging(__name__)


class R2Storage:
    """Cloudflare R2 storage manager"""
    
    def __init__(self):
        self.session = None
        self.client = None
        
    async def __aenter__(self):
        await self.connect()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
        
    async def connect(self):
        """Connect to R2"""
        try:
            self.session = aioboto3.Session()
            self.client = await self.session.client(
                's3',
                endpoint_url=settings.r2_endpoint_url,
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
                region_name='auto'
            ).__aenter__()
            
            logger.info("Connected to Cloudflare R2")
            
        except Exception as e:
            logger.error(f"Failed to connect to R2: {e}")
            raise
            
    async def close(self):
        """Close R2 connection"""
        if self.client:
            await self.client.__aexit__(None, None, None)
            
    async def object_exists(self, key: str) -> bool:
        """Check if object exists in R2"""
        try:
            await self.client.head_object(Bucket=settings.r2_bucket_name, Key=key)
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            raise
            
    async def upload_file(self, file_data: bytes, key: str, content_type: str = None) -> str:
        """Upload file to R2"""
        if not content_type:
            content_type = mimetypes.guess_type(key)[0] or 'application/octet-stream'
            
        # Skip existence check to avoid 403 HeadObject permission errors
        # R2 will overwrite if exists, which is fine for our use case
        # if await self.object_exists(key):
        #     logger.debug(f"File already exists: {key}")
        #     return key
            
        # Retry upload with exponential backoff for transient/clock-skew issues
        max_retries = 6
        for attempt in range(max_retries):
            try:
                await self.client.put_object(
                    Bucket=settings.r2_bucket_name,
                    Key=key,
                    Body=file_data,
                    ContentType=content_type,
                    CacheControl='public, max-age=31536000',  # 1 year
                )
                
                logger.debug(f"Uploaded file: {key}")
                return key
                
            except ClientError as e:
                error_code = e.response['Error']['Code']
                if error_code == 'RequestTimeTooSkewed' and attempt < max_retries - 1:
                    # Recreate client to let botocore recalc time offset, then wait and retry
                    try:
                        logger.warning("Time skew detected; refreshing R2 client and retrying")
                        await self.close()
                        await self.connect()
                    except Exception as refresh_err:
                        logger.debug(f"Failed to refresh R2 client: {refresh_err}")
                    wait_time = min(32, 2 ** attempt)  # 1,2,4,8,16,32
                    logger.warning(f"Time skew error, retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"Failed to upload {key}: {e}")
                    raise
            except Exception as e:
                logger.error(f"Failed to upload {key}: {e}")
                raise
            
    async def download_url(self, url: str) -> bytes:
        """Download file from URL with robust headers and retries."""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        }
        # Some Savee CDN endpoints require a referer to allow fetches
        if "savee-cdn.com" in url:
            headers["Referer"] = "https://savee.com/"

        attempts = 0
        last_err: Exception | None = None
        while attempts < 3:
            attempts += 1
            try:
                async with aiohttp.ClientSession(headers=headers) as session:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                        if response.status != 200:
                            raise ValueError(f"Failed to download {url}: {response.status}")
                        return await response.read()
            except Exception as e:
                last_err = e
                await asyncio.sleep(min(4, attempts))
        raise ValueError(f"Failed to download after retries: {url} | {last_err}")
                
    async def upload_image(self, image_url: str, base_key: str) -> str:
        """Upload image with multiple sizes and thumbnails"""
        try:
            # Download original image
            image_data = await self.download_url(image_url)
            
            # Generate key based on content hash
            content_hash = hashlib.sha256(image_data).hexdigest()[:16]
            ext = self._get_file_extension(image_url)
            
            # Upload original
            original_key = f"{base_key}/original_{content_hash}{ext}"
            await self.upload_file(image_data, original_key)
            
            # Generate thumbnails
            await self._generate_thumbnails(image_data, base_key, content_hash, ext)
            
            return original_key
            
        except Exception as e:
            logger.error(f"Failed to upload image {image_url}: {e}")
            raise
            
    async def upload_video(self, video_url: str, base_key: str, poster_image_url: Optional[str] = None) -> str:
        """Upload video file and, if available, upload a poster image to R2.

        Returns the video key. The poster will be stored as
        f"{base_key}/poster_<video_content_hash>.jpg" if poster_image_url is provided.
        """
        try:
            # Download video
            video_data = await self.download_url(video_url)
            
            # Generate key based on content hash
            content_hash = hashlib.sha256(video_data).hexdigest()[:16]
            ext = self._get_file_extension(video_url)
            
            # Upload video
            video_key = f"{base_key}/video_{content_hash}{ext}"
            await self.upload_file(video_data, video_key, 'video/mp4')

            # Optionally upload poster derived from provided image url
            if poster_image_url:
                try:
                    img_bytes = await self.download_url(poster_image_url)
                    image = Image.open(BytesIO(img_bytes))
                    if image.mode in ('RGBA', 'LA', 'P'):
                        image = image.convert('RGB')

                    # Resize to a reasonable preview size
                    max_w = 600
                    if image.width > max_w:
                        ratio = max_w / float(image.width)
                        image = image.resize((max_w, int(image.height * ratio)), Image.Resampling.LANCZOS)

                    buf = BytesIO()
                    image.save(buf, format='JPEG', quality=85, optimize=True)
                    poster_key = f"{base_key}/poster_{content_hash}.jpg"
                    await self.upload_file(buf.getvalue(), poster_key, 'image/jpeg')
                except Exception as poster_err:
                    logger.debug(f"Poster upload failed (non-fatal): {poster_err}")
            
            return video_key
            
        except Exception as e:
            logger.error(f"Failed to upload video {video_url}: {e}")
            raise
            
    async def _generate_thumbnails(self, image_data: bytes, base_key: str, content_hash: str, ext: str):
        """Generate multiple thumbnail sizes"""
        sizes = [
            ('thumb', 150, 150),
            ('small', 300, 300),
            ('medium', 600, 600),
            ('large', 1200, 1200)
        ]
        
        try:
            # Open image
            image = Image.open(BytesIO(image_data))
            
            # Convert to RGB if necessary
            if image.mode in ('RGBA', 'LA', 'P'):
                image = image.convert('RGB')
                
            for size_name, width, height in sizes:
                # Create thumbnail
                thumb = image.copy()
                thumb.thumbnail((width, height), Image.Resampling.LANCZOS)
                
                # Save to bytes
                thumb_buffer = BytesIO()
                thumb.save(thumb_buffer, format='JPEG', quality=85, optimize=True)
                thumb_data = thumb_buffer.getvalue()
                
                # Upload thumbnail
                thumb_key = f"{base_key}/{size_name}_{content_hash}.jpg"
                await self.upload_file(thumb_data, thumb_key, 'image/jpeg')
        except Exception as e:
            logger.error(f"Failed to generate thumbnails: {e}")
            # Don't raise - thumbnails are optional

    async def upload_avatar(self, username: str, avatar_url: str) -> str:
        """Download and upload a user avatar to R2 under {username}/avatar/...
        Returns the original avatar key.
        """
        try:
            raw_bytes = await self.download_url(avatar_url)
            # Normalize to JPEG to ensure correct content-type and stable hashing
            try:
                img = Image.open(BytesIO(raw_bytes))
                if img.mode in ('RGBA', 'LA', 'P'):
                    img = img.convert('RGB')
                buf = BytesIO()
                img.save(buf, format='JPEG', quality=90, optimize=True)
                image_data = buf.getvalue()
            except Exception:
                # If PIL fails, fall back to raw bytes (still store as JPEG extension)
                image_data = raw_bytes

            content_hash = hashlib.sha256(image_data).hexdigest()[:16]
            # Avatars are normalized to JPEG for consistency
            base_key = f"users/{username}/avatar"
            original_key = f"{base_key}/original_{content_hash}.jpg"
            await self.upload_file(image_data, original_key, 'image/jpeg')
            # Generate avatar sizes (small set)
            try:
                image = Image.open(BytesIO(image_data))
                if image.mode in ('RGBA', 'LA', 'P'):
                    image = image.convert('RGB')
                for size_name, sz in [('small', 64), ('medium', 128), ('large', 256)]:
                    thumb = image.copy()
                    thumb.thumbnail((sz, sz), Image.Resampling.LANCZOS)
                    buf = BytesIO()
                    thumb.save(buf, format='JPEG', quality=85, optimize=True)
                    await self.upload_file(buf.getvalue(), f"{base_key}/{size_name}_{content_hash}.jpg", 'image/jpeg')
            except Exception as e:
                logger.debug(f"Avatar thumbnail generation failed: {e}")
            return original_key
        except Exception as e:
            logger.error(f"Failed to upload avatar for {username}: {e}")
            raise
            
    def _get_file_extension(self, url: str) -> str:
        """Get file extension from URL"""
        parsed = urlparse(url)
        path = parsed.path.lower()
        
        if path.endswith(('.jpg', '.jpeg')):
            return '.jpg'
        elif path.endswith('.png'):
            return '.png'
        elif path.endswith('.gif'):
            return '.gif'
        elif path.endswith('.webp'):
            return '.webp'
        elif path.endswith('.mp4'):
            return '.mp4'
        elif path.endswith('.webm'):
            return '.webm'
        else:
            return '.jpg'  # Default
            
    async def get_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Generate presigned URL for private access"""
        try:
            url = await self.client.generate_presigned_url(
                'get_object',
                Params={'Bucket': settings.r2_bucket_name, 'Key': key},
                ExpiresIn=expires_in
            )
            return url
            
        except Exception as e:
            logger.error(f"Failed to generate presigned URL for {key}: {e}")
            raise
            
    async def get_presigned_urls_batch(self, keys: List[str], expires_in: int = 3600) -> Dict[str, str]:
        """Generate multiple presigned URLs efficiently"""
        urls = {}
        
        tasks = []
        for key in keys:
            task = self.get_presigned_url(key, expires_in)
            tasks.append((key, task))
            
        results = await asyncio.gather(*[task for _, task in tasks], return_exceptions=True)
        
        for (key, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                logger.error(f"Failed to get presigned URL for {key}: {result}")
                urls[key] = None
            else:
                urls[key] = result
                
        return urls
        
    async def delete_object(self, key: str):
        """Delete object from R2"""
        try:
            await self.client.delete_object(Bucket=settings.r2_bucket_name, Key=key)
            logger.debug(f"Deleted object: {key}")
            
        except Exception as e:
            logger.error(f"Failed to delete {key}: {e}")
            raise
    
    async def delete_prefix(self, prefix: str) -> int:
        """Delete all objects under a prefix. Return count deleted."""
        deleted = 0
        try:
            continuation = None
            while True:
                kwargs = {
                    'Bucket': settings.r2_bucket_name,
                    'Prefix': prefix,
                    'MaxKeys': 1000,
                }
                if continuation:
                    kwargs['ContinuationToken'] = continuation
                resp = await self.client.list_objects_v2(**kwargs)
                contents = resp.get('Contents', [])
                if not contents:
                    break
                to_delete = [{'Key': o['Key']} for o in contents]
                await self.client.delete_objects(Bucket=settings.r2_bucket_name, Delete={'Objects': to_delete})
                deleted += len(to_delete)
                if not resp.get('IsTruncated'):
                    break
                continuation = resp.get('NextContinuationToken')
        except Exception as e:
            logger.error(f"Failed to delete prefix {prefix}: {e}")
            raise
        return deleted
    
    async def delete_all(self) -> int:
        """Delete all objects in the bucket, including all versions. Return count deleted."""
        deleted = 0
        
        try:
            # First, delete all current objects
            deleted += await self.delete_prefix("")
            
            # Then, handle versioned objects if versioning is enabled
            try:
                # List all object versions
                continuation = None
                while True:
                    kwargs = {
                        'Bucket': settings.r2_bucket_name,
                        'MaxKeys': 1000,
                    }
                    if continuation:
                        kwargs['KeyMarker'] = continuation
                    
                    resp = await self.client.list_object_versions(**kwargs)
                    
                    # Delete all versions
                    versions = resp.get('Versions', [])
                    delete_markers = resp.get('DeleteMarkers', [])
                    
                    all_versions = []
                    for version in versions:
                        all_versions.append({
                            'Key': version['Key'],
                            'VersionId': version['VersionId']
                        })
                    
                    for marker in delete_markers:
                        all_versions.append({
                            'Key': marker['Key'], 
                            'VersionId': marker['VersionId']
                        })
                    
                    if all_versions:
                        await self.client.delete_objects(
                            Bucket=settings.r2_bucket_name,
                            Delete={'Objects': all_versions}
                        )
                        deleted += len(all_versions)
                    
                    if not resp.get('IsTruncated'):
                        break
                    continuation = resp.get('NextKeyMarker')
                    
            except Exception as version_error:
                # Versioning might not be enabled, which is fine
                logger.debug(f"No versioned objects to delete: {version_error}")
                
        except Exception as e:
            logger.error(f"Failed to delete all objects: {e}")
            raise
            
        return deleted
            
    async def list_objects(self, prefix: str = '', limit: int = 1000) -> List[Dict]:
        """List objects in bucket"""
        try:
            response = await self.client.list_objects_v2(
                Bucket=settings.r2_bucket_name,
                Prefix=prefix,
                MaxKeys=limit
            )
            
            objects = []
            for obj in response.get('Contents', []):
                objects.append({
                    'key': obj['Key'],
                    'size': obj['Size'],
                    'last_modified': obj['LastModified'],
                    'etag': obj['ETag'].strip('"')
                })
                
            return objects
            
        except Exception as e:
            logger.error(f"Failed to list objects: {e}")
            raise
            
    async def get_storage_stats(self) -> Dict:
        """Get storage statistics"""
        try:
            # List all objects (this could be expensive for large buckets)
            objects = await self.list_objects(limit=10000)
            
            total_size = sum(obj['size'] for obj in objects)
            total_count = len(objects)
            
            # Count by type
            image_count = len([obj for obj in objects if obj['key'].endswith(('.jpg', '.png', '.gif', '.webp'))])
            video_count = len([obj for obj in objects if obj['key'].endswith(('.mp4', '.webm'))])
            
            return {
                'total_objects': total_count,
                'total_size_bytes': total_size,
                'total_size_gb': round(total_size / (1024 ** 3), 2),
                'image_count': image_count,
                'video_count': video_count,
                'usage_percent': min(100, (total_size / (10 * 1024 ** 3)) * 100)  # Assume 10GB limit
            }
            
        except Exception as e:
            logger.error(f"Failed to get storage stats: {e}")
            return {
                'total_objects': 0,
                'total_size_bytes': 0,
                'total_size_gb': 0,
                'image_count': 0,
                'video_count': 0,
                'usage_percent': 0
            }


# Global storage instance
_storage: Optional[R2Storage] = None


async def get_storage() -> R2Storage:
    """Get or create the global storage instance"""
    global _storage
    
    if _storage is None:
        _storage = R2Storage()
        await _storage.connect()
        
    return _storage


async def close_storage():
    """Close the global storage instance"""
    global _storage
    
    if _storage:
        await _storage.close()
        _storage = None

