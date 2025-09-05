#!/usr/bin/env python3
"""
Clear database for testing
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from app.config import settings

async def clear_db():
    engine = create_async_engine(settings.async_database_url, connect_args=settings.asyncpg_connect_args)
    Session = async_sessionmaker(engine)
    
    async with Session() as session:
        # Get counts first  
        result = await session.execute(text('SELECT COUNT(*) FROM blocks'))
        blocks_count = result.scalar()
        
        result = await session.execute(text('SELECT COUNT(*) FROM sources')) 
        sources_count = result.scalar()
        
        result = await session.execute(text('SELECT COUNT(*) FROM runs'))
        runs_count = result.scalar()
        
        result = await session.execute(text('SELECT COUNT(*) FROM savee_users'))
        users_count = result.scalar()
        print(f'Current data: {blocks_count} blocks, {sources_count} sources, {runs_count} runs, {users_count} users')
        
        if blocks_count > 0 or sources_count > 0 or runs_count > 0 or users_count > 0:
            # Clear all data (order matters due to foreign keys)
            # user_blocks first (if present)
            try:
                await session.execute(text('DELETE FROM user_blocks'))
            except Exception:
                pass
            await session.execute(text('DELETE FROM blocks'))
            await session.execute(text('DELETE FROM runs')) 
            await session.execute(text('DELETE FROM sources'))
            # logs table (if exists)
            try:
                await session.execute(text('DELETE FROM job_logs'))
            except Exception:
                pass
            await session.execute(text('DELETE FROM savee_users'))
            await session.commit()
            
            print('Database cleared!')
        else:
            print('Database is already empty!')
    
    await engine.dispose()

async def delete_user_by_username(username: str):
    engine = create_async_engine(settings.async_database_url, connect_args=settings.asyncpg_connect_args)
    Session = async_sessionmaker(engine)
    async with Session() as session:
        try:
            await session.execute(text('BEGIN'))
            # Remove relationships
            await session.execute(text('DELETE FROM user_blocks WHERE user_id = (SELECT id FROM savee_users WHERE username = :u)'), {"u": username})
            # Delete user
            await session.execute(text('DELETE FROM savee_users WHERE username = :u'), {"u": username})
            await session.commit()
            print(f"Deleted data for user '{username}'")
        except Exception as e:
            await session.rollback()
            raise
    await engine.dispose()

if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == 'delete-user':
        asyncio.run(delete_user_by_username(sys.argv[2]))
    else:
        asyncio.run(clear_db())
