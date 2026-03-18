import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { authMiddleware } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { paymentsRouter } from './routes/payments';
import { webhooksRouter } from './routes/webhooks';
import { healthRouter } from './routes/health';

export function createApp(): express.Application {
  const app = express();

  // ── Security headers ──────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ──────────────────────────────────────────────────────────────
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['*'];

  app.use(
    cors({
      origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    })
  );

  // ── Body parsing ──────────────────────────────────────────────────────
  app.use(express.json({ limit: '10kb' }));

  // ── Rate limiting ─────────────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.RATE_LIMIT_MAX ?? 100),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please wait before retrying.',
      },
    },
  });

  app.use('/payments', limiter);

  // ── Request ID ────────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    req.headers['x-request-id'] =
      req.headers['x-request-id'] ?? `gw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    next();
  });

  // ── Routes ────────────────────────────────────────────────────────────

  // Health check — no auth required
  app.use('/health', healthRouter);

  // Webhooks — no auth (providers call these directly)
  // Security is via provider-specific signature validation (future enhancement)
  app.use('/webhooks', webhooksRouter);

  // Payment endpoints — auth required
  app.use('/payments', authMiddleware, paymentsRouter);

  // ── Error handling ────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
