#!/usr/bin/env python
"""
Create savee_users table for tracking Savee.com user profiles
"""
import asyncio
import sys
from pathlib import Path

# Add the app directory to Python path
sys.path.append(str(Path(__file__).parent / "app"))

from app.models import Base, SaveeUser
from app.database.session import get_engine


async def create_tables():
    """Create the savee_users table"""
    print("INFO: Creating savee_users table...")
    
    try:
        # Get database engine
        engine = get_engine()
        
        # Create tables
        async with engine.begin() as conn:
            # Only create the SaveeUser table
            await conn.run_sync(SaveeUser.__table__.create, checkfirst=True)
            
        print("SUCCESS: savee_users table created successfully!")
        
    except Exception as e:
        print(f"ERROR: Failed to create table: {e}")
        return False
    
    return True


if __name__ == "__main__":
    success = asyncio.run(create_tables())
    if not success:
        sys.exit(1)
    print("INFO: Database setup complete!")


