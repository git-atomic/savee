#!/usr/bin/env python3
"""
Clear R2 storage for testing
"""
import asyncio
from app.storage.r2 import R2Storage

async def clear_r2():
    """Clear all objects from R2 storage"""
    storage = R2Storage()
    
    try:
        # Connect to R2
        async with storage:
            print("🔗 Connected to Cloudflare R2")
            
            # List current objects first
            objects = await storage.list_objects()
            current_count = len(objects)
            print(f"📋 Current objects in R2: {current_count}")
            
            if current_count > 0:
                print("🗑️  Deleting all objects...")
                deleted_count = await storage.delete_all()
                print(f"✅ Successfully deleted {deleted_count} objects from R2")
                
                # Verify deletion
                remaining_objects = await storage.list_objects()
                remaining_count = len(remaining_objects)
                print(f"📋 Remaining objects: {remaining_count}")
                
                if remaining_count == 0:
                    print("🎉 R2 storage completely cleared!")
                else:
                    print(f"⚠️  Warning: {remaining_count} objects still remain")
            else:
                print("✅ R2 storage is already empty!")
                
    except Exception as e:
        print(f"❌ Failed to clear R2: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(clear_r2())
