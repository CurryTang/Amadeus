# Auto Reader Frontend

A React frontend for the Auto Reader research library.

## Features

- View saved documents (papers, books, blogs)
- Lazy loading with "Load More" button
- Download documents via presigned S3 URLs
- Configurable API URL for testing

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Deployment to GitHub Pages

1. Update `vite.config.js` - change `base` to match your repository name:
   ```js
   base: '/your-repo-name/',
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Deploy to GitHub Pages:
   ```bash
   npm run deploy
   ```

   Or manually push the `dist` folder to your `gh-pages` branch.

## Configuration

Click the settings icon (gear) in the header to configure:

- **API URL**: Your backend API endpoint (default: `http://localhost:3000/api`)

For production, you'll want to:
1. Deploy your backend to a public URL
2. Update the API URL in the frontend settings

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── DocumentList.jsx   # Document list component
│   │   ├── DocumentCard.jsx   # Single document card
│   │   └── Settings.jsx       # API URL settings
│   ├── App.jsx                # Main app component
│   ├── main.jsx               # Entry point
│   └── index.css              # Global styles
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.js
└── package.json
```
