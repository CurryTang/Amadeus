// Auto Reader Content Script
// Extracts metadata from web pages

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getMetadata') {
    const metadata = extractPageMetadata();
    sendResponse(metadata);
  }
  if (request.action === 'getArxivInfo') {
    const arxivInfo = extractArxivInfo();
    sendResponse(arxivInfo);
  }
  if (request.action === 'getOpenReviewInfo') {
    const openReviewInfo = extractOpenReviewInfo();
    sendResponse(openReviewInfo);
  }
  if (request.action === 'getHuggingFaceInfo') {
    const hfInfo = extractHuggingFaceInfo();
    sendResponse(hfInfo);
  }
  if (request.action === 'getAlphaXivInfo') {
    const alphaXivInfo = extractAlphaXivInfo();
    sendResponse(alphaXivInfo);
  }
  return true;
});

// Check if current page is arXiv
function isArxivPage() {
  return window.location.hostname.includes('arxiv.org');
}

// Extract arXiv paper ID from URL
function extractArxivId() {
  const url = window.location.href;
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

// Extract arXiv-specific info from the page
function extractArxivInfo() {
  if (!isArxivPage()) {
    return { isArxiv: false };
  }

  const arxivId = extractArxivId();
  if (!arxivId) {
    return { isArxiv: false };
  }

  const info = {
    isArxiv: true,
    arxivId: arxivId,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    title: '',
    authors: [],
    abstract: '',
    categories: [],
  };

  // Try to extract from abstract page
  if (window.location.pathname.includes('/abs/')) {
    // Title from h1.title
    const titleEl = document.querySelector('h1.title');
    if (titleEl) {
      info.title = titleEl.textContent.replace(/^Title:\s*/i, '').trim();
    }

    // Authors from div.authors
    const authorsEl = document.querySelector('div.authors');
    if (authorsEl) {
      const authorLinks = authorsEl.querySelectorAll('a');
      info.authors = Array.from(authorLinks).map(a => a.textContent.trim());
    }

    // Abstract from blockquote.abstract
    const abstractEl = document.querySelector('blockquote.abstract');
    if (abstractEl) {
      info.abstract = abstractEl.textContent.replace(/^Abstract:\s*/i, '').trim();
    }

    // Categories from div.subjects
    const subjectsEl = document.querySelector('td.subjects');
    if (subjectsEl) {
      info.categories = subjectsEl.textContent.trim().split(';').map(s => s.trim());
    }
  }

  // For PDF pages the title isn't extractable from the PDF viewer — leave it empty
  // so the popup will fetch the real title from the arXiv API

  return info;
}

// Check if current page is Hugging Face Papers
function isHuggingFacePapersPage() {
  return window.location.hostname.includes('huggingface.co') &&
         window.location.pathname.startsWith('/papers/');
}

// Extract Hugging Face paper info (these are arXiv papers)
function extractHuggingFaceInfo() {
  if (!isHuggingFacePapersPage()) {
    return { isHuggingFace: false };
  }

  // Extract arXiv ID from URL: huggingface.co/papers/2501.12948
  const match = window.location.pathname.match(/\/papers\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (!match) {
    return { isHuggingFace: false };
  }

  const arxivId = match[1];
  const info = {
    isHuggingFace: true,
    arxivId: arxivId,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    title: '',
    authors: [],
    abstract: '',
  };

  // Try to extract title from page (h1 element)
  const titleEl = document.querySelector('h1');
  if (titleEl) {
    info.title = titleEl.textContent.trim();
  }

  // Try to extract abstract (usually in a paragraph with specific class)
  const abstractEl = document.querySelector('p.text-gray-700, .prose p');
  if (abstractEl) {
    info.abstract = abstractEl.textContent.trim();
  }

  // Try to extract authors from author links
  const authorLinks = document.querySelectorAll('a[href*="/papers?author="]');
  if (authorLinks.length > 0) {
    info.authors = Array.from(authorLinks).map(a => a.textContent.trim());
  }

  return info;
}

// Check if current page is alphaXiv
function isAlphaXivPage() {
  return window.location.hostname.includes('alphaxiv.org');
}

// Extract arXiv ID from alphaXiv page metadata
function extractAlphaXivArxivId() {
  // Try 1: Look for arxiv.org links on the page
  const arxivLinks = document.querySelectorAll('a[href*="arxiv.org/abs/"], a[href*="arxiv.org/pdf/"]');
  for (const link of arxivLinks) {
    const match = link.href.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (match) return match[1];
  }

  // Try 2: Look for DOI with arXiv pattern in meta tags or page content
  const allMeta = document.querySelectorAll('meta');
  for (const meta of allMeta) {
    const content = meta.getAttribute('content') || '';
    const doiMatch = content.match(/10\.48550\/ARXIV\.(\d{4}\.\d{4,5})/i);
    if (doiMatch) return doiMatch[1];
    // Also check for direct arxiv ID in citation meta tags
    const arxivMatch = content.match(/(\d{4}\.\d{4,5}(?:v\d+)?)/);
    if (arxivMatch && (meta.getAttribute('name') || '').toLowerCase().includes('citation')) {
      return arxivMatch[1];
    }
  }

  // Try 3: Check if the URL itself contains an arxiv ID (alphaxiv.org/abs/2202.06793)
  const urlMatch = window.location.pathname.match(/\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (urlMatch) return urlMatch[1];

  // Try 4: Look in BibTeX/citation blocks on the page
  const pageText = document.body.innerText || '';
  const bibtexMatch = pageText.match(/10\.48550\/ARXIV\.(\d{4}\.\d{4,5})/i);
  if (bibtexMatch) return bibtexMatch[1];

  return null;
}

// Extract alphaXiv-specific info from the page
function extractAlphaXivInfo() {
  if (!isAlphaXivPage()) {
    return { isAlphaXiv: false };
  }

  const arxivId = extractAlphaXivArxivId();
  if (!arxivId) {
    return { isAlphaXiv: true, arxivId: null };
  }

  const info = {
    isAlphaXiv: true,
    arxivId: arxivId,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    alphaXivUrl: window.location.href,
    title: '',
    authors: [],
    abstract: '',
  };

  // Try to extract title from the page
  const titleEl = document.querySelector('h1, [class*="title"]');
  if (titleEl) {
    info.title = titleEl.textContent.replace(/^Title:\s*/i, '').trim();
  }

  // Try og:title as fallback
  if (!info.title) {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) info.title = ogTitle.getAttribute('content') || '';
  }

  // Try to extract abstract
  const ogDesc = document.querySelector('meta[property="og:description"], meta[name="description"]');
  if (ogDesc) {
    info.abstract = ogDesc.getAttribute('content') || '';
  }

  return info;
}

// Check if current page is OpenReview
function isOpenReviewPage() {
  return window.location.hostname.includes('openreview.net');
}

// Extract OpenReview paper ID from URL
function extractOpenReviewId() {
  const url = window.location.href;

  // Handle PDF URLs: https://openreview.net/pdf?id=XXXXX
  const pdfMatch = url.match(/openreview\.net\/pdf\?id=([^&#]+)/i);
  if (pdfMatch) return pdfMatch[1];

  // Handle forum/paper URLs: https://openreview.net/forum?id=XXXXX
  const forumMatch = url.match(/openreview\.net\/forum\?id=([^&#]+)/i);
  if (forumMatch) return forumMatch[1];

  return null;
}

// Extract OpenReview-specific info from the page
function extractOpenReviewInfo() {
  if (!isOpenReviewPage()) {
    return { isOpenReview: false };
  }

  const paperId = extractOpenReviewId();
  if (!paperId) {
    return { isOpenReview: false };
  }

  const info = {
    isOpenReview: true,
    paperId: paperId,
    pdfUrl: `https://openreview.net/pdf?id=${paperId}`,
    forumUrl: `https://openreview.net/forum?id=${paperId}`,
    title: '',
    authors: [],
    abstract: '',
    venue: '',
  };

  // Try to extract from forum/paper page
  if (window.location.pathname.includes('/forum')) {
    // Title from h2.citation_title or .note-content-title
    const titleEl = document.querySelector('h2.citation_title, .note-content-title');
    if (titleEl) {
      info.title = titleEl.textContent.trim();
    }

    // Authors from .note-authors or similar
    const authorsEl = document.querySelector('.note-authors');
    if (authorsEl) {
      const authorLinks = authorsEl.querySelectorAll('a, span');
      info.authors = Array.from(authorLinks).map(a => a.textContent.trim()).filter(a => a);
    }

    // Abstract from .note-content-value or span containing abstract
    const abstractEl = document.querySelector('.note-content-value');
    if (abstractEl) {
      const abstractText = abstractEl.textContent.trim();
      if (abstractText.length > 50) {
        info.abstract = abstractText;
      }
    }

    // Venue info
    const venueEl = document.querySelector('.note-content-venue, h3 a');
    if (venueEl) {
      info.venue = venueEl.textContent.trim();
    }
  }

  // For PDF pages, we only have the ID
  if (window.location.pathname.includes('/pdf')) {
    info.title = `OpenReview:${paperId}`;
  }

  return info;
}

// Extract metadata from the current page
function extractPageMetadata() {
  const metadata = {
    title: '',
    description: '',
    author: '',
    publishDate: '',
    ogImage: '',
    type: 'other',
  };

  // Get title - try various sources
  metadata.title = getTitle();

  // Get description
  metadata.description = getDescription();

  // Get author
  metadata.author = getAuthor();

  // Get publish date
  metadata.publishDate = getPublishDate();

  // Get og:image
  metadata.ogImage = getMetaContent('og:image');

  // Detect content type
  metadata.type = detectContentType();

  return metadata;
}

// Get page title from various sources
function getTitle() {
  // Try og:title first
  const ogTitle = getMetaContent('og:title');
  if (ogTitle) return ogTitle;

  // Try Twitter title
  const twitterTitle = getMetaContent('twitter:title');
  if (twitterTitle) return twitterTitle;

  // Try article headline (Schema.org)
  const headline = document.querySelector('[itemprop="headline"]');
  if (headline) return headline.textContent.trim();

  // Fall back to document title
  return document.title || '';
}

// Get page description
function getDescription() {
  // Try og:description
  const ogDesc = getMetaContent('og:description');
  if (ogDesc) return ogDesc;

  // Try meta description
  const metaDesc = getMetaContent('description');
  if (metaDesc) return metaDesc;

  // Try Twitter description
  const twitterDesc = getMetaContent('twitter:description');
  if (twitterDesc) return twitterDesc;

  // Try to get first paragraph
  const firstPara = document.querySelector('article p, main p, .content p');
  if (firstPara) {
    const text = firstPara.textContent.trim();
    return text.length > 300 ? text.substring(0, 300) + '...' : text;
  }

  return '';
}

// Get author information
function getAuthor() {
  // Try meta author
  const metaAuthor = getMetaContent('author');
  if (metaAuthor) return metaAuthor;

  // Try article:author
  const articleAuthor = getMetaContent('article:author');
  if (articleAuthor) return articleAuthor;

  // Try Schema.org author
  const schemaAuthor = document.querySelector('[itemprop="author"]');
  if (schemaAuthor) return schemaAuthor.textContent.trim();

  // Try common author selectors
  const authorSelectors = [
    '.author-name',
    '.byline',
    '[rel="author"]',
    '.post-author',
    '.article-author',
  ];

  for (const selector of authorSelectors) {
    const element = document.querySelector(selector);
    if (element) return element.textContent.trim();
  }

  return '';
}

// Get publish date
function getPublishDate() {
  // Try article:published_time
  const pubTime = getMetaContent('article:published_time');
  if (pubTime) return pubTime;

  // Try datePublished
  const datePublished = getMetaContent('datePublished');
  if (datePublished) return datePublished;

  // Try Schema.org datePublished
  const schemaDate = document.querySelector('[itemprop="datePublished"]');
  if (schemaDate) {
    return schemaDate.getAttribute('content') || schemaDate.textContent.trim();
  }

  // Try time element
  const timeElement = document.querySelector('time[datetime]');
  if (timeElement) return timeElement.getAttribute('datetime');

  return '';
}

// Get meta tag content by name or property
function getMetaContent(name) {
  const meta = document.querySelector(
    `meta[name="${name}"], meta[property="${name}"], meta[itemprop="${name}"]`
  );
  return meta ? meta.getAttribute('content') || '' : '';
}

// Detect content type based on page characteristics
function detectContentType() {
  const url = window.location.href.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();

  // Academic papers
  if (
    hostname.includes('arxiv.org') ||
    hostname.includes('alphaxiv.org') ||
    hostname.includes('openreview.net') ||
    (hostname.includes('huggingface.co') && url.includes('/papers/')) ||
    hostname.includes('scholar.google') ||
    hostname.includes('semanticscholar') ||
    hostname.includes('doi.org') ||
    hostname.includes('ieee.org') ||
    hostname.includes('acm.org') ||
    hostname.includes('nature.com') ||
    hostname.includes('sciencedirect.com') ||
    hostname.includes('springer.com') ||
    hostname.includes('pubmed') ||
    hostname.includes('researchgate.net')
  ) {
    return 'paper';
  }

  // Books
  if (
    hostname.includes('goodreads.com') ||
    hostname.includes('amazon.com/dp') ||
    hostname.includes('books.google.com') ||
    url.includes('/book/') ||
    url.includes('/ebook/')
  ) {
    return 'book';
  }

  // Blogs
  if (
    hostname.includes('medium.com') ||
    hostname.includes('dev.to') ||
    hostname.includes('hashnode') ||
    hostname.includes('substack.com') ||
    hostname.includes('wordpress.com') ||
    hostname.includes('blogger.com') ||
    hostname.includes('ghost.io') ||
    url.includes('/blog/') ||
    url.includes('/post/') ||
    url.includes('/article/') ||
    document.querySelector('article')
  ) {
    return 'blog';
  }

  // Check og:type
  const ogType = getMetaContent('og:type');
  if (ogType === 'article') return 'blog';
  if (ogType === 'book') return 'book';

  return 'other';
}

// Notify that content script is ready
console.log('Auto Reader content script loaded');
