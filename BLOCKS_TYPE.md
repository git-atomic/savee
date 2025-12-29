# Blocks Type - Bulk Scraping System

## Overview
The **"blocks"** type is specifically designed for bulk scraping of individual item URLs. When you paste multiple item URLs (`/i/...`), the system automatically:
1. Detects it's a bulk import
2. Assigns type **"blocks"**
3. Scrapes each URL individually

---

## Complete Flow

### 1️⃣ **User Input** (Engine UI)
```
Paste in textarea:
https://savee.it/i/abc123
https://savee.it/i/def456
https://savee.it/i/xyz789
```

### 2️⃣ **Auto-Detection** (Frontend)
- **Badge shows**: "3 URLs detected"
- **Type auto-sets to**: `blocks`
- **User sees**: Dropdown changes from "User" → "Blocks"

### 3️⃣ **Job Creation** (API)
```typescript
POST /api/engine/run
{
  "url": "https://savee.it/i/abc,https://savee.it/i/def,https://savee.it/i/xyz",
  "sourceType": "blocks",
  "maxItems": 0
}
```

### 4️⃣ **URL Normalization** (Worker CLI)
```python
# Input is normalized and deduplicated
bulk_urls = [
  "https://savee.it/i/abc123",
  "https://savee.it/i/def456", 
  "https://savee.it/i/xyz789"
]

# Source mapped to:
url = "https://savee.com/bulk_import_1735039784"
source_type = SourceTypeEnum.blocks
```

### 5️⃣ **Database Record** (Sources table)
```sql
INSERT INTO sources (url, source_type, status)
VALUES (
  'https://savee.com/bulk_import_1735039784',
  'blocks',  -- ✓ New enum value
  'active'
);
```

### 6️⃣ **Scraping** (Iterator)
```python
# Worker uses bulk iterator
item_iterator = scraper.scrape_bulk_iterator(bulk_urls)

# Scrapes each URL individually
for item in item_iterator:
    # Process item
    # Upload to R2
    # Save to DB
```

### 7️⃣ **Storage** (R2)
```
R2 Bucket Structure:
├── blocks/
│   ├── abc123  (from bulk import)
│   ├── def456  (from bulk import)
│   └── xyz789  (from bulk import)
├── users/
│   └── john/blocks/...
├── home/blocks/...
└── pop/blocks/...
```

---

## Source Types Comparison

| Type | URL Pattern | Iterator | R2 Path | Use Case |
|------|-------------|----------|---------|----------|
| **home** | `savee.it` | `scrape_home_iterator()` | `home/blocks/{id}` | Homepage feed |
| **pop** | `savee.it/pop` | `scrape_pop_iterator()` | `pop/blocks/{id}` | Popular/trending |
| **user** | `savee.it/username` | `scrape_user_iterator()` | `users/{username}/blocks/{id}` | User profiles |
| **blocks** | Multiple `/i/` URLs | `scrape_bulk_iterator()` | `blocks/{id}` | **Bulk imports** |

---

## Key Features

### ✅ Automatic Detection
- **Multiple URLs with `/i/`** → Type: `blocks`
- **Live badge** shows count
- **No manual selection needed**

### ✅ Deduplication
```python
# Input (with duplicates):
https://savee.it/i/abc123
https://savee.it/i/abc123  # duplicate
https://savee.it/i/def456

# Output (deduplicated):
["https://savee.it/i/abc123", "https://savee.it/i/def456"]
```

### ✅ URL Normalization
```python
# All these become the same:
https://savee.it/i/abc123/
https://savee.it/i/abc123?ref=twitter
https://savee.it/i/abc123#comment

# Normalized to:
https://savee.it/i/abc123
```

### ✅ Isolated Storage
- Bulk imports stored in dedicated `blocks/` folder
- No mixing with user/home/pop content
- Easy to identify and manage

---

## Testing

### Test Input (Paste into Engine UI):
```
https://savee.it/i/abc123xyz
https://savee.it/i/def456uvw  
https://savee.it/i/ghi789rst
```

### Expected Behavior:
1. **UI**: Badge shows "3 URLs detected"
2. **Type**: Auto-sets to "Blocks"
3. **Worker Log**:
   ```
   ✓ Detected bulk import: 3 unique item URLs
     Mapped to source: https://savee.com/bulk_import_1735039784
     URLs: https://savee.it/i/abc123xyz, https://savee.it/i/def456uvw, https://savee.it/i/ghi789rst
   ```
4. **Database**: Source created with `source_type = 'blocks'`
5. **R2**: Files uploaded to `blocks/abc123xyz`, `blocks/def456uvw`, `blocks/ghi789rst`

---

## Summary

**blocks** = Bulk import of individual item URLs

- ✅ Dedicated type for bulk scraping
- ✅ Auto-detected from multiple `/i/` URLs
- ✅ Uses `scrape_bulk_iterator()` for efficient processing
- ✅ Stores in isolated `blocks/` R2 folder
- ✅ Fully integrated across UI, API, worker, and database
