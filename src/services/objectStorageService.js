const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

let client = null;

function settings() {
  return {
    provider: process.env.MEDIA_STORAGE_PROVIDER || 'database',
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT || undefined,
    region: process.env.OBJECT_STORAGE_REGION || 'eu-central-1',
    bucket: process.env.OBJECT_STORAGE_BUCKET || '',
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
    prefix: String(process.env.OBJECT_STORAGE_PREFIX || 'un-platform').replace(/^\/+|\/+$/g, ''),
  };
}

function isConfigured() {
  const config = settings();
  return config.provider === 's3' && Boolean(config.bucket && config.accessKeyId && config.secretAccessKey);
}

function validateConfiguration() {
  const config = settings();
  if (!['database', 's3'].includes(config.provider)) throw new Error('Invalid MEDIA_STORAGE_PROVIDER');
  if (config.provider === 's3' && !isConfigured()) {
    throw new Error('Incomplete object storage configuration');
  }
  return config.provider;
}

function storageClient() {
  const config = settings();
  if (!isConfigured()) throw new Error('Object storage is not configured');
  if (!client) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return client;
}

async function put(key, body, contentType) {
  const config = settings();
  await storageClient().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

async function get(key) {
  const config = settings();
  const result = await storageClient().send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
}

async function remove(key) {
  const config = settings();
  await storageClient().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

function objectKey(id, filename) {
  const prefix = settings().prefix;
  return `${prefix}/${id}/${filename}`;
}

module.exports = { settings, isConfigured, validateConfiguration, put, get, remove, objectKey };
