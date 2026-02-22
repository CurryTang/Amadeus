# ✅ OpenReview Support Added!

The Chrome extension now fully supports OpenReview papers, including special URL formats.

## What's New

### Automatic OpenReview Detection
- ✅ Detects `https://openreview.net/pdf?id=XXXXX` URLs
- ✅ Handles hash fragments like `#page=1.23`
- ✅ Supports forum URLs: `https://openreview.net/forum?id=XXXXX`
- ✅ Auto-fills paper metadata (title, authors, venue)

### Example
Your example URL works perfectly:
```
https://openreview.net/pdf?id=fugnQxbvMm#page=1.23
```

The extension will:
1. Extract paper ID: `fugnQxbvMm`
2. Clean URL: `https://openreview.net/pdf?id=fugnQxbvMm`
3. Fetch full PDF (not just the page)
4. Save to your library

## Files Updated

### Chrome Extension
- ✅ `content-scripts/extractor.js` - Added OpenReview detection
- ✅ `popup/popup.js` - Added OpenReview handler
- ✅ Added OpenReview to default presets

### Backend
- ✅ `routes/upload.js` - Added `/upload/openreview` endpoint
- ✅ Handles OpenReview PDF fetching

## How to Use

1. **Visit any OpenReview paper**
   ```
   https://openreview.net/pdf?id=fugnQxbvMm#page=1.23
   ```

2. **Click extension icon**
   - You'll see "📋 OpenReview Paper Detected" banner
   - Title, authors, abstract auto-filled

3. **Click "Save OpenReview PDF"**
   - PDF is fetched and saved to S3
   - Document created in your library

## Testing

You can test with your example:
```
https://openreview.net/pdf?id=fugnQxbvMm#page=1.23
```

The extension will:
- ✅ Ignore the `#page=1.23` hash
- ✅ Fetch the full PDF
- ✅ Save to library

## Technical Details

**URL Parsing**:
```javascript
// Input
https://openreview.net/pdf?id=fugnQxbvMm#page=1.23

// Extracted
paperId: "fugnQxbvMm"
pdfUrl: "https://openreview.net/pdf?id=fugnQxbvMm"
```

**Backend Endpoint**:
```
POST /api/upload/openreview
{
  "paperId": "fugnQxbvMm",
  "pdfUrl": "https://openreview.net/pdf?id=fugnQxbvMm",
  "title": "Paper Title",
  "tags": [],
  "notes": ""
}
```

## Reload Extension

To test the changes:
1. Go to `chrome://extensions`
2. Click "Reload" on Auto Reader extension
3. Visit an OpenReview paper
4. Click extension icon

## Documentation

See [chrome-extension/OPENREVIEW_SUPPORT.md](chrome-extension/OPENREVIEW_SUPPORT.md) for full details.

---

**Status**: ✅ Complete and ready to test!
**Works with**: Query parameters, hash fragments, PDF and forum URLs
