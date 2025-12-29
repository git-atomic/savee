# Bulk Scraping URL Format Guide

## ✅ Supported Formats

The bulk scraper accepts URLs in **any** of these formats:

### 1. **Newline-separated** (Recommended)
```
https://savee.it/i/abc123
https://savee.it/i/def456
https://savee.it/i/xyz789
```

### 2. **Comma-separated**
```
https://savee.it/i/abc123, https://savee.it/i/def456, https://savee.it/i/xyz789
```

### 3. **Mixed (commas + newlines)**
```
https://savee.it/i/abc123,
https://savee.it/i/def456,
https://savee.it/i/xyz789
```

### 4. **With extra whitespace** (auto-cleaned)
```
https://savee.it/i/abc123  
  https://savee.it/i/def456
    https://savee.it/i/xyz789  
```

## 🎯 What Gets Detected

The system looks for:
- URLs starting with `http://` or `https://`
- Containing `/i/` (item path)
- Automatic deduplication of identical URLs
- Normalization (removes trailing slashes, query params, fragments)

## 📋 Example Test URLs

Here are some real Savee.it URLs you can test with:
```
https://savee.it/i/abc123xyz
https://savee.it/i/def456uvw
https://savee.it/i/ghi789rst
```

## 🔍 Detection Logic

When you paste URLs in the Engine UI:
1. **Live counter** shows how many URLs are detected (badge appears when > 1)
2. **Auto-validates** that each URL contains `/i/`
3. **Deduplicates** identical URLs
4. **Logs** the first 3 and last 2 URLs (if > 5 total)

## 💡 Tips

- **Paste directly** from spreadsheets, text files, or browser exports
- **No need to format** – the system handles cleanup automatically
- **Check the badge** – it shows the count of valid URLs before you submit
- **Worker logs** show exactly which URLs will be scraped

## ⚠️ Important Notes

- Only **item URLs** (`/i/...`) are supported for bulk imports
- **Profile URLs** (`/username`) should be added as regular jobs (not bulk)
- **Popular/Home** pages are also single jobs, not bulk imports
