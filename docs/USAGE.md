# Usage Guide

This guide covers how to use Auto Reader for managing and analyzing research papers.

## Getting Started

### Saving Papers

There are two ways to save papers:

#### 1. Chrome Extension (Recommended)

1. Install the Chrome extension (load unpacked from `extension/` folder)
2. Navigate to a paper on arXiv, OpenReview, or any PDF
3. Click the Auto Reader extension icon
4. Click "Save to Library"

The extension automatically extracts:
- Paper title
- Authors
- Abstract
- PDF file
- Source URL
- Code repository (if available)

#### 2. Direct Upload

Upload PDFs directly through the web interface or API.

## Web Interface

### Main Library View

The main view shows all your saved papers with:

- **Title** - Paper title (click to expand)
- **Status badges** - Processing status, code availability
- **Actions** - Download PDF, View Notes, Toggle Read

### Filtering Papers

Use the navigation tabs at the top:

- **All** - Show all papers
- **Unread** - Papers you haven't read yet
- **Read** - Papers marked as read

Additional filters (click 🔍):
- Search by title
- Filter by tag

### Viewing Notes

Click "View Notes" on any paper to see:

1. **Paper Notes** - AI-generated summary including:
   - Overview and 5C evaluation
   - Core problem and methodology
   - Key figures and tables (with Mermaid diagrams)
   - Mathematical framework
   - Limitations and future work

2. **Code Notes** (if available) - Analysis of the code repository:
   - Repository structure
   - Key entry points
   - How to run/reproduce

### Managing Read Status

- Click the checkmark icon to toggle read/unread status
- Unread papers appear first in the list

## Paper Processing

### Automatic Processing

Papers are automatically processed when added:

1. **Queued** - Paper is waiting to be processed
2. **Processing** - AI is analyzing the paper
3. **Completed** - Notes are ready to view
4. **Failed** - Processing failed (will retry)

Processing uses a multi-pass approach:
- Pass 1: Bird's eye scan (title, abstract, structure)
- Pass 2: Content understanding (methods, experiments)
- Pass 3: Deep analysis (math, architecture diagrams)

### Code Analysis

If a paper has associated code:

1. Click "Analyze Code" button
2. Wait for processing (clones repo, analyzes structure)
3. View code notes in the "Code Notes" tab

## Notes Features

### Mermaid Diagrams

Notes include auto-generated diagrams:
- System architecture
- Method flowcharts
- Data flow diagrams

If a diagram fails to render, click "Diagram (click to view source)" to see the raw code.

### Math Rendering

LaTeX math is rendered using KaTeX:
- Inline: `$E = mc^2$`
- Block: `$$\sum_{i=1}^n x_i$$`

### Tables

Comparison tables show key results with highlighted best values.

## API Usage

### List Documents

```bash
curl "https://api.yourdomain.com/api/documents?limit=10&offset=0"
```

### Get Document Notes

```bash
curl "https://api.yourdomain.com/api/documents/{id}/notes?inline=true"
```

### Upload Document

```bash
curl -X POST "https://api.yourdomain.com/api/upload" \
  -F "file=@paper.pdf" \
  -F "title=Paper Title"
```

### Toggle Read Status

```bash
curl -X PATCH "https://api.yourdomain.com/api/documents/{id}/read"
```

### Trigger Code Analysis

```bash
curl -X POST "https://api.yourdomain.com/api/code-analysis/{id}"
```

## Tips

### Best Practices

1. **Save papers as you find them** - Don't wait, the extension makes it quick
2. **Use read/unread status** - Track what you've actually read
3. **Check code notes** - Often has reproduction tips
4. **Review diagrams** - Visual summaries help understanding

### Limitations

- **Page limit**: Papers over 40 pages are truncated
- **File size**: Maximum 50MB per PDF
- **Rate limits**: 30 paper analyses per hour
- **Languages**: Best results with English papers

### Troubleshooting

**Paper stuck in "Processing":**
- Check if Gemini CLI is running on server
- Processing can take 5-10 minutes per paper

**Notes show "No notes available":**
- Paper may still be in queue
- Check processing status

**Mermaid diagrams not rendering:**
- Some complex diagrams may fail
- Click to view source code as fallback

**Code analysis button disabled:**
- Paper doesn't have associated code URL
- Or code analysis already in progress
