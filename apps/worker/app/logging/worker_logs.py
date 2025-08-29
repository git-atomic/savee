"""
Real-time worker logging system
"""
import asyncio
import json
import time
from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
import aioredis
from app.config import settings

@dataclass
class WorkerLogEntry:
    timestamp: str
    type: str  # STARTING, FETCH, SCRAPE, UPLOAD, WRITE, ERROR, COMPLETE  
    run_id: int
    item_url: str
    status: str  # ✓, ❌, ⚠
    timing: Optional[float] = None
    message: Optional[str] = None
    progress: Optional[str] = None

class WorkerLogger:
    """Real-time worker logger that stores logs for streaming to UI"""
    
    def __init__(self):
        self.redis_client: Optional[aioredis.Redis] = None
        self.fallback_storage: Dict[int, List[WorkerLogEntry]] = {}
    
    async def connect(self):
        """Connect to Redis for real-time log storage"""
        try:
            # Try to connect to Redis if available
            self.redis_client = aioredis.from_url(
                getattr(settings, 'REDIS_URL', 'redis://localhost:6379'),
                decode_responses=True
            )
            await self.redis_client.ping()
        except Exception:
            # Fall back to in-memory storage
            self.redis_client = None
    
    async def log(self, entry: WorkerLogEntry):
        """Log an entry for a specific run"""
        entry_dict = asdict(entry)
        
        if self.redis_client:
            try:
                # Store in Redis with expiry (24 hours)
                key = f"worker_logs:{entry.run_id}"
                await self.redis_client.lpush(key, json.dumps(entry_dict))
                await self.redis_client.expire(key, 86400)  # 24 hours
                
                # Also publish for real-time updates
                await self.redis_client.publish(f"logs:{entry.run_id}", json.dumps(entry_dict))
            except Exception:
                # Fall back to memory if Redis fails
                self._store_in_memory(entry)
        else:
            self._store_in_memory(entry)
    
    def _store_in_memory(self, entry: WorkerLogEntry):
        """Store log entry in memory as fallback"""
        if entry.run_id not in self.fallback_storage:
            self.fallback_storage[entry.run_id] = []
        
        self.fallback_storage[entry.run_id].append(entry)
        
        # Keep only last 1000 entries per run
        if len(self.fallback_storage[entry.run_id]) > 1000:
            self.fallback_storage[entry.run_id] = self.fallback_storage[entry.run_id][-1000:]
    
    async def get_logs(self, run_id: int, limit: int = 100) -> List[Dict]:
        """Get logs for a specific run"""
        if self.redis_client:
            try:
                key = f"worker_logs:{run_id}"
                log_strings = await self.redis_client.lrange(key, 0, limit - 1)
                return [json.loads(log_str) for log_str in log_strings]
            except Exception:
                pass
        
        # Fall back to memory
        entries = self.fallback_storage.get(run_id, [])
        return [asdict(entry) for entry in entries[-limit:]]
    
    async def clear_logs(self, run_id: int):
        """Clear logs for a specific run"""
        if self.redis_client:
            try:
                await self.redis_client.delete(f"worker_logs:{run_id}")
            except Exception:
                pass
        
        if run_id in self.fallback_storage:
            del self.fallback_storage[run_id]

# Global logger instance
_logger: Optional[WorkerLogger] = None

async def get_worker_logger() -> WorkerLogger:
    """Get or create the global worker logger"""
    global _logger
    if _logger is None:
        _logger = WorkerLogger()
        await _logger.connect()
    return _logger

# Convenience functions for logging different types of events
async def log_starting(run_id: int, url: str, message: str = ""):
    logger = await get_worker_logger()
    await logger.log(WorkerLogEntry(
        timestamp=datetime.now().isoformat(),
        type="STARTING",
        run_id=run_id,
        item_url=url,
        status="✓",
        message=message
    ))

async def log_fetch(run_id: int, item_url: str, timing: float, success: bool = True):
    logger = await get_worker_logger()
    await logger.log(WorkerLogEntry(
        timestamp=datetime.now().isoformat(),
        type="FETCH",
        run_id=run_id,
        item_url=item_url,
        status="✓" if success else "❌",
        timing=timing
    ))

async def log_scrape(run_id: int, item_url: str, timing: float, success: bool = True):
    logger = await get_worker_logger()
    await logger.log(WorkerLogEntry(
        timestamp=datetime.now().isoformat(),
        type="SCRAPE",
        run_id=run_id,
        item_url=item_url,
        status="✓" if success else "❌",
        timing=timing
    ))

async def log_upload(run_id: int, item_url: str, timing: float, success: bool = True, message: str = ""):
    logger = await get_worker_logger()
    await logger.log(WorkerLogEntry(
        timestamp=datetime.now().isoformat(),
        type="UPLOAD",
        run_id=run_id,
        item_url=item_url,
        status="✓" if success else "❌",
        timing=timing,
        message=message
    ))

async def log_write(run_id: int, item_url: str, timing: float, success: bool = True):
    logger = await get_worker_logger()
    await logger.log(WorkerLogEntry(
        timestamp=datetime.now().isoformat(),
        type="WRITE",
        run_id=run_id,
        item_url=item_url,
        status="✓" if success else "❌",
        timing=timing
    ))

async def log_error(run_id: int, item_url: str, error_message: str):
    logger = await get_worker_logger()
    await logger.log(WorkerLogEntry(
        timestamp=datetime.now().isoformat(),
        type="ERROR",
        run_id=run_id,
        item_url=item_url,
        status="❌",
        message=error_message
    ))

async def log_complete(run_id: int, item_url: str, timing: float, progress: str):
    logger = await get_worker_logger()
    await logger.log(WorkerLogEntry(
        timestamp=datetime.now().isoformat(),
        type="COMPLETE",
        run_id=run_id,
        item_url=item_url,
        status="✓",
        timing=timing,
        progress=progress
    ))
