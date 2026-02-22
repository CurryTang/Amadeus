const puppeteer = require('puppeteer');

// User agent to avoid being blocked
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Convert a webpage URL to PDF
 * @param {string} url - URL of the webpage to convert
 * @param {Object} options - PDF options
 * @returns {Promise<{buffer: Buffer, title: string}>}
 */
async function convertUrlToPdf(url, options = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  try {
    const page = await browser.newPage();

    // Set user agent to avoid being blocked
    await page.setUserAgent(USER_AGENT);

    // Set a reasonable viewport
    await page.setViewport({ width: 1200, height: 800 });

    // Try progressive loading strategies
    let navigated = false;

    // Strategy 1: Try networkidle2 (allows 2 connections) with shorter timeout
    try {
      console.log(`[Converter] Trying networkidle2 for ${url}`);
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      navigated = true;
    } catch (e) {
      console.log(`[Converter] networkidle2 failed: ${e.message}, trying domcontentloaded`);
    }

    // Strategy 2: Fall back to domcontentloaded
    if (!navigated) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        navigated = true;
        // Give extra time for content to render
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (e) {
        console.log(`[Converter] domcontentloaded failed: ${e.message}, trying load`);
      }
    }

    // Strategy 3: Just load the page
    if (!navigated) {
      await page.goto(url, {
        waitUntil: 'load',
        timeout: 15000,
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Wait a bit more for any late-loading content
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get page title with fallback
    let title = 'Untitled';
    try {
      title = await page.title();
    } catch (e) {
      console.warn('Could not get page title:', e.message);
    }

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm',
      },
      ...options,
    });

    return {
      buffer: pdfBuffer,
      title: title || 'Untitled',
    };
  } finally {
    await browser.close();
  }
}

/**
 * Extract metadata from a webpage
 * @param {string} url - URL of the webpage
 * @returns {Promise<{title: string, description: string, ogImage: string}>}
 */
async function extractWebpageMetadata(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const metadata = await page.evaluate(() => {
      const getMetaContent = (name) => {
        const meta =
          document.querySelector(`meta[name="${name}"]`) ||
          document.querySelector(`meta[property="${name}"]`);
        return meta ? meta.getAttribute('content') : '';
      };

      return {
        title: document.title || '',
        description:
          getMetaContent('description') || getMetaContent('og:description') || '',
        ogImage: getMetaContent('og:image') || '',
      };
    });

    return metadata;
  } finally {
    await browser.close();
  }
}

module.exports = {
  convertUrlToPdf,
  extractWebpageMetadata,
};
