const config = require('../Config');
const logger = require('../Config/logger');

/**
 * Central error handler — must be registered last in Express.
 */
function errorHandler(err, req, res, next) {
  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ error: 'Validation failed', details: messages });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ error: `Duplicate value for ${field}` });
  }

  // Mongoose cast error (bad ObjectId etc.)
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid value for ${err.path}` });
  }

  // Multer file size
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 10 MB)' });
  }

  const status = err.status || err.statusCode || 500;
  const message = config.env === 'production' && status === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';

  if (status >= 500) logger.error(err);

  res.status(status).json({ error: message });
}

/**
 * 404 handler — place just before errorHandler.
 */
function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

/**
 * Require X-Admin-Token header.
 */
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== config.adminToken) {
    return res.status(403).json({ error: 'Forbidden — invalid admin token' });
  }
  next();
}

/**
 * Wrap async route handlers to forward errors to errorHandler.
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, notFound, requireAdmin, asyncHandler };