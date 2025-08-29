
"""
Payload bridge is disabled in favor of direct DB upsert into core.blocks.
Left as a stub in case future CMS endpoints are needed.
"""

class PayloadClient:
    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url
        self.api_key = api_key

    async def close(self):
        return
