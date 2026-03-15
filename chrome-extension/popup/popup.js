// Configuration - will be loaded from storage
let API_BASE_URL = 'http://localhost:3000/api';
let storedPresets = [];
let currentPreset = null; // Currently detected preset

// DOM Elements
const titleInput = document.getElementById('title');
const urlInput = document.getElementById('url');
const typeSelect = document.getElementById('type');
const analysisProviderSelect = document.getElementById('analysisProvider');
const providerHint = document.getElementById('providerHint');
const notesInput = document.getElementById('notes');
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileName');
const fileInfoDiv = document.getElementById('fileInfo');
const uploadLabel = document.getElementById('uploadLabel');
const saveAsPdfBtn = document.getElementById('saveAsPdf');
const statusDiv = document.getElementById('status');

// Tag elements
const tagInput = document.getElementById('tagInput');
const addTagBtn = document.getElementById('addTagBtn');
const selectedTagsContainer = document.getElementById('selectedTags');
const tagSuggestions = document.getElementById('tagSuggestions');
const availableTagsContainer = document.getElementById('availableTags');

let selectedFile = null;
let allTags = [];
let selectedTags = [];
let currentArxivInfo = null; // Keep for backward compatibility
let currentOpenReviewInfo = null;
let userHasEditedTitle = false; // Prevent async metadata from overwriting user edits
let authToken = null; // JWT for authenticated API calls
const { buildArxivSaveRequest, resolveApiBaseUrl, shouldFetchArxivMetadata } = globalThis.AutoReaderArxivSave;

// --- Auth helpers ---

function getAuthHeaders() {
  return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
}

async function checkAuth() {
  // 1. Try stored JWT
  try {
    const stored = await chrome.storage.local.get(['authToken']);
    if (stored.authToken) {
      const res = await fetch(`${API_BASE_URL}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${stored.authToken}` },
      });
      const data = await res.json();
      if (data.valid) return stored.authToken;
    }
  } catch { /* network error, fall through */ }

  // 2. Try web app cookie (consistent session across web + extension)
  try {
    // Use the configured API base URL to derive the cookie domain
    const cookieUrl = API_BASE_URL.replace(/\/api\/?$/, '') || 'http://localhost:3000';
    const cookie = await chrome.cookies.get({ url: cookieUrl, name: 'auth_token' });
    if (cookie) {
      const res = await fetch(`${API_BASE_URL}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${cookie.value}` },
      });
      const data = await res.json();
      if (data.valid) {
        await chrome.storage.local.set({ authToken: cookie.value });
        return cookie.value;
      }
    }
  } catch { /* no cookie or network error */ }

  return null;
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainContent').classList.add('hidden');
}

function showMainContent() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainContent').classList.remove('hidden');
}

function setupLoginHandlers() {
  const loginBtn = document.getElementById('loginBtn');
  const errorDiv = document.getElementById('loginError');
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');

  async function doLogin() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      errorDiv.textContent = 'Please enter username and password';
      errorDiv.classList.remove('hidden');
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    errorDiv.classList.add('hidden');
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        errorDiv.textContent = data.error || 'Invalid username or password';
        errorDiv.classList.remove('hidden');
        return;
      }
      authToken = data.token;
      await chrome.storage.local.set({ authToken: data.token });
      showMainContent();
      await initializePopup();
    } catch {
      errorDiv.textContent = 'Network error. Check your connection.';
      errorDiv.classList.remove('hidden');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in';
    }
  }

  loginBtn.addEventListener('click', doLogin);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
}

async function initializePopup() {
  // eslint-disable-next-line no-undef
  const titleInputEl = document.getElementById('title');
  if (titleInputEl) {
    titleInputEl.addEventListener('input', () => { userHasEditedTitle = true; });
  }
  await Promise.all([
    loadCurrentTabInfo(),
    loadTags(),
    checkForPresets(),
    loadProviders(),
  ]);
  setupTagListeners();
  setupFileListeners();
  setupProviderListener();
  setupPasteHandlers();

  document.getElementById('logoutLink')?.addEventListener('click', async (e) => {
    e.preventDefault();
    authToken = null;
    await chrome.storage.local.remove(['authToken']);
    try { await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST' }); } catch {}
    showLoginScreen();
  });
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings first (API URL and presets)
  await loadStoredSettings();

  setupLoginHandlers();

  // Check auth: try stored token or shared web-app cookie
  const token = await checkAuth();
  if (!token) {
    showLoginScreen();
    return;
  }
  authToken = token;
  showMainContent();
  await initializePopup();
});

// Setup paste event handlers for all input fields
// Chrome extensions may block clipboard events by default
function setupPasteHandlers() {
  const inputFields = [titleInput, urlInput, tagInput, notesInput];

  inputFields.forEach(input => {
    if (!input) return;

    // Ensure paste events work by explicitly handling them
    input.addEventListener('paste', (e) => {
      // Let the default paste behavior work
      // This explicit handler ensures the event isn't blocked
    });

    // Also handle keydown for Cmd+V / Ctrl+V as fallback
    input.addEventListener('keydown', async (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        // If the default paste doesn't work, try to read from clipboard
        try {
          // Only intervene if paste seems blocked (check after a tick)
          const beforeValue = input.value;
          const selStart = input.selectionStart;
          const selEnd = input.selectionEnd;

          // Wait a tick to see if default paste worked
          setTimeout(async () => {
            if (input.value === beforeValue) {
              // Default paste didn't work, try clipboard API
              try {
                const text = await navigator.clipboard.readText();
                if (text) {
                  // Insert at cursor position
                  const newValue = beforeValue.substring(0, selStart) + text + beforeValue.substring(selEnd);
                  input.value = newValue;
                  input.selectionStart = input.selectionEnd = selStart + text.length;
                  // Trigger input event for any listeners
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }
              } catch (clipErr) {
                console.log('Clipboard API not available:', clipErr);
              }
            }
          }, 10);
        } catch (err) {
          console.log('Paste handler error:', err);
        }
      }
    });
  });
}

