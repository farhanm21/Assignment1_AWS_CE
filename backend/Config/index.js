require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/unievent',
    options: {
      serverSelectionTimeoutMS: 5000,
    },
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.AWS_S3_BUCKET || 'unievent-media',
    // Intentionally undefined when not set — SDK falls back to IAM role on EC2
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
    cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN || undefined,
  },

  ticketmaster: {
    apiKey: process.env.TICKETMASTER_API_KEY || '',
    baseUrl: 'https://app.ticketmaster.com/discovery/v2',
    keyword: process.env.TICKETMASTER_KEYWORD || 'university',
    city: process.env.TICKETMASTER_CITY || 'New York',
    fetchIntervalMinutes: parseInt(process.env.EVENT_FETCH_INTERVAL_MINUTES, 10) || 30,
    maxEventsPerFetch: parseInt(process.env.MAX_EVENTS_PER_FETCH, 10) || 20,
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),
  },

  adminToken: process.env.ADMIN_TOKEN || 'dev-admin-change-me',
  storeEventsInS3: process.env.STORE_EVENTS_IN_S3 === 'true',
};

module.exports = config;