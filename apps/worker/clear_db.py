#!/usr/bin/env python3
"""
Clear database for testing
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from app.config import settings

async def clear_db():
    engine = create_async_engine(settings.DATABASE_URL)
    Session = async_sessionmaker(engine)
    
    async with Session() as session:
        # Get counts first  
        result = await session.execute(text('SELECT COUNT(*) FROM blocks'))
        blocks_count = result.scalar()
        
        result = await session.execute(text('SELECT COUNT(*) FROM sources')) 
        sources_count = result.scalar()
        
        result = await session.execute(text('SELECT COUNT(*) FROM runs'))
        runs_count = result.scalar()
        
        print(f'Current data: {blocks_count} blocks, {sources_count} sources, {runs_count} runs')
        
        if blocks_count > 0 or sources_count > 0 or runs_count > 0:
            # Clear all data (order matters due to foreign keys)
            await session.execute(text('DELETE FROM blocks'))
            await session.execute(text('DELETE FROM runs')) 
            await session.execute(text('DELETE FROM sources'))
            await session.commit()
            
            print('Database cleared!')
        else:
            print('Database is already empty!')
    
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(clear_db())
