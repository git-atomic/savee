#!/usr/bin/env python
"""
Create missing database tables
"""
import asyncio
import sys
from pathlib import Path

# Add the app directory to Python path
sys.path.append(str(Path(__file__).parent / "app"))

from app.models import Base, SaveeUser
from app.database.session import get_engine


async def create_tables():
    """Create missing tables"""
    print("INFO: Creating missing database tables...")
    
    try:
        # Get database engine
        engine = get_engine()
        
        # Create all tables (will only create missing ones)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all, checkfirst=True)
            
        print("SUCCESS: All tables created successfully!")
        
    except Exception as e:
        print(f"ERROR: Failed to create tables: {e}")
        return False
    
    return True


if __name__ == "__main__":
    success = asyncio.run(create_tables())
    if not success:
        sys.exit(1)
    print("INFO: Database schema updated!")


