import { Request, Response, NextFunction } from 'express';

/**
 * API Key authentication middleware.
 *
 * Reads API keys from the GATEWAY_API_KEYS environment variable
 * (comma-separated list of valid keys).
 *
 * Clients must send: Authorization: Bearer <api-key>
 * OR:                X-API-Key: <api-key>
 *
 * In DEVELOPMENT mode (NODE_ENV=development), auth is bypassed.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in development
  if (process.env.NODE_ENV === 'development' || process.env.DISABLE_AUTH === 'true') {
    next();
    return;
  }

  const apiKeysEnv = process.env.GATEWAY_API_KEYS ?? '';
  const validKeys = apiKeysEnv
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  // If no keys configured, reject everything (fail secure)
  if (validKeys.length === 0) {
    res.status(503).json({
      success: false,
      error: {
        code: 'CONFIGURATION_ERROR',
        message: 'Gateway API keys not configured. Set GATEWAY_API_KEYS environment variable.',
      },
    });
    return;
  }

  // Extract key from Bearer token or X-API-Key header
  const authHeader = req.headers.authorization ?? '';
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  let providedKey: string | undefined;

  if (authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader.trim();
  }

  if (!providedKey || !validKeys.includes(providedKey)) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.',
      },
    });
    return;
  }

  next();
}
