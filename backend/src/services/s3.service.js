const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

/**
 * Generate a presigned URL for uploading a file to S3
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<{uploadUrl: string, key: string}>}
 */
async function generatePresignedUploadUrl(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY,
  });

  return { uploadUrl, key };
}

/**
 * Generate a presigned URL for downloading a file from S3
 * @param {string} key - S3 object key
 * @returns {Promise<string>}
 */
async function generatePresignedDownloadUrl(key) {
  const command = new GetObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  const downloadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY,
  });

  return downloadUrl;
}

/**
 * Upload a buffer directly to S3
 * @param {Buffer} buffer - File buffer
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<{key: string, location: string}>}
 */
async function uploadBuffer(buffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  const location = `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;

  return { key, location };
}

/**
 * Delete an object from S3
 * @param {string} key - S3 object key
 * @returns {Promise<void>}
 */
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Download an object from S3 as a buffer
 * @param {string} key - S3 object key
 * @returns {Promise<Buffer>}
 */
async function downloadBuffer(key) {
  const command = new GetObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  const response = await s3Client.send(command);

  // Convert stream to buffer
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Generate a unique S3 key for a document
 * @param {string} originalFilename - Original filename
 * @param {string} userId - User ID
 * @returns {string}
 */
function generateS3Key(originalFilename, userId = 'default_user') {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${userId}/${timestamp}-${randomStr}-${sanitizedFilename}`;
}

module.exports = {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  uploadBuffer,
  downloadBuffer,
  deleteObject,
  generateS3Key,
};
