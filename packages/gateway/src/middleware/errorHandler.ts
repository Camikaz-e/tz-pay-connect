import { Request, Response, NextFunction } from 'express';
import { TZPayError } from '@tz-pay-connect/core';

/**
 * Global error handler — catches all unhandled errors from route handlers.
 * Maps TZPayError to appropriate HTTP status codes.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Known SDK error
  if (err instanceof TZPayError) {
    const status = mapErrorCodeToStatus(err.code);
    res.status(status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        provider: err.provider,
        providerCode: err.providerCode,
      },
    });
    return;
  }

  // Unknown error — don't leak internals
  console.error('[TZPay Gateway] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    },
  });
}

function mapErrorCodeToStatus(code: string): number {
  const map: Record<string, number> = {
    INVALID_CREDENTIALS: 401,
    TOKEN_EXPIRED: 401,
    UNAUTHORIZED: 401,
    INVALID_PHONE_NUMBER: 400,
    INVALID_AMOUNT: 400,
    INVALID_CURRENCY: 400,
    MISSING_REQUIRED_FIELD: 400,
    VALIDATION_ERROR: 400,
    CONFIGURATION_ERROR: 500,
    TRANSACTION_NOT_FOUND: 404,
    UNSUPPORTED_OPERATION: 422,
    REFUND_NOT_SUPPORTED: 422,
    INSUFFICIENT_FUNDS: 402,
    DUPLICATE_TRANSACTION: 409,
    PROVIDER_UNAVAILABLE: 503,
    TIMEOUT: 504,
    NETWORK_ERROR: 502,
    PROVIDER_ERROR: 502,
    TRANSACTION_FAILED: 200, // not an HTTP error — return 200 with failed status
  };
  return map[code] ?? 500;
}

/**
 * 404 handler for unknown routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
