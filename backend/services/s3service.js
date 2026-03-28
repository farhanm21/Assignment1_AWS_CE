/**
 * S3 Service
 * ----------
 * Handles all AWS S3 operations:
 *   - Mirror event poster images from external URLs
 *   - Upload user-submitted media (via server or pre-signed POST)
 *   - Store JSON event snapshots for audit / backup
 *   - Generate pre-signed GET / POST URLs
 *
 * On EC2 with an attached IAM Role, no credentials are needed —
 * the SDK resolves them from the instance metadata endpoint automatically.
 */

const AWS = require('aws-sdk');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const config = require('../Config');
const logger = require('../Config/logger');

// ── SDK init ──────────────────────────────────────────────────────────────────
const awsConfig = { region: config.aws.region };
if (config.aws.accessKeyId && config.aws.secretAccessKey) {
  awsConfig.accessKeyId = config.aws.accessKeyId;
  awsConfig.secretAccessKey = config.aws.secretAccessKey;
}
const s3 = new AWS.S3(awsConfig);

const BUCKET = config.aws.s3Bucket;

// ── Helpers ───────────────────────────────────────────────────────────────────

function publicUrl(key) {
  if (config.aws.cloudfrontDomain) {
    return `https://${config.aws.cloudfrontDomain}/${key}`;
  }
  return `https://${BUCKET}.s3.${config.aws.region}.amazonaws.com/${key}`;
}

async function presignedGetUrl(key, expiresSeconds = 86400) {
  try {
    return await s3.getSignedUrlPromise('getObject', {
      Bucket: BUCKET,
      Key: key,
      Expires: expiresSeconds,
    });
  } catch (err) {
    logger.warn(`Could not generate presigned GET URL: ${err.message}`);
    return publicUrl(key);
  }
}

// ── Event poster mirroring ────────────────────────────────────────────────────

/**
 * Download an image from a URL and upload it to S3 under event-posters/.
 * @returns {{ key: string, url: string }}
 */
async function uploadImageFromUrl(imageUrl, externalId) {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
  const contentType = response.headers['content-type']?.split(';')[0] || 'image/jpeg';
  const ext = mime.extension(contentType) || 'jpg';
  const key = `event-posters/${externalId}.${ext}`;

  await s3.putObject({
    Bucket: BUCKET,
    Key: key,
    Body: Buffer.from(response.data),
    ContentType: contentType,
  }).promise();

  logger.info(`Mirrored event poster → s3://${BUCKET}/${key}`);
  return { key, url: publicUrl(key) };
}

// ── User media uploads ────────────────────────────────────────────────────────

/**
 * Upload a Buffer / stream directly to S3 (small files).
 * @returns {{ s3Key, s3Url, originalFilename, contentType, fileSize }}
 */
async function uploadFile({ buffer, originalFilename, contentType, eventId, uploader }) {
  const datePrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `uploads/${datePrefix}/${uuidv4()}-${safeName}`;

  await s3.putObject({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }).promise();

  logger.info(`Uploaded user media → s3://${BUCKET}/${key}`);

  return {
    s3Key: key,
    s3Url: await presignedGetUrl(key),
    originalFilename,
    contentType,
    fileSize: buffer.length,
  };
}

/**
 * Generate a pre-signed POST URL so the browser can upload directly to S3,
 * bypassing the application server entirely (reduces EC2 load).
 * @returns {{ url, fields, key }}
 */
async function getPresignedUploadUrl({ filename, contentType, eventId } = {}) {
  const datePrefix = new Date().toISOString().slice(0, 7);
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `uploads/${datePrefix}/${uuidv4()}-${safeName}`;

  const params = {
    Bucket: BUCKET,
    Fields: { key, 'Content-Type': contentType },
    Conditions: [
      { 'Content-Type': contentType },
      ['content-length-range', 1, 10 * 1024 * 1024], // max 10 MB
    ],
    Expires: 3600,
  };

  return new Promise((resolve, reject) => {
    s3.createPresignedPost(params, (err, data) => {
      if (err) return reject(err);
      resolve({ url: data.url, fields: data.fields, key });
    });
  });
}

// ── Event snapshot ────────────────────────────────────────────────────────────

/**
 * Write a JSON snapshot of all current events to S3 (optional audit trail).
 */
async function storeEventsSnapshot(events) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `snapshots/events-${timestamp}.json`;
  const payload = JSON.stringify({ events, generatedAt: new Date().toISOString() });

  await s3.putObject({
    Bucket: BUCKET,
    Key: key,
    Body: payload,
    ContentType: 'application/json',
  }).promise();

  logger.info(`Stored event snapshot → s3://${BUCKET}/${key}`);
}

module.exports = {
  uploadImageFromUrl,
  uploadFile,
  getPresignedUploadUrl,
  storeEventsSnapshot,
  presignedGetUrl,
  publicUrl,
};