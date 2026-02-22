// Auto Reader Background Service Worker

const API_BASE_URL = 'http://localhost:3000/api';

// Listen for installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Auto Reader extension installed/updated');

  // Set default settings
  chrome.storage.local.set({
    apiBaseUrl: API_BASE_URL,
    defaultType: 'blog',
  });
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveDocument') {
    saveDocument(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'convertToPdf') {
    convertWebpageToPdf(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'getPresignedUrl') {
    getPresignedUploadUrl(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'checkHealth') {
    checkApiHealth()
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// Save document to backend
async function saveDocument(data) {
  const response = await fetch(`${API_BASE_URL}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save document');
  }

  return response.json();
}

// Convert webpage to PDF
async function convertWebpageToPdf(data) {
  const response = await fetch(`${API_BASE_URL}/upload/webpage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to convert webpage');
  }

  return response.json();
}

// Get presigned URL for direct upload
async function getPresignedUploadUrl(data) {
  const response = await fetch(`${API_BASE_URL}/upload/presigned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get upload URL');
  }

  return response.json();
}

// Check API health
async function checkApiHealth() {
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new Error('API is not available');
  }

  return response.json();
}
