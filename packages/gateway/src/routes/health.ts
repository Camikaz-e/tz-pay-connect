import { Router, Request, Response } from 'express';

export const healthRouter = Router();

const startTime = Date.now();

/**
 * GET /health
 * Health check endpoint for load balancers, Docker, and monitoring.
 *
 * @example
 * curl https://your-gateway.com/health
 * → { "status": "ok", "version": "0.1.0", "uptime": 3600 }
 */
healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    version: '0.1.0',
    environment: process.env.PROVIDER_ENV ?? 'sandbox',
    mockMode: process.env.PROVIDER_MOCK === 'true',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    providers: ['mpesa', 'tigo', 'airtel', 'azampay', 'halopesa'],
  });
});