// Load stored settings (API URL and presets)
async function loadStoredSettings() {
  try {
    const result = await chrome.storage.local.get(['apiBaseUrl', 'presets', 'defaultProvider']);
    API_BASE_URL = resolveApiBaseUrl(result.apiBaseUrl);

    if (result.presets && result.presets.length > 0) {
      storedPresets = result.presets;
    } else {
      // Use default presets
      storedPresets = getDefaultPresets();
    }

    // Set default provider if stored, otherwise use codex-cli as default
    if (analysisProviderSelect) {
      if (result.defaultProvider) {
        analysisProviderSelect.value = result.defaultProvider;
      } else {
        // Default to codex-cli if no stored preference
        analysisProviderSelect.value = 'codex-cli';
      }
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Load available analysis providers from API
async function loadProviders() {
  try {
    const response = await fetch(`${API_BASE_URL}/reader/providers`, { headers: getAuthHeaders() });
    if (response.ok) {
      const data = await response.json();
      updateProviderOptions(data.providers);
    }
  } catch (error) {
    console.error('Failed to load providers:', error);
    // Keep default options if API is unavailable
  }
}

// Update provider dropdown with available options
// Note: We no longer disable providers based on server availability since the server
// may have different CLI tools available than what's checked. The user can select
// any provider and the server will handle fallback if needed.
function updateProviderOptions(providers) {
  if (!analysisProviderSelect || !providers) return;

  // Get currently selected value or stored default
  const currentValue = analysisProviderSelect.value;

  // Don't rebuild options - just update the display names if needed
  // This prevents losing the user's selection when providers reload
  providers.forEach(provider => {
    const option = analysisProviderSelect.querySelector(`option[value="${provider.id}"]`);
    if (option) {
      // Keep the option enabled - server will handle fallback
      option.disabled = false;
      // Optionally show availability hint but don't disable
      option.textContent = provider.name;
    }
  });

  // Restore current selection (should already be set, but ensure it)
  if (currentValue) {
    analysisProviderSelect.value = currentValue;
  }
}

// Setup provider selection listener
function setupProviderListener() {
  if (!analysisProviderSelect) return;

  analysisProviderSelect.addEventListener('change', async () => {
    const provider = analysisProviderSelect.value;
    
    // Update hint text based on provider
    const hints = {
      'gemini-cli': 'Uses local Gemini CLI installation',
      'google-api': 'Uses Google Generative AI API (cloud)',
      'claude-code': 'Uses Claude Code in headless mode',
    };
    
    if (providerHint) {
      providerHint.textContent = hints[provider] || 'Provider for AI paper analysis';
    }

    // Save as default for future uploads
    try {
      await chrome.storage.local.set({ defaultProvider: provider });
    } catch (error) {
      console.error('Failed to save default provider:', error);
    }
  });
}

// Default presets (same as in settings.js)
function getDefaultPresets() {
  return [
    {
      id: 'arxiv',
      name: 'arXiv',
      icon: '📄',
      color: '#b31b1b',
      type: 'paper',
      patterns: ['arxiv.org/abs/*', 'arxiv.org/pdf/*', 'arxiv.org/html/*'],
      endpoint: '/upload/arxiv',
      enabled: true,
    },
    {
      id: 'openreview',
      name: 'OpenReview',
      icon: '📋',
      color: '#3c6e71',
      type: 'paper',
      patterns: ['openreview.net/forum?id=*', 'openreview.net/pdf?id=*'],
      endpoint: '/upload/openreview',
      enabled: true,
    },
    {
      id: 'huggingface',
      name: 'Hugging Face Papers',
      icon: '🤗',
      color: '#ff9d00',
      type: 'paper',
      patterns: ['huggingface.co/papers/*'],
      endpoint: '/upload/arxiv', // Uses arXiv endpoint since HF papers are arXiv papers
      enabled: true,
    },
    {
      id: 'alphaxiv',
      name: 'alphaXiv',
      icon: '🔬',
      color: '#6366f1',
      type: 'paper',
      patterns: ['alphaxiv.org/abs/*', 'www.alphaxiv.org/abs/*'],
      endpoint: '/upload/arxiv', // Uses arXiv endpoint since alphaXiv papers are arXiv papers
      enabled: true,
    },
    {
      id: 'ieee',
      name: 'IEEE Xplore',
      icon: '🔬',
      color: '#00629b',
      type: 'paper',
      patterns: ['ieeexplore.ieee.org/document/*', 'ieeexplore.ieee.org/abstract/*'],
      endpoint: '',
      enabled: true,
    },
    {
      id: 'medium',
      name: 'Medium',
      icon: '✍️',
      color: '#00ab6c',
      type: 'blog',
      patterns: ['medium.com/*', '*.medium.com/*'],
      endpoint: '',
      enabled: true,
    },
  ];
}

// Check if current URL matches any preset pattern
function matchesPresetPattern(url, pattern) {
  // Convert pattern to regex
  // Escape special chars, then convert * to .*
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(regexPattern, 'i');
  return regex.test(url);
}

// Check all presets and show UI for matching ones
async function checkForPresets() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    // Find first matching enabled preset
    for (const preset of storedPresets) {
      if (!preset.enabled) continue;

      for (const pattern of preset.patterns) {
        if (matchesPresetPattern(tab.url, pattern)) {
          currentPreset = preset;

          // Special handling for arXiv (has dedicated endpoint)
          if (preset.id === 'arxiv') {
            await handleArxivPreset(tab);
          } else if (preset.id === 'openreview') {
            await handleOpenReviewPreset(tab);
          } else if (preset.id === 'huggingface') {
            await handleHuggingFacePreset(tab);
          } else if (preset.id === 'alphaxiv') {
            await handleAlphaXivPreset(tab);
          } else {
            // Generic preset handling
            showPresetBanner(preset);
            typeSelect.value = preset.type;
          }
          return;
        }
      }
    }
  } catch (error) {
    console.error('Failed to check presets:', error);
  }
}

// Handle arXiv preset specifically (has special API endpoint)
async function handleArxivPreset(tab) {
  const arxivInfo = await getArxivInfoForTab(tab);
  if (arxivInfo?.isArxiv) {
    currentArxivInfo = arxivInfo;
    if (shouldFetchArxivMetadata(arxivInfo)) {
      await fetchArxivMetadata(arxivInfo.arxivId);
    } else {
      showArxivMode(arxivInfo);
    }
    return;
  }

  // Final fallback: parse URL directly and ask the network for metadata.
  const arxivId = parseArxivUrlFromPopup(tab.url);
  if (arxivId) {
    currentArxivInfo = {
      isArxiv: true,
      arxivId,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
    };
    await fetchArxivMetadata(arxivId);
  }
}

// Handle OpenReview preset specifically
async function handleOpenReviewPreset(tab) {
  // Try to get OpenReview info from content script
  try {
    const openReviewInfo = await chrome.tabs.sendMessage(tab.id, { action: 'getOpenReviewInfo' });
    if (openReviewInfo && openReviewInfo.isOpenReview) {
      currentOpenReviewInfo = openReviewInfo;
      showOpenReviewMode(openReviewInfo);
    }
  } catch (e) {
    // Content script not available, try to parse URL directly
    const paperId = parseOpenReviewUrlFromPopup(tab.url);
    if (paperId) {
      currentOpenReviewInfo = {
        isOpenReview: true,
        paperId,
        pdfUrl: `https://openreview.net/pdf?id=${paperId}`,
        forumUrl: `https://openreview.net/forum?id=${paperId}`
      };
      showOpenReviewMode(currentOpenReviewInfo);
    }
  }
}

// Handle Hugging Face Papers preset (these are arXiv papers displayed on HF)
async function handleHuggingFacePreset(tab) {
  // Try to get HF info from content script first
  try {
    const hfInfo = await chrome.tabs.sendMessage(tab.id, { action: 'getHuggingFaceInfo' });
    if (hfInfo && hfInfo.isHuggingFace && hfInfo.arxivId) {
      currentArxivInfo = {
        isArxiv: true,
        arxivId: hfInfo.arxivId,
        title: hfInfo.title,
        authors: hfInfo.authors,
        abstract: hfInfo.abstract,
        pdfUrl: hfInfo.pdfUrl,
        absUrl: hfInfo.absUrl,
        source: 'huggingface'
      };
      if (!shouldFetchArxivMetadata(currentArxivInfo)) {
        showArxivMode(currentArxivInfo);
        showHuggingFaceBanner(hfInfo.arxivId);
      } else {
        await fetchArxivMetadata(hfInfo.arxivId);
        showHuggingFaceBanner(hfInfo.arxivId);
      }
      return;
    }
  } catch (e) {
    // Content script not available, fall back to URL parsing
  }

  // Fall back to URL parsing
  const arxivId = parseHuggingFaceUrlFromPopup(tab.url);
  if (arxivId) {
    currentArxivInfo = {
      isArxiv: true,
      arxivId,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      source: 'huggingface'
    };
    // Fetch full metadata from arXiv
    await fetchArxivMetadata(arxivId);
    // Show HF-specific banner
    showHuggingFaceBanner(arxivId);
  }
}

// Handle alphaXiv preset (these are arXiv papers displayed on alphaXiv)
async function handleAlphaXivPreset(tab) {
  // Try to get alphaXiv info from content script first
  try {
    const alphaXivInfo = await chrome.tabs.sendMessage(tab.id, { action: 'getAlphaXivInfo' });
    if (alphaXivInfo && alphaXivInfo.isAlphaXiv && alphaXivInfo.arxivId) {
      currentArxivInfo = {
        isArxiv: true,
        arxivId: alphaXivInfo.arxivId,
        title: alphaXivInfo.title,
        authors: alphaXivInfo.authors,
        abstract: alphaXivInfo.abstract,
        pdfUrl: alphaXivInfo.pdfUrl,
        absUrl: alphaXivInfo.absUrl,
        source: 'alphaxiv'
      };
      if (shouldFetchArxivMetadata(currentArxivInfo)) {
        await fetchArxivMetadata(alphaXivInfo.arxivId);
      } else {
        showArxivMode(currentArxivInfo);
      }
      showAlphaXivBanner(alphaXivInfo.arxivId);
      return;
    }
  } catch (e) {
    // Content script not available, fall back to URL parsing
  }

  // Fall back: alphaXiv URLs with numeric IDs (alphaxiv.org/abs/2202.06793)
  const arxivId = parseAlphaXivUrlFromPopup(tab.url);
  if (arxivId) {
    currentArxivInfo = {
      isArxiv: true,
      arxivId,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      source: 'alphaxiv'
    };
    await fetchArxivMetadata(arxivId);
    showAlphaXivBanner(arxivId);
  } else {
    // Slug-based URL without content script - show a message
    showStatus('Open the alphaXiv page fully to detect the arXiv paper ID', 'error');
  }
}

// Parse alphaXiv URL to get arXiv ID (only works for numeric ID URLs)
function parseAlphaXivUrlFromPopup(url) {
  // Pattern: alphaxiv.org/abs/2202.06793
  const match = url.match(/alphaxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  return match ? match[1] : null;
}

// Show alphaXiv detection banner
function showAlphaXivBanner(arxivId) {
  // Check if banner already exists
  if (document.getElementById('alphaxivBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'alphaxivBanner';
  banner.className = 'arxiv-banner'; // Reuse arXiv banner style
  banner.style.background = 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)';
  banner.innerHTML = `
    <div class="arxiv-badge">
      <span class="arxiv-icon">🔬</span>
      <span>alphaXiv Paper</span>
    </div>
    <div class="arxiv-id">arXiv:${arxivId}</div>
    <button type="button" id="saveAlphaXivPdf" class="btn btn-arxiv">
      <span>📥</span> Save PDF
    </button>
  `;

  const header = document.querySelector('header');
  header.after(banner);

  // Add click handler for save button (reuses arXiv save logic)
  document.getElementById('saveAlphaXivPdf').addEventListener('click', saveArxivPaper);
}

// Parse Hugging Face papers URL to get arXiv ID
function parseHuggingFaceUrlFromPopup(url) {
  // Pattern: huggingface.co/papers/2501.12948
  const match = url.match(/huggingface\.co\/papers\/(\d+\.\d+(?:v\d+)?)/i);
  return match ? match[1] : null;
}

// Show Hugging Face detection banner
function showHuggingFaceBanner(arxivId) {
  // Check if banner already exists
  if (document.getElementById('hfBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'hfBanner';
  banner.className = 'arxiv-banner'; // Reuse arXiv banner style
  banner.style.background = 'linear-gradient(135deg, #ff9d00 0%, #ff6600 100%)';
  banner.innerHTML = `
    <div class="arxiv-badge">
      <span class="arxiv-icon">🤗</span>
      <span>HuggingFace Paper</span>
    </div>
    <div class="arxiv-id">arXiv:${arxivId}</div>
    <button type="button" id="saveHfPdf" class="btn btn-arxiv">
      <span>📥</span> Save PDF
    </button>
  `;

  const header = document.querySelector('header');
  header.after(banner);

  // Add click handler for save button (reuses arXiv save logic)
  document.getElementById('saveHfPdf').addEventListener('click', saveArxivPdf);
}

// Show generic preset banner (for presets without special endpoints)
function showPresetBanner(preset) {
  if (document.getElementById('presetBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'presetBanner';
  banner.className = 'preset-banner';
  banner.style.background = `linear-gradient(135deg, ${preset.color} 0%, ${adjustColor(preset.color, -20)} 100%)`;
  banner.innerHTML = `
    <div class="preset-badge">
      <span class="preset-icon">${preset.icon}</span>
      <span>${preset.name} Detected</span>
    </div>
  `;

  const header = document.querySelector('header');
  header.after(banner);
}

// Adjust color brightness
function adjustColor(color, amount) {
  const hex = color.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Load current tab info
async function loadCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      titleInput.value = tab.title || '';
      urlInput.value = tab.url || '';

      // Try to get enhanced metadata from content script
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getMetadata' });
        if (response) {
          if (response.title) titleInput.value = response.title;
          if (response.description) notesInput.value = response.description;
        }
      } catch (e) {
        // Content script might not be loaded, use tab info
      }

      // Auto-detect type based on URL
      typeSelect.value = detectContentType(tab.url);
    }
  } catch (error) {
    console.error('Failed to get tab info:', error);
  }
}

// Load tags from API
async function loadTags() {
  try {
    const response = await fetch(`${API_BASE_URL}/tags`, { headers: getAuthHeaders() });
    if (response.ok) {
      const data = await response.json();
      allTags = data.tags || [];
      renderAvailableTags();
    }
  } catch (error) {
    console.error('Failed to load tags:', error);
  }
}

// Parse arXiv URL to get paper ID
function parseArxivUrlFromPopup(url) {
  const patterns = [
    // New format: 2507.05257, 2507.05257v2, with optional .pdf extension
    /arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    /arxiv\.org\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/i,
    /arxiv\.org\/html\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    // Old format: hep-ph/9901312, cs.AI/0001001
    /arxiv\.org\/abs\/([a-z-]+\/\d{7}(?:v\d+)?)/i,
    /arxiv\.org\/pdf\/([a-z-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      // Remove any trailing .pdf if present
      return match[1].replace(/\.pdf$/i, '');
    }
  }
  return null;
}

// Parse OpenReview URL to get paper ID
function parseOpenReviewUrlFromPopup(url) {
  const pdfMatch = url.match(/openreview\.net\/pdf\?id=([^&#]+)/i);
  if (pdfMatch) return pdfMatch[1];

  const forumMatch = url.match(/openreview\.net\/forum\?id=([^&#]+)/i);
  if (forumMatch) return forumMatch[1];

  return null;
}

async function getArxivInfoForTab(tab) {
  if (!tab?.id) return null;
  let fallbackArxivInfo = null;

  try {
    const arxivInfo = await chrome.tabs.sendMessage(tab.id, { action: 'getArxivInfo' });
    if (arxivInfo?.isArxiv) {
      if (!shouldFetchArxivMetadata(arxivInfo)) {
        return arxivInfo;
      }
      fallbackArxivInfo = arxivInfo;
    }
  } catch (error) {
    console.log('Content-script arXiv extraction unavailable, trying injected fallback:', error);
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
        const extractId = (url) => {
          const patterns = [
            /arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
            /arxiv\.org\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/i,
            /arxiv\.org\/html\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
            /arxiv\.org\/abs\/([a-z-]+\/\d{7}(?:v\d+)?)/i,
            /arxiv\.org\/pdf\/([a-z-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?/i,
          ];
          for (const pattern of patterns) {
            const match = String(url || '').match(pattern);
            if (match) return match[1].replace(/\.pdf$/i, '');
          }
          return null;
        };

        if (!window.location.hostname.includes('arxiv.org')) {
          return { isArxiv: false };
        }

        const arxivId = extractId(window.location.href);
        if (!arxivId) {
          return { isArxiv: false };
        }

        const titleElement = document.querySelector('h1.title, h1.title.mathjax, main h1');
        const authorsElement = document.querySelector('div.authors, .authors');
        const abstractElement = document.querySelector('blockquote.abstract, .abstract');
        const subjectElement = document.querySelector('td.subjects');
        const citationTitle = document.querySelector('meta[name="citation_title"]')?.getAttribute('content');
        const citationAbstract = document.querySelector('meta[name="citation_abstract"]')?.getAttribute('content');
        const citationAuthors = Array.from(document.querySelectorAll('meta[name="citation_author"]'))
          .map((node) => normalize(node.getAttribute('content')))
          .filter(Boolean);

        const authors = citationAuthors.length > 0
          ? citationAuthors
          : Array.from(authorsElement?.querySelectorAll('a') || [])
              .map((node) => normalize(node.textContent))
              .filter(Boolean);

        const title = normalize(
          citationTitle || titleElement?.textContent?.replace(/^Title:\s*/i, '') || ''
        );
        const abstract = normalize(
          citationAbstract || abstractElement?.textContent?.replace(/^Abstract:\s*/i, '') || ''
        );
        const categories = normalize(subjectElement?.textContent || '')
          .split(';')
          .map((value) => value.trim())
          .filter(Boolean);

        return {
          isArxiv: true,
          arxivId,
          title,
          authors,
          abstract,
          categories,
          pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
          absUrl: `https://arxiv.org/abs/${arxivId}`,
        };
      },
    });

    if (result?.result?.isArxiv) {
      return result.result;
    }
  } catch (error) {
    console.warn('Injected arXiv extraction failed:', error);
  }

  return fallbackArxivInfo;
}

// Fetch arXiv metadata directly from the arXiv Atom API (no backend required)
async function fetchArxivMetadataDirect(arxivId) {
  // Strip version suffix for the query (API returns latest by default)
  const cleanId = arxivId.replace(/v\d+$/, '');
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${cleanId}`);
  if (!response.ok) throw new Error(`arXiv API returned ${response.status}`);
  const text = await response.text();
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  const entry = xml.querySelector('entry');
  if (!entry) return null;
  // Collapse internal whitespace/newlines that arXiv titles sometimes have
  const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ');
  return {
    arxivId: arxivId,
    title: normalize(entry.querySelector('title')?.textContent),
    authors: Array.from(entry.querySelectorAll('author name')).map(n => n.textContent.trim()),
    abstract: normalize(entry.querySelector('summary')?.textContent),
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
  };
}

// Fetch arXiv metadata — tries the public Atom API first, falls back to backend
async function fetchArxivMetadata(arxivId) {
  // Show a placeholder while fetching
  if (!userHasEditedTitle) {
    titleInput.value = `Fetching title for arXiv:${arxivId}…`;
  }

  // 1. Try the public arXiv Atom API (fast, no backend needed)
  try {
    const metadata = await fetchArxivMetadataDirect(arxivId);
    if (metadata && metadata.title) {
      currentArxivInfo = { isArxiv: true, ...metadata };
      showArxivMode(currentArxivInfo);
      return;
    }
  } catch (error) {
    console.log('Direct arXiv API fetch failed, trying backend:', error);
  }

  // 2. Fall back to backend API
  try {
    const response = await fetch(`${API_BASE_URL}/upload/arxiv/metadata?paperId=${arxivId}`, { headers: getAuthHeaders() });
    if (response.ok) {
      const metadata = await response.json();
      currentArxivInfo = {
        isArxiv: true,
        arxivId: metadata.id,
        title: metadata.title,
        authors: metadata.authors,
        abstract: metadata.abstract,
        pdfUrl: metadata.pdfUrl,
        absUrl: metadata.absUrl,
      };
      showArxivMode(currentArxivInfo);
      return;
    }
  } catch (error) {
    console.error('Backend arXiv metadata fetch failed:', error);
  }

  // 3. Both failed — clear the placeholder
  if (!userHasEditedTitle && !currentArxivInfo?.title) {
    titleInput.value = '';
  }
  if (currentArxivInfo?.arxivId) {
    showArxivMode(currentArxivInfo);
  }
}

// Show arXiv-specific UI
function showArxivMode(arxivInfo) {
  // Update title only if user hasn't manually edited it
  if (arxivInfo.title && !userHasEditedTitle) {
    titleInput.value = arxivInfo.title;
  }

  // Set type to paper
  typeSelect.value = 'paper';

  // Add authors and abstract to notes
  if (arxivInfo.authors && arxivInfo.authors.length > 0) {
    const authorsStr = `Authors: ${arxivInfo.authors.join(', ')}`;
    if (arxivInfo.abstract) {
      notesInput.value = `${authorsStr}\n\nAbstract: ${arxivInfo.abstract}`;
    } else {
      notesInput.value = authorsStr;
    }
  }

  // Show arXiv banner and button
  showArxivBanner(arxivInfo);
}

// Show arXiv detection banner
function showArxivBanner(arxivInfo) {
  // Check if banner already exists
  if (document.getElementById('arxivBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'arxivBanner';
  banner.className = 'arxiv-banner';
  banner.innerHTML = `
    <div class="arxiv-badge">
      <span class="arxiv-icon">📄</span>
      <span>arXiv Paper Detected</span>
    </div>
    <div class="arxiv-id">arXiv:${arxivInfo.arxivId}</div>
    <button type="button" id="saveArxivPdf" class="btn btn-arxiv">
      Save arXiv PDF
    </button>
  `;

  // Insert after header
  const header = document.querySelector('header');
  header.after(banner);

  // Add click handler for arXiv save button
  document.getElementById('saveArxivPdf').addEventListener('click', saveArxivPaper);
}

// Show OpenReview-specific UI
function showOpenReviewMode(openReviewInfo) {
  // Update title
  if (openReviewInfo.title) {
    titleInput.value = openReviewInfo.title;
  }

  // Set type to paper
  typeSelect.value = 'paper';

  // Add authors and abstract to notes
  let notesContent = '';
  if (openReviewInfo.authors && openReviewInfo.authors.length > 0) {
    notesContent = `Authors: ${openReviewInfo.authors.join(', ')}`;
  }
  if (openReviewInfo.venue) {
    notesContent += `\n\nVenue: ${openReviewInfo.venue}`;
  }
  if (openReviewInfo.abstract) {
    notesContent += `\n\nAbstract: ${openReviewInfo.abstract}`;
  }
  if (notesContent) {
    notesInput.value = notesContent;
  }

  // Show OpenReview banner and button
  showOpenReviewBanner(openReviewInfo);
}

// Show OpenReview detection banner
function showOpenReviewBanner(openReviewInfo) {
  // Check if banner already exists
  if (document.getElementById('openreviewBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'openreviewBanner';
  banner.className = 'arxiv-banner'; // Reuse arXiv banner style
  banner.style.background = 'linear-gradient(135deg, #3c6e71 0%, #2d5457 100%)';
  banner.innerHTML = `
    <div class="arxiv-badge">
      <span class="arxiv-icon">📋</span>
      <span>OpenReview Paper Detected</span>
    </div>
    <div class="arxiv-id">ID: ${openReviewInfo.paperId}</div>
    <button type="button" id="saveOpenReviewPdf" class="btn btn-arxiv">
      Save OpenReview PDF
    </button>
  `;

  // Insert after header
  const header = document.querySelector('header');
  header.after(banner);

  // Add click handler for OpenReview save button
  document.getElementById('saveOpenReviewPdf').addEventListener('click', saveOpenReviewPaper);
}

// Save arXiv paper (fetch PDF and upload)
async function saveArxivPaper() {
  if (!currentArxivInfo || !currentArxivInfo.arxivId) {
    showStatus('No arXiv paper detected', 'error');
    return;
  }

  const data = getFormData();

  setLoading(true, 'Fetching arXiv PDF...');

  try {
    const payload = buildArxivSaveRequest(currentArxivInfo, data);
    if (!payload) {
      throw new Error('No arXiv paper detected');
    }

    const response = await fetch(`${API_BASE_URL}/upload/arxiv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMsg = `Failed to save (HTTP ${response.status})`;
      try { const e = await response.json(); errorMsg = e.error || errorMsg; } catch {}
      throw new Error(errorMsg);
    }

    showStatus('arXiv paper saved successfully!', 'success');
    resetForm();
  } catch (error) {
    console.error('arXiv save error:', error);
    showStatus(error.message || 'Failed to save arXiv paper', 'error');
  } finally {
    setLoading(false);
  }
}

// Save OpenReview paper (fetch PDF and upload)
async function saveOpenReviewPaper() {
  if (!currentOpenReviewInfo || !currentOpenReviewInfo.paperId) {
    showStatus('No OpenReview paper detected', 'error');
    return;
  }

  const data = getFormData();

  setLoading(true, 'Fetching OpenReview PDF...');

  try {
    const response = await fetch(`${API_BASE_URL}/upload/openreview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        paperId: currentOpenReviewInfo.paperId,
        pdfUrl: currentOpenReviewInfo.pdfUrl,
        title: data.title || currentOpenReviewInfo.title || `OpenReview:${currentOpenReviewInfo.paperId}`,
        tags: data.tags,
        notes: data.notes,
        analysisProvider: data.analysisProvider,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to save (HTTP ${response.status})`;
      try { const e = await response.json(); errorMsg = e.error || errorMsg; } catch {}
      throw new Error(errorMsg);
    }

    showStatus('OpenReview paper saved successfully!', 'success');
    resetForm();
  } catch (error) {
    console.error('OpenReview save error:', error);
    showStatus(error.message || 'Failed to save OpenReview paper', 'error');
  } finally {
    setLoading(false);
  }
}

// Setup tag event listeners
function setupTagListeners() {
  // Tag input for filtering/creating
  tagInput.addEventListener('input', () => {
    const query = tagInput.value.trim().toLowerCase();
    renderSuggestions(query);
  });

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = tagInput.value.trim();
      if (query) {
        addOrCreateTag(query);
      }
    }
  });

  // Add tag button
  addTagBtn.addEventListener('click', () => {
    const query = tagInput.value.trim();
    if (query) {
      addOrCreateTag(query);
    }
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!tagInput.contains(e.target) && !tagSuggestions.contains(e.target)) {
      tagSuggestions.innerHTML = '';
      tagSuggestions.classList.remove('has-suggestions');
    }
  });
}

// Setup file input listeners
function setupFileListeners() {
  // File input handler - just preview, don't upload yet
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file;
      fileNameDisplay.textContent = file.name;
      fileInfoDiv.style.display = 'flex';
      uploadLabel.style.display = 'none';

      // Disable URL field when file is selected
      urlInput.disabled = true;
      urlInput.style.opacity = '0.5';

      // Auto-fill title from filename if empty
      if (!titleInput.value) {
        titleInput.value = file.name.replace(/\.[^/.]+$/, '');
      }

      // Update button text and enable it
      saveAsPdfBtn.textContent = 'Upload File';
      saveAsPdfBtn.disabled = false;
    }
  });

  // Clear file button
  const clearFileBtn = document.getElementById('clearFile');
  if (clearFileBtn) {
    clearFileBtn.addEventListener('click', clearSelectedFile);
  }

  // URL input change listener - enable/disable button based on URL
  urlInput.addEventListener('input', updateSaveButtonState);

  // Initial button state
  updateSaveButtonState();
}

// Update save button state based on URL and file selection
function updateSaveButtonState() {
  if (selectedFile) {
    // File is selected - button should be enabled
    saveAsPdfBtn.disabled = false;
    saveAsPdfBtn.textContent = 'Upload File';
  } else {
    // No file - check if URL is present
    const hasUrl = urlInput.value.trim().length > 0;
    saveAsPdfBtn.disabled = !hasUrl;
    saveAsPdfBtn.textContent = 'Save as PDF';
  }
}

// Clear selected file
function clearSelectedFile() {
  selectedFile = null;
  fileInput.value = '';
  fileNameDisplay.textContent = '';
  fileInfoDiv.style.display = 'none';
  uploadLabel.style.display = 'flex';

  // Re-enable URL field
  urlInput.disabled = false;
  urlInput.style.opacity = '1';

  // Update button state based on URL
  updateSaveButtonState();
}

// Render tag suggestions dropdown
function renderSuggestions(query) {
  tagSuggestions.innerHTML = '';

  if (!query) {
    tagSuggestions.classList.remove('has-suggestions');
    return;
  }

  const filtered = allTags.filter(tag =>
    tag.name.toLowerCase().includes(query) &&
    !selectedTags.some(st => st.name === tag.name)
  );

  if (filtered.length === 0 && !allTags.some(t => t.name.toLowerCase() === query.toLowerCase())) {
    // Show "Create new tag" option
    const createItem = document.createElement('div');
    createItem.className = 'suggestion-item create-new';
    createItem.innerHTML = `+ Create tag "${query}"`;
    createItem.addEventListener('click', () => createNewTag(query));
    tagSuggestions.appendChild(createItem);
  }

  filtered.slice(0, 5).forEach(tag => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.innerHTML = `
      <span class="color-dot" style="background: ${tag.color}"></span>
      <span>${tag.name}</span>
    `;
    item.addEventListener('click', () => selectTag(tag));
    tagSuggestions.appendChild(item);
  });

  if (tagSuggestions.children.length > 0) {
    tagSuggestions.classList.add('has-suggestions');
  } else {
    tagSuggestions.classList.remove('has-suggestions');
  }
}

// Render available tags as clickable chips
function renderAvailableTags() {
  availableTagsContainer.innerHTML = '';

  // Filter out already selected tags
  const unselectedTags = allTags.filter(tag =>
    !selectedTags.some(st => st.name === tag.name)
  );

  unselectedTags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'available-tag';
    chip.innerHTML = `
      <span class="color-dot" style="background: ${tag.color}"></span>
      <span>${tag.name}</span>
    `;
    chip.addEventListener('click', () => {
      selectTag(tag);
    });
    availableTagsContainer.appendChild(chip);
  });
}

// Render selected tags
function renderSelectedTags() {
  selectedTagsContainer.innerHTML = '';

  selectedTags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.style.background = tag.color;
    chip.innerHTML = `
      <span>${tag.name}</span>
      <span class="remove-tag">×</span>
    `;
    chip.querySelector('.remove-tag').addEventListener('click', (e) => {
      e.stopPropagation();
      removeTag(tag);
    });
    selectedTagsContainer.appendChild(chip);
  });

  // Update available tags to show selection state
  renderAvailableTags();
}

// Select a tag
function selectTag(tag) {
  if (!selectedTags.some(st => st.name === tag.name)) {
    selectedTags.push(tag);
    renderSelectedTags();
  }
  tagInput.value = '';
  tagSuggestions.innerHTML = '';
  tagSuggestions.classList.remove('has-suggestions');
}

// Remove a tag
function removeTag(tag) {
  selectedTags = selectedTags.filter(st => st.name !== tag.name);
  renderSelectedTags();
}

// Create a new tag
async function createNewTag(name) {
  try {
    const response = await fetch(`${API_BASE_URL}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ name }),
    });

    if (response.ok) {
      const tag = await response.json();
      allTags.push(tag);
      selectTag(tag);
    }
  } catch (error) {
    console.error('Failed to create tag:', error);
    showStatus('Failed to create tag', 'error');
  }
}

// Add existing tag or create new one
async function addOrCreateTag(name) {
  const existingTag = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());

  if (existingTag) {
    selectTag(existingTag);
  } else {
    await createNewTag(name);
  }
}

// Detect content type from URL
function detectContentType(url) {
  if (!url) return 'other';

  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('arxiv.org') ||
      lowerUrl.includes('alphaxiv.org') ||
      lowerUrl.includes('openreview.net') ||
      lowerUrl.includes('scholar.google') ||
      lowerUrl.includes('semanticscholar') ||
      lowerUrl.includes('doi.org') ||
      lowerUrl.includes('ieee.org') ||
      lowerUrl.includes('acm.org')) {
    return 'paper';
  }

  if (lowerUrl.includes('medium.com') ||
      lowerUrl.includes('dev.to') ||
      lowerUrl.includes('blog') ||
      lowerUrl.includes('substack.com')) {
    return 'blog';
  }

  return 'other';
}

// Save as PDF - handles both file upload and webpage conversion
saveAsPdfBtn.addEventListener('click', async () => {
  const data = getFormData();

  // If file is selected, upload it
  if (selectedFile) {
    await uploadFile(data);
    return;
  }

  // If on arXiv page, use arXiv endpoint
  if (currentArxivInfo && currentArxivInfo.isArxiv && currentArxivInfo.arxivId) {
    await saveArxivPaper();
    return;
  }

  // If on OpenReview page, use OpenReview endpoint
  if (currentOpenReviewInfo && currentOpenReviewInfo.isOpenReview && currentOpenReviewInfo.paperId) {
    await saveOpenReviewPaper();
    return;
  }

  // Otherwise convert webpage to PDF
  if (!validateForm(data, true)) return;

  setLoading(true, 'Converting to PDF...');

  try {
    const response = await fetch(`${API_BASE_URL}/upload/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        url: data.url,
        title: data.title,
        type: data.type,
        tags: data.tags,
        notes: data.notes,
        analysisProvider: data.analysisProvider,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to convert (HTTP ${response.status})`;
      try { const e = await response.json(); errorMsg = e.error || errorMsg; } catch {}
      throw new Error(errorMsg);
    }

    showStatus('Page saved as PDF!', 'success');
    resetForm();
  } catch (error) {
    console.error('PDF conversion error:', error);
    showStatus('Failed to convert page. Please try again.', 'error');
  } finally {
    setLoading(false);
  }
});

// Upload file function
async function uploadFile(data) {
  if (!selectedFile) return;

  if (!data.title) {
    showStatus('Please enter a title', 'error');
    return;
  }

  setLoading(true, 'Uploading file...');

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('title', data.title);
    formData.append('type', data.type);
    formData.append('tags', JSON.stringify(data.tags));
    formData.append('notes', data.notes || '');
    formData.append('analysisProvider', data.analysisProvider || 'codex-cli');

    const response = await fetch(`${API_BASE_URL}/upload/direct`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to upload');
    }

    showStatus('File uploaded successfully!', 'success');
    resetForm();
    clearSelectedFile();
  } catch (error) {
    console.error('Upload error:', error);
    showStatus(error.message || 'Failed to upload file. Please try again.', 'error');
  } finally {
    setLoading(false);
  }
}

// Get form data
function getFormData() {
  return {
    title: titleInput.value.trim(),
    url: urlInput.value.trim(),
    type: typeSelect.value,
    tags: selectedTags.map(t => t.name),
    notes: notesInput.value.trim(),
    analysisProvider: analysisProviderSelect ? analysisProviderSelect.value : 'codex-cli',
  };
}

// Reset form after successful save
function resetForm() {
  selectedTags = [];
  renderSelectedTags();
  notesInput.value = '';
}

// Validate form
function validateForm(data, requireUrl) {
  if (!data.title) {
    showStatus('Please enter a title', 'error');
    return false;
  }

  if (requireUrl && !data.url) {
    showStatus('Please enter a URL', 'error');
    return false;
  }

  if (data.url && !isValidUrl(data.url)) {
    showStatus('Please enter a valid URL', 'error');
    return false;
  }

  return true;
}

// URL validation
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Show status message
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');

  if (type === 'success') {
    setTimeout(() => {
      statusDiv.classList.add('hidden');
    }, 3000);
  }
}

// Set loading state
function setLoading(loading, message = 'Loading...') {
  saveAsPdfBtn.disabled = loading;

  // Also disable arXiv button if it exists
  const arxivBtn = document.getElementById('saveArxivPdf');
  if (arxivBtn) {
    arxivBtn.disabled = loading;
  }

  // Also disable OpenReview button if it exists
  const openReviewBtn = document.getElementById('saveOpenReviewPdf');
  if (openReviewBtn) {
    openReviewBtn.disabled = loading;
  }

  // Also disable alphaXiv button if it exists
  const alphaXivBtn = document.getElementById('saveAlphaXivPdf');
  if (alphaXivBtn) {
    alphaXivBtn.disabled = loading;
  }

  if (loading) {
    showStatus(message, 'loading');
  }
}

// View Library link
document.getElementById('viewLibrary').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: `${API_BASE_URL.replace('/api', '')}/library` });
});

// Settings link - open settings page
document.getElementById('settings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
});
