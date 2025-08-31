#!/usr/bin/env python3
"""
Manual R2 cleanup script to remove leftover files from failed deletions
"""
import asyncio
import os
from aiobotocore.session import get_session

async def cleanup_r2():
    """Clean up R2 bucket manually"""
    
    # R2 Configuration
    endpoint_url = os.getenv('R2_ENDPOINT_URL', 'https://your-account-id.r2.cloudflarestorage.com')
    access_key = os.getenv('R2_ACCESS_KEY_ID')
    secret_key = os.getenv('R2_SECRET_ACCESS_KEY')
    bucket_name = os.getenv('R2_BUCKET_NAME', 'savee-scraper')
    
    if not access_key or not secret_key:
        print("❌ R2 credentials not found in environment variables")
        print("Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY")
        return
    
    session = get_session()
    
    async with session.create_client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name='auto'
    ) as client:
        
        try:
            print(f"🔍 Listing objects in bucket: {bucket_name}")
            
            # List all objects
            paginator = client.get_paginator('list_objects_v2')
            page_iterator = paginator.paginate(Bucket=bucket_name)
            
            all_objects = []
            async for page in page_iterator:
                if 'Contents' in page:
                    for obj in page['Contents']:
                        all_objects.append(obj['Key'])
            
            if not all_objects:
                print("✅ R2 bucket is already clean!")
                return
            
            print(f"📁 Found {len(all_objects)} objects to delete:")
            
            # Group by user folders
            users = {}
            for key in all_objects:
                if key.startswith('users/'):
                    parts = key.split('/')
                    if len(parts) >= 2:
                        username = parts[1]
                        if username not in users:
                            users[username] = []
                        users[username].append(key)
                else:
                    print(f"   📄 {key}")
            
            for username, files in users.items():
                print(f"   👤 {username}: {len(files)} files")
            
            # Ask for confirmation
            print("\n⚠️  This will DELETE ALL files from R2 storage!")
            confirm = input("Type 'DELETE ALL' to confirm: ")
            
            if confirm != 'DELETE ALL':
                print("❌ Operation cancelled")
                return
            
            # Delete in batches
            batch_size = 1000
            deleted_count = 0
            
            for i in range(0, len(all_objects), batch_size):
                batch = all_objects[i:i + batch_size]
                
                delete_objects = {
                    'Objects': [{'Key': key} for key in batch],
                    'Quiet': True
                }
                
                try:
                    response = await client.delete_objects(
                        Bucket=bucket_name,
                        Delete=delete_objects
                    )
                    
                    batch_deleted = len(batch)
                    if 'Errors' in response and response['Errors']:
                        batch_deleted -= len(response['Errors'])
                        for error in response['Errors']:
                            print(f"❌ Error deleting {error['Key']}: {error['Message']}")
                    
                    deleted_count += batch_deleted
                    print(f"🗑️  Deleted batch: {batch_deleted}/{len(batch)} files (Total: {deleted_count}/{len(all_objects)})")
                    
                except Exception as e:
                    print(f"❌ Error deleting batch: {e}")
            
            print(f"\n✅ Cleanup complete! Deleted {deleted_count} files from R2")
            
        except Exception as e:
            print(f"❌ Error accessing R2: {e}")
            print("Make sure your R2 credentials and endpoint are correct")

if __name__ == "__main__":
    asyncio.run(cleanup_r2())

