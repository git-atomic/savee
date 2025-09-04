"""
Production-grade configuration management for ScrapeSavee Worker
Uses pydantic-settings for type-safe environment variable handling
"""
import os
from typing import List, Optional, Dict, Any
from pydantic_settings import BaseSettings
from pydantic import Field, validator
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class Settings(BaseSettings):
    """Application settings with validation and type safety"""
    
    # Application
    APP_NAME: str = Field(default="ScrapeSavee Worker", description="Application name")
    VERSION: str = Field(default="1.0.0", description="Application version")
    DEBUG: bool = Field(default=False, description="Debug mode")
    LOG_LEVEL: str = Field(default="INFO", description="Logging level")
    
    # Database
    DATABASE_URL: str = Field(..., description="PostgreSQL database URL")
    DB_POOL_SIZE: int = Field(default=20, description="Database connection pool size")
    DB_MAX_OVERFLOW: int = Field(default=30, description="Database max pool overflow")
    DB_POOL_TIMEOUT: int = Field(default=30, description="Database pool timeout seconds")
    
    # Queue/RabbitMQ (optional; GitHub Actions path does not require AMQP)
    AMQP_URL: Optional[str] = Field(default=None, description="RabbitMQ connection URL (optional)")
    QUEUE_PREFETCH: int = Field(default=8, description="Queue prefetch count")
    ITEM_TTL_MS: int = Field(default=0, description="Item TTL in milliseconds (0 = no TTL)")
    
    # Storage/R2
    R2_ENDPOINT_URL: str = Field(..., description="Cloudflare R2 endpoint URL")
    R2_ACCESS_KEY_ID: str = Field(..., description="R2 access key ID")
    R2_SECRET_ACCESS_KEY: str = Field(..., description="R2 secret access key")
    R2_BUCKET_NAME: str = Field(..., description="R2 bucket name")
    R2_REGION: str = Field(default="auto", description="R2 region")

    # Payload CMS (optional; worker operates without Payload)
    PAYLOAD_API_URL: Optional[str] = Field(default=None, description="Payload CMS API URL (optional)")
    PAYLOAD_API_KEY: Optional[str] = Field(default=None, description="Payload CMS API key (optional)")
    CMS_URL: Optional[str] = Field(default=None, description="Base URL of CMS (for logs endpoint)")
    ENGINE_MONITOR_TOKEN: Optional[str] = Field(default=None, description="Bearer token for monitor/logs auth")
    
    # Scraping
    SCRAPER_USER_AGENT: str = Field(
        default="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        description="User agent for scraping"
    )
    SCRAPER_DELAY_MIN: float = Field(default=1.0, description="Minimum delay between requests (seconds)")
    SCRAPER_DELAY_MAX: float = Field(default=3.0, description="Maximum delay between requests (seconds)")
    SCRAPER_TIMEOUT: int = Field(default=30, description="Request timeout (seconds)")
    SCRAPER_MAX_RETRIES: int = Field(default=3, description="Maximum retries for failed requests")
    
    # Concurrency
    JOB_CONCURRENCY: int = Field(default=2, description="Number of concurrent job workers")
    ITEM_CONCURRENCY: int = Field(default=4, description="Number of concurrent item processors")
    
    # Scheduling
    # (See detailed intervals below)
    
    # API
    API_HOST: str = Field(default="0.0.0.0", description="API host")
    API_PORT: int = Field(default=8000, description="API port")
    CORS_ORIGINS: List[str] = Field(
        default=["*"], 
        description="CORS allowed origins"
    )
    
    # Monitoring
    ENABLE_METRICS: bool = Field(default=True, description="Enable Prometheus metrics")
    METRICS_PORT: int = Field(default=9090, description="Metrics server port")
    HEALTH_CHECK_INTERVAL: int = Field(default=30, description="Health check interval (seconds)")
    
    # Security & Authentication
    API_KEY: Optional[str] = Field(default=None, description="API key for authentication")
    ENCRYPTION_KEY: Optional[str] = Field(default=None, description="Encryption key for sensitive data")
    SECRET_KEY: str = Field(default="your-super-secret-key-change-in-production", description="JWT secret key")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30, description="Access token expiration minutes")
    REFRESH_TOKEN_EXPIRE_DAYS: int = Field(default=7, description="Refresh token expiration days")
    RATE_LIMIT_PER_MINUTE: int = Field(default=60, description="Rate limit per minute per IP")
    
    # Feature flags
    ENABLE_MEDIA_DOWNLOAD: bool = Field(default=True, description="Enable media file downloads")
    ENABLE_DUPLICATE_DETECTION: bool = Field(default=True, description="Enable duplicate detection")
    ENABLE_RATE_LIMITING: bool = Field(default=True, description="Enable rate limiting")
    
    # Scheduler intervals (seconds)
    TAIL_SWEEP_INTERVAL: int = Field(default=60, description="Tail sweep interval in seconds")
    BACKFILL_SWEEP_INTERVAL: int = Field(default=3600, description="Backfill sweep interval in seconds")
    CLEANUP_INTERVAL: int = Field(default=1800, description="Cleanup interval in seconds")
    
    # Savee cookies/auth (optional)
    SAVE_EMAIL: Optional[str] = Field(default=None, description="Savee.com email for auth")
    SAVE_PASSWORD: Optional[str] = Field(default=None, description="Savee.com password for auth")
    COOKIES_JSON: Optional[str] = Field(default=None, description="Cookies as JSON string")
    COOKIES_PATH: Optional[str] = Field(default=None, description="Path to cookies file")
    STORAGE_STATE_PATH: Optional[str] = Field(default=None, description="Path to Playwright storage state")
    
    @validator('DATABASE_URL')
    def validate_database_url(cls, v):
        """Validate database URL format and convert to async"""
        if not v.startswith(('postgresql://', 'postgresql+asyncpg://', 'postgresql+psycopg://', 'postgres://')):
            raise ValueError('DATABASE_URL must be a valid PostgreSQL URL')
        # Convert to async driver
        if v.startswith('postgresql://') and '+async' not in v:
            return v.replace('postgresql://', 'postgresql+asyncpg://')
        elif v.startswith('postgres://'):
            return v.replace('postgres://', 'postgresql+asyncpg://')
        return v
    
    @validator('AMQP_URL')
    def validate_amqp_url(cls, v):
        """Validate AMQP URL format if provided"""
        if v is None or v == "":
            return None
        if not v.startswith(('amqp://', 'amqps://')):
            raise ValueError('AMQP_URL must be a valid AMQP URL')
        return v
    
    @validator('R2_ENDPOINT_URL')
    def validate_r2_endpoint(cls, v):
        """Validate R2 endpoint URL format"""
        if not v.startswith(('http://', 'https://')):
            raise ValueError('R2_ENDPOINT_URL must be a valid HTTP(S) URL')
        return v
    
    @validator('LOG_LEVEL')
    def validate_log_level(cls, v):
        """Validate log level"""
        valid_levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
        if v.upper() not in valid_levels:
            raise ValueError(f'LOG_LEVEL must be one of: {valid_levels}')
        return v.upper()
    
    @validator('SCRAPER_DELAY_MIN', 'SCRAPER_DELAY_MAX')
    def validate_delays(cls, v):
        """Validate scraper delays are positive"""
        if v < 0:
            raise ValueError('Scraper delays must be positive')
        return v
    
    @validator('SCRAPER_DELAY_MAX')
    def validate_delay_max_greater_than_min(cls, v, values):
        """Validate max delay is greater than min delay"""
        if 'SCRAPER_DELAY_MIN' in values and v < values['SCRAPER_DELAY_MIN']:
            raise ValueError('SCRAPER_DELAY_MAX must be greater than SCRAPER_DELAY_MIN')
        return v
    
    @property
    def async_database_url(self) -> str:
        """Get async database URL for SQLAlchemy"""
        url = self.DATABASE_URL
        # Normalize driver to asyncpg
        if url.startswith('postgresql+psycopg://'):
            url = url.replace('postgresql+psycopg://', 'postgresql+asyncpg://', 1)
        elif url.startswith('postgresql://'):
            url = url.replace('postgresql://', 'postgresql+asyncpg://', 1)

        # Convert/remove sslmode and normalize to asyncpg-compatible 'ssl=true|false'
        try:
            from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
            sp = urlsplit(url)
            # Lowercase keys to handle case-insensitive params
            raw_pairs = parse_qsl(sp.query, keep_blank_values=True)
            qp = { (k or '').lower(): (v or '') for k, v in raw_pairs }

            ssl_from_mode: str | None = None
            if 'sslmode' in qp:
                mode = (qp.pop('sslmode') or '').strip().lower()
                if mode in {'disable'}:
                    ssl_from_mode = 'false'
                elif mode in {'allow', 'prefer', 'require', 'verify-ca', 'verify-full'}:
                    ssl_from_mode = 'true'
                else:
                    # Unknown/invalid sslmode → default to secure true
                    ssl_from_mode = 'true'

            # Respect explicit ssl= if present, otherwise apply from sslmode mapping
            if 'ssl' in qp:
                v = (qp['ssl'] or '').strip().lower()
                if v in {'1', 'true', 'yes', 'on', 'require'}:
                    qp['ssl'] = 'true'
                elif v in {'0', 'false', 'no', 'off', 'disable'}:
                    qp['ssl'] = 'false'
                else:
                    # Default to secure
                    qp['ssl'] = 'true'
            elif ssl_from_mode is not None:
                qp['ssl'] = ssl_from_mode

            new_query = urlencode(qp)
            url = urlunsplit((sp.scheme, sp.netloc, sp.path, new_query, sp.fragment))
        except Exception:
            # If anything fails, fall back to the normalized URL
            pass

        return url

    @property
    def asyncpg_connect_args(self) -> Dict[str, Any]:
        """Connection args for asyncpg (e.g., force ssl on/off)."""
        try:
            from urllib.parse import urlsplit, parse_qsl
            sp = urlsplit(self.async_database_url)
            qp = { (k or '').lower(): (v or '') for k, v in parse_qsl(sp.query, keep_blank_values=True) }
            ssl_val = (qp.get('ssl') or '').strip().lower()
            if ssl_val in {'1', 'true', 'yes', 'on', 'require'}:
                return { 'ssl': True }
            if ssl_val in {'0', 'false', 'no', 'off', 'disable'}:
                return { 'ssl': False }
        except Exception:
            pass
        # Default to secure connection
        return { 'ssl': True }
    
    @property
    def sync_database_url(self) -> str:
        """Get sync database URL for Alembic"""
        url = self.DATABASE_URL
        if url.startswith('postgresql+asyncpg://'):
            return url.replace('postgresql+asyncpg://', 'postgresql+psycopg://', 1)
        elif url.startswith('postgresql://'):
            return url.replace('postgresql://', 'postgresql+psycopg://', 1)
        return url
    
    def get_scraper_config(self) -> Dict[str, Any]:
        """Get scraper configuration as dict"""
        return {
            "user_agent": self.SCRAPER_USER_AGENT,
            "delay_min": self.SCRAPER_DELAY_MIN,
            "delay_max": self.SCRAPER_DELAY_MAX,
            "timeout": self.SCRAPER_TIMEOUT,
            "max_retries": self.SCRAPER_MAX_RETRIES,
        }
    
    def get_r2_config(self) -> Dict[str, Any]:
        """Get R2 configuration as dict"""
        return {
            "endpoint_url": self.R2_ENDPOINT_URL,
            "access_key_id": self.R2_ACCESS_KEY_ID,
            "secret_access_key": self.R2_SECRET_ACCESS_KEY,
            "bucket_name": self.R2_BUCKET_NAME,
            "region": self.R2_REGION,
        }

    # Lowercase aliases for commonly-referenced settings
    @property
    def secret_key(self) -> str:
        return self.SECRET_KEY

    @property
    def amqp_url(self) -> Optional[str]:
        return self.AMQP_URL

    @property
    def r2_endpoint_url(self) -> str:
        return self.R2_ENDPOINT_URL

    @property
    def r2_access_key_id(self) -> str:
        return self.R2_ACCESS_KEY_ID

    @property
    def r2_secret_access_key(self) -> str:
        return self.R2_SECRET_ACCESS_KEY

    @property
    def r2_bucket_name(self) -> str:
        return self.R2_BUCKET_NAME

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"  # Allow extra env vars without validation errors


# Global settings instance
settings = Settings()


def get_settings() -> Settings:
    """Get application settings (dependency injection compatible)"""
    return settings
