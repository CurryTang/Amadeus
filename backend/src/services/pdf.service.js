const fs = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const s3Service = require('./s3.service');
const config = require('../config');

// Temp directory for processing - must be within project directory for Gemini CLI access
// Gemini CLI can only access files within the project directory for security
const TMP_DIR = config.reader?.tmpDir || path.join(__dirname, '..', '..', 'tmp');

/**
 * Ensure temp directory exists
 */
async function ensureTmpDir() {
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

/**
 * Download a PDF from S3 to a temp file
 * @param {string} s3Key - S3 object key
 * @returns {Promise<{filePath: string, buffer: Buffer}>}
 */
async function downloadPdfToTmp(s3Key) {
  await ensureTmpDir();

  const buffer = await s3Service.downloadBuffer(s3Key);

  // Validate it's a PDF
  if (!buffer.slice(0, 4).toString() === '%PDF') {
    throw new Error('Invalid PDF: file does not start with %PDF header');
  }

  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.pdf`;
  const filePath = path.join(TMP_DIR, filename);

  await fs.writeFile(filePath, buffer);

  return { filePath, buffer };
}

/**
 * Get PDF info (page count, file size)
 * @param {Buffer|string} input - PDF buffer or file path
 * @returns {Promise<{pageCount: number, fileSize: number}>}
 */
async function getPdfInfo(input) {
  let buffer;

  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else {
    buffer = await fs.readFile(input);
  }

  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();

  return {
    pageCount,
    fileSize: buffer.length,
    fileSizeMb: buffer.length / (1024 * 1024),
  };
}

/**
 * Truncate a PDF to a maximum number of pages
 * @param {Buffer|string} input - PDF buffer or file path
 * @param {number} maxPages - Maximum number of pages
 * @returns {Promise<{buffer: Buffer, originalPages: number, truncatedPages: number}>}
 */
async function truncatePdf(input, maxPages = 40) {
  let buffer;

  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else {
    buffer = await fs.readFile(input);
  }

  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const originalPages = pdfDoc.getPageCount();

  if (originalPages <= maxPages) {
    return {
      buffer,
      originalPages,
      truncatedPages: originalPages,
      wasTruncated: false,
    };
  }

  // Create a new PDF with only the first maxPages
  const newPdfDoc = await PDFDocument.create();
  const pagesToCopy = await newPdfDoc.copyPages(
    pdfDoc,
    Array.from({ length: maxPages }, (_, i) => i)
  );

  for (const page of pagesToCopy) {
    newPdfDoc.addPage(page);
  }

  const newBuffer = Buffer.from(await newPdfDoc.save());

  return {
    buffer: newBuffer,
    originalPages,
    truncatedPages: maxPages,
    wasTruncated: true,
  };
}

/**
 * Save a truncated PDF to temp file
 * @param {Buffer} buffer - PDF buffer
 * @returns {Promise<string>} - Path to saved file
 */
async function saveTruncatedPdf(buffer) {
  await ensureTmpDir();

  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}-truncated.pdf`;
  const filePath = path.join(TMP_DIR, filename);

  await fs.writeFile(filePath, buffer);

  return filePath;
}

/**
 * Clean up a temp file
 * @param {string} filePath - Path to file to delete
 */
async function cleanupTmpFile(filePath) {
  try {
    await fs.unlink(filePath);
    console.log(`[PDF Service] Cleaned up temp file: ${filePath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File already deleted, that's fine
      console.log(`[PDF Service] Temp file already deleted: ${filePath}`);
    } else {
      console.warn(`[PDF Service] Could not delete temp file: ${filePath}`, error.message);
    }
  }
}

/**
 * Clean up all temp files in the processing directory
 * Call this on server startup to ensure no leftover files
 */
async function cleanupAllTmpFiles() {
  try {
    await ensureTmpDir();
    const files = await fs.readdir(TMP_DIR);

    for (const file of files) {
      const filePath = path.join(TMP_DIR, file);
      try {
        await fs.unlink(filePath);
        console.log(`[PDF Service] Cleaned up leftover temp file: ${filePath}`);
      } catch (err) {
        console.warn(`[PDF Service] Could not delete leftover file: ${filePath}`, err.message);
      }
    }

    if (files.length > 0) {
      console.log(`[PDF Service] Cleaned up ${files.length} leftover temp files`);
    }
  } catch (error) {
    console.warn('[PDF Service] Could not clean up temp directory:', error.message);
  }
}

/**
 * Check if a file needs Mathpix conversion (too large for direct AI processing)
 * @param {number} fileSizeBytes - File size in bytes
 * @returns {boolean}
 */
function needsMathpixConversion(fileSizeBytes) {
  const maxSizeMb = config.reader?.maxFileSizeMb || 5;
  return fileSizeBytes > maxSizeMb * 1024 * 1024;
}

/**
 * Prepare a PDF for processing
 * Downloads from S3, checks size, truncates if needed
 * @param {string} s3Key - S3 object key
 * @returns {Promise<{filePath: string, pageCount: number, fileSize: number, wasTruncated: boolean, needsMathpix: boolean}>}
 */
async function preparePdfForProcessing(s3Key) {
  const maxPages = config.reader?.maxPageCount || 40;

  // Download from S3
  const { filePath: originalPath, buffer: originalBuffer } = await downloadPdfToTmp(s3Key);

  try {
    // Get PDF info
    const info = await getPdfInfo(originalBuffer);

    // Check if truncation is needed
    const { buffer: processedBuffer, originalPages, truncatedPages, wasTruncated } = await truncatePdf(
      originalBuffer,
      maxPages
    );

    let finalPath = originalPath;

    // If truncated, save the truncated version and clean up original
    if (wasTruncated) {
      finalPath = await saveTruncatedPdf(processedBuffer);
      await cleanupTmpFile(originalPath);
    }

    // Check if it needs Mathpix conversion
    const needsMathpix = needsMathpixConversion(processedBuffer.length);

    return {
      filePath: finalPath,
      buffer: processedBuffer,
      pageCount: truncatedPages,
      originalPageCount: originalPages,
      fileSize: processedBuffer.length,
      fileSizeMb: processedBuffer.length / (1024 * 1024),
      wasTruncated,
      needsMathpix,
    };
  } catch (error) {
    // Cleanup on error
    await cleanupTmpFile(originalPath);
    throw error;
  }
}

module.exports = {
  downloadPdfToTmp,
  getPdfInfo,
  truncatePdf,
  saveTruncatedPdf,
  cleanupTmpFile,
  cleanupAllTmpFiles,
  needsMathpixConversion,
  preparePdfForProcessing,
  ensureTmpDir,
  TMP_DIR,
};
