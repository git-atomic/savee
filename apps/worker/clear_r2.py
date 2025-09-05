#!/usr/bin/env python3
"""
Clear R2 storage for testing
"""
import asyncio
from app.storage.r2 import R2Storage

async def clear_r2(prefix: str | None = None):
    """Clear all objects from R2 storage.
    If prefix is provided, only delete objects under that prefix (e.g., 'users/cake' or 'users/cake/').
    """
    storage = R2Storage()
    
    try:
        # Connect to R2
        async with storage:
            print("INFO: Connected to Cloudflare R2")
            
            # If a prefix is provided, delete just that subtree
            if prefix:
                pfx = prefix.lstrip('/')
                print(f"INFO: Deleting all objects under prefix: {pfx}")
                deleted = await storage.delete_prefix(pfx)
                print(f"SUCCESS: Deleted {deleted} objects under {pfx}")
                return

            # List current objects first (full wipe)
            objects = await storage.list_objects()
            current_count = len(objects)
            print(f"INFO: Current objects in R2: {current_count}")
            
            if current_count > 0:
                # Show organized structure
                structure = {}
                for obj in objects[:10]:  # Show first 10 as sample
                    key = obj['key'] if isinstance(obj, dict) else str(obj)
                    parts = key.split('/')
                    if len(parts) >= 2:
                        category = parts[0]
                        if category not in structure:
                            structure[category] = 0
                        structure[category] += 1
                
                if structure:
                    print("INFO: Storage organization:")
                    for category, count in structure.items():
                        print(f"  {category}/: {count} items")
                
                if current_count > 10:
                    print(f"  ... and {current_count - 10} more items")
                print("INFO: Deleting all objects...")
                deleted_count = await storage.delete_all()
                print(f"SUCCESS: Deleted {deleted_count} objects from R2")
                
                # Verify deletion
                remaining_objects = await storage.list_objects()
                remaining_count = len(remaining_objects)
                print(f"INFO: Remaining objects: {remaining_count}")
                
                if remaining_count == 0:
                    print("SUCCESS: R2 storage completely cleared!")
                else:
                    print(f"WARNING: {remaining_count} objects still remain")
            else:
                print("SUCCESS: R2 storage is already empty!")
                
    except Exception as e:
        print(f"ERROR: Failed to clear R2: {e}")
        raise

if __name__ == "__main__":
    import sys
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(clear_r2(arg))
