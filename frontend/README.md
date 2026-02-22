# Auto Reader Frontend (Next.js)

This frontend now runs on Next.js app-router while reusing the existing React UI components.

## Features

- View saved documents (papers, books, blogs)
- Lazy loading with "Load More" button
- Download documents via presigned S3 URLs
- Configurable API URL for testing

## Development

```bash
# Install dependencies
npm install

# Start Next.js dev server (http://localhost:5173)
npm run dev
```

Legacy Vite commands are kept for fallback:

```bash
npm run dev:vite
npm run build:vite
```

## Configuration

Environment variables:

- `NEXT_PUBLIC_DEV_API_URL` (default `/api`)
- `NEXT_PUBLIC_API_URL` (production API base)
- `NEXT_PUBLIC_API_TIMEOUT_MS` (request timeout, default `15000`)
- `NEXT_DEV_BACKEND_URL` (rewrite target for `/api/*`, default `http://127.0.0.1:3000`)

By default, `/api/*` is rewritten to local backend during development.

## Project Structure

```
frontend/
├── app/                      # Next.js app-router entry
│   ├── layout.jsx
│   ├── page.jsx
│   └── globals.css
├── src/
│   ├── components/
│   │   ├── DocumentList.jsx   # Document list component
│   │   ├── DocumentCard.jsx   # Single document card
│   │   └── VibeResearcherPanel.jsx
│   ├── App.jsx                # Main app component
│   ├── main.jsx               # Legacy Vite entry (kept for fallback)
│   └── index.css              # Global styles
├── public/
│   └── favicon.svg
├── next.config.mjs
├── index.html                 # Legacy Vite file (unused by Next)
├── vite.config.js
└── package.json
```
