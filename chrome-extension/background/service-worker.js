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

  if (request.action === 'fetchPdfBlob') {
    fetchPdfAsBase64(request.url, request.publisher)
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

// Fetch PDF from paywalled publisher using browser cookies, return as base64
async function fetchPdfAsBase64(url, publisher) {
  const headers = {
    'Accept': 'application/pdf,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Some publishers need a referer
  if (publisher === 'ieee') {
    headers['Referer'] = 'https://ieeexplore.ieee.org/';
  } else if (publisher === 'sciencedirect') {
    headers['Referer'] = 'https://www.sciencedirect.com/';
  } else if (publisher === 'springer') {
    headers['Referer'] = 'https://link.springer.com/';
  } else if (publisher === 'wiley') {
    headers['Referer'] = 'https://onlinelibrary.wiley.com/';
  } else if (publisher === 'acm') {
    headers['Referer'] = 'https://dl.acm.org/';
  }

  const response = await fetch(url, {
    headers,
    credentials: 'include',
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`PDF fetch failed: HTTP ${response.status}. Make sure you're logged in to the publisher.`);
  }

  const contentType = response.headers.get('content-type') || '';
  // Some publishers redirect to a login page instead of returning 401
  if (contentType.includes('text/html')) {
    throw new Error('Publisher returned HTML instead of PDF. You may need to log in or your institution may not have access.');
  }

  const blob = await response.blob();
  if (blob.size < 1000) {
    throw new Error('PDF file is too small — publisher may have returned an error page.');
  }

  // Convert blob to base64 for message passing
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => {
      resolve({
        base64: reader.result.split(',')[1], // Strip data:...;base64, prefix
        size: blob.size,
        contentType: contentType || 'application/pdf',
      });
    };
    reader.onerror = () => reject(new Error('Failed to read PDF blob'));
    reader.readAsDataURL(blob);
  });
}

// Check API health
async function checkApiHealth() {
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new Error('API is not available');
  }

  return response.json();
}
