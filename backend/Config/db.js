const mongoose = require('mongoose');
const config = require('./index');
const logger = require('./logger');

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    isConnected = true;
    logger.info(`MongoDB connected: ${mongoose.connection.host}`);

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger.warn('MongoDB disconnected — will retry on next request');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB error:', err);
    });
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    throw err;
  }
}

async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info('MongoDB disconnected gracefully');
}

module.exports = { connectDB, disconnectDB };