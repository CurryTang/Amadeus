# Auto Reader Chrome Extension

A Chrome extension to save papers, books, and blogs to your research library.

## Features

- **Save Link**: Save webpage URL and metadata without downloading
- **Save as PDF**: Convert any webpage to PDF and store in S3
- **Upload File**: Upload local PDF, EPUB, TXT, or HTML files
- **Auto-detect**: Automatically detects content type (paper, blog, book)
- **Metadata Extraction**: Extracts title, description, author from web pages

## Installation (Development)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder

## Usage

1. Click the Auto Reader icon in Chrome toolbar
2. The extension auto-fills title and URL from the current page
3. Select document type and add tags/notes
4. Click:
   - **Save Link** - saves metadata only
   - **Save as PDF** - converts page to PDF and uploads
   - **Upload File** - upload a local file

## Configuration

The extension connects to `http://localhost:3000/api` by default.

To change the API endpoint, edit `popup/popup.js` and `background/service-worker.js`:

```javascript
const API_BASE_URL = 'https://your-api-domain.com/api';
```

## Project Structure

```
chrome-extension/
├── manifest.json           # Extension configuration
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.css          # Styles
│   └── popup.js           # Popup logic
├── background/
│   └── service-worker.js  # Background service worker
├── content-scripts/
│   └── extractor.js       # Page metadata extractor
└── assets/
    ├── icon16.png         # 16x16 icon
    ├── icon48.png         # 48x48 icon
    └── icon128.png        # 128x128 icon
```

## Requirements

- Chrome browser (version 88+)
- Backend server running at configured API endpoint
