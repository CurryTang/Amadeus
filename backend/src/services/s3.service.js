const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

const storageConfig = config.objectStorage || {};
const provider = String(storageConfig.provider || 'aws-s3').toLowerCase();
const bucket = storageConfig.bucket || config.aws?.s3Bucket;
const region = storageConfig.region || config.aws?.region || 'us-east-1';
const endpoint = String(storageConfig.endpoint || config.aws?.endpoint || '').trim();
const forcePathStyle = Boolean(storageConfig.forcePathStyle || config.aws?.forcePathStyle);
const publicBaseUrl = String(storageConfig.publicBaseUrl || config.aws?.publicBaseUrl || '').trim();

const clientOptions = {
  region,
};
if (storageConfig.accessKeyId && storageConfig.secretAccessKey) {
  clientOptions.credentials = {
    accessKeyId: storageConfig.accessKeyId,
    secretAccessKey: storageConfig.secretAccessKey,
  };
}
if (endpoint) {
  clientOptions.endpoint = endpoint;
}
if (forcePathStyle) {
  clientOptions.forcePathStyle = true;
}

const s3Client = new S3Client(clientOptions);

const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

function sanitizeEndpoint(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildObjectUrl(key) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  if (publicBaseUrl) {
    return `${sanitizeEndpoint(publicBaseUrl)}/${encodedKey}`;
  }

  if (!endpoint) {
    // AWS S3 default endpoint layout
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
  }

  const normalizedEndpoint = sanitizeEndpoint(endpoint);
  if (forcePathStyle || provider === 'minio') {
    return `${normalizedEndpoint}/${bucket}/${encodedKey}`;
  }

  try {
    const parsed = new URL(normalizedEndpoint);
    return `${parsed.protocol}//${bucket}.${parsed.host}/${encodedKey}`;
  } catch (_) {
    return `${normalizedEndpoint}/${bucket}/${encodedKey}`;
  }
}

function assertStorageReady() {
  if (!bucket) {
    throw new Error('Object storage bucket is not configured. Set OBJECT_STORAGE_BUCKET.');
  }
}

/**
 * Generate a presigned URL for uploading a file to S3
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<{uploadUrl: string, key: string}>}
 */
async function generatePresignedUploadUrl(key, contentType) {
  assertStorageReady();
  const command = new PutObjectCommand({
    Bucket: bucket,
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
  assertStorageReady();
  const command = new GetObjectCommand({
    Bucket: bucket,
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
  assertStorageReady();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  const location = buildObjectUrl(key);

  return { key, location };
}

/**
 * Delete an object from S3
 * @param {string} key - S3 object key
 * @returns {Promise<void>}
 */
async function deleteObject(key) {
  assertStorageReady();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
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
  assertStorageReady();
  const command = new GetObjectCommand({
    Bucket: bucket,
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

/**
 * List all object keys under a given S3 prefix (paginated).
 * @param {string} prefix - S3 key prefix, e.g. "runs/run_abc123/"
 * @param {number} [maxKeys=10000]
 * @returns {Promise<string[]>}
 */
async function listObjectKeysByPrefix(prefix, maxKeys = 10000) {
  assertStorageReady();
  const keys = [];
  let continuationToken;
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(1000, maxKeys - keys.length),
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    });
    // eslint-disable-next-line no-await-in-loop
    const response = await s3Client.send(command);
    for (const obj of (response.Contents || [])) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
  } while (continuationToken && keys.length < maxKeys);
  return keys;
}

/**
 * Delete all objects under a given S3 prefix (batch delete, up to maxKeys).
 * @param {string} prefix
 * @param {number} [maxKeys=10000]
 * @returns {Promise<{deleted: number, failed: number}>}
 */
async function deleteObjectsByPrefix(prefix, maxKeys = 10000) {
  assertStorageReady();
  const keys = await listObjectKeysByPrefix(prefix, maxKeys);
  let deleted = 0;
  let failed = 0;
  // S3 batch delete supports up to 1000 keys per request
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await s3Client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      }));
      failed += (resp.Errors || []).length;
      deleted += batch.length - (resp.Errors || []).length;
    } catch (_) {
      failed += batch.length;
    }
  }
  return { deleted, failed };
}

module.exports = {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  uploadBuffer,
  downloadBuffer,
  deleteObject,
  deleteObjectsByPrefix,
  listObjectKeysByPrefix,
  generateS3Key,
};
