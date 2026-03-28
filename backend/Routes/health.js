const { Router } = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware');

const router = Router();

// ── GET /api/health ───────────────────────────────────────────────────────────
// Full health check — used by ALB target group health checks
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const dbState = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const dbOk = dbState === 1;

    const status = dbOk ? 'healthy' : 'degraded';
    const code = dbOk ? 200 : 503;

    res.status(code).json({
      status,
      database: dbOk ? 'connected' : `state:${dbState}`,
      service: 'UniEvent API',
      timestamp: new Date().toISOString(),
    });
  })
);

// ── GET /api/health/ping ──────────────────────────────────────────────────────
// Lightweight liveness probe — fast, no DB check
router.get('/ping', (_req, res) => {
  res.json({ pong: true, ts: Date.now() });
});

module.exports = router;