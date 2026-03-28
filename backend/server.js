const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./Config');
const logger = require('./Config/logger');

// Routes
const eventsRouter = require('./Routes/events');
const mediaRouter  = require('./Routes/media');
const healthRouter = require('./Routes/health');

// Middleware
const { errorHandler, notFound } = require('./Middleware');

function createApp() {
  const app = express();

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin(origin, cb) {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return cb(null, true);
        if (config.cors.origins.includes('*') || config.cors.origins.includes(origin)) {
          return cb(null, true);
        }
        cb(new Error(`CORS blocked for origin: ${origin}`));
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Admin-Token'],
    })
  );

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Request logging ───────────────────────────────────────────────────────
  const morganFormat = config.env === 'production' ? 'combined' : 'dev';
  app.use(
    morgan(morganFormat, {
      stream: { write: msg => logger.http(msg.trim()) },
      // Skip health check spam in production logs
      skip: (req) => config.env === 'production' && req.path.startsWith('/api/health'),
    })
  );

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 200,                   // per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  app.use('/api', limiter);

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/health', healthRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/media',  mediaRouter);

  // ── Root redirect ─────────────────────────────────────────────────────────
  app.get('/', (_req, res) => res.redirect('/api/health'));

  // ── 404 + Error handlers (must be last) ───────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;