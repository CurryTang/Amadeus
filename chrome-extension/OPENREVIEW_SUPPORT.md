# OpenReview Support

The Chrome extension now supports automatic detection and saving of OpenReview papers!

## Supported URLs

The extension automatically detects:

1. **PDF URLs**:
   ```
   https://openreview.net/pdf?id=fugnQxbvMm
   https://openreview.net/pdf?id=fugnQxbvMm#page=1.23
   ```

2. **Forum/Paper URLs**:
   ```
   https://openreview.net/forum?id=fugnQxbvMm
   ```

## How It Works

### 1. Automatic Detection
When you visit an OpenReview page, the extension:
- ✅ Detects the paper ID from the URL
- ✅ Shows an "OpenReview Paper Detected" banner
- ✅ Auto-fills paper information (title, authors, venue)
- ✅ Provides a quick "Save OpenReview PDF" button

### 2. PDF URL Handling
The extension correctly handles:
- Query parameters (`?id=XXXXX`)
- Hash fragments (`#page=1.23`)
- Direct PDF URLs
- Forum URLs

### 3. Metadata Extraction
The extension attempts to extract:
- Paper title
- Authors
- Abstract
- Venue information (conference/workshop)

## Usage

### Option 1: Quick Save (Recommended)
1. Visit any OpenReview paper URL
2. Click the extension icon
3. Click "Save OpenReview PDF" button
4. Done! Paper is saved with auto-filled metadata

### Option 2: Manual Save
1. Visit any OpenReview paper URL
2. Click the extension icon
3. Edit title, tags, or notes if needed
4. Click "Save as PDF"

## Examples

### PDF URL with Page Fragment
```
https://openreview.net/pdf?id=fugnQxbvMm#page=1.23
```
✅ **Works!** The extension ignores the `#page=1.23` fragment and fetches the full PDF.

### Forum URL
```
https://openreview.net/forum?id=fugnQxbvMm
```
✅ **Works!** The extension extracts the paper ID and fetches the PDF.

## Backend Integration

The extension sends paper information to:
```
POST /api/upload/openreview
```

With payload:
```json
{
  "paperId": "fugnQxbvMm",
  "pdfUrl": "https://openreview.net/pdf?id=fugnQxbvMm",
  "title": "Paper Title",
  "tags": ["tag1", "tag2"],
  "notes": "Optional notes"
}
```

The backend:
1. Fetches the PDF from OpenReview with proper headers (User-Agent, Accept, Referer)
2. Uploads it to S3
3. Creates a document record
4. Saves metadata

**Important**: OpenReview requires proper HTTP headers to serve PDFs. The backend includes:
- `User-Agent`: Browser-like user agent string
- `Accept`: application/pdf
- `Referer`: The forum URL for the paper

## Preset Configuration

OpenReview is included in the default presets:

```javascript
{
  id: 'openreview',
  name: 'OpenReview',
  icon: '📋',
  color: '#3c6e71',
  type: 'paper',
  patterns: [
    'openreview.net/forum?id=*',
    'openreview.net/pdf?id=*'
  ],
  endpoint: '/upload/openreview',
  enabled: true
}
```

## Troubleshooting

### PDF Not Loading
- **Issue**: "Failed to fetch OpenReview PDF" or "Not found"
- **Solution**:
  - Check if the paper is publicly accessible
  - Verify the backend includes proper HTTP headers (User-Agent, Referer)
  - Some papers may be under review and not public yet
- **Technical Note**: OpenReview requires browser-like headers to serve PDFs. The backend now automatically includes these headers.

### Metadata Not Extracting
- **Issue**: Title or authors not auto-filled
- **Solution**: The extension may not be able to extract metadata from all pages
- **Workaround**: Manually enter the information

### Hash Fragment Issues
- **Issue**: URLs with `#page=X.XX` not working
- **Solution**: The extension automatically strips hash fragments
- **Note**: This is handled automatically, no action needed

## Technical Details

### URL Patterns
The extension uses these regex patterns:

**PDF URL**:
```javascript
/openreview\.net\/pdf\?id=([^&#]+)/i
```

**Forum URL**:
```javascript
/openreview\.net\/forum\?id=([^&#]+)/i
```

### Paper ID Extraction
From `https://openreview.net/pdf?id=fugnQxbvMm#page=1.23`:
1. Extract query parameter: `id=fugnQxbvMm`
2. Stop at `#` or `&`: `fugnQxbvMm`
3. Construct clean PDF URL: `https://openreview.net/pdf?id=fugnQxbvMm`

## Comparison with arXiv

| Feature | arXiv | OpenReview |
|---------|-------|------------|
| Auto-detection | ✅ | ✅ |
| Metadata API | ✅ | ❌ |
| PDF Fetching | ✅ | ✅ |
| Code URL Search | ✅ | ❌ |
| Query Parameters | ❌ | ✅ |
| Hash Fragments | ❌ | ✅ |

## Future Enhancements

Potential improvements:
- [ ] OpenReview API integration (if available)
- [ ] Extract review comments
- [ ] Extract decision status (accepted/rejected)
- [ ] Extract ratings/scores
- [ ] Link to related papers

## Support

For issues or questions:
1. Check console logs in the extension
2. Verify the paper is publicly accessible
3. Report issues with the specific paper ID

---

**Version**: 1.0.0
**Added**: 2026-01-27
**Supported URL Types**: PDF URLs, Forum URLs, with query parameters and hash fragments
