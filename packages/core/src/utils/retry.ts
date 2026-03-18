import { TZPayError } from '../errors/TZPayError';
import { TZPayErrorCode } from '../types';

export interface RetryOptions {
  maxAttempts: number;
  /** Initial delay in ms. Doubles each attempt. Default: 500 */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default: 10000 */
  maxDelayMs?: number;
  /** Error codes that should NOT be retried (e.g. invalid credentials) */
  noRetryOn?: TZPayErrorCode[];
}

const DEFAULT_NO_RETRY = [
  TZPayErrorCode.INVALID_CREDENTIALS,
  TZPayErrorCode.INVALID_PHONE_NUMBER,
  TZPayErrorCode.INVALID_AMOUNT,
  TZPayErrorCode.INVALID_CURRENCY,
  TZPayErrorCode.MISSING_REQUIRED_FIELD,
  TZPayErrorCode.UNSUPPORTED_OPERATION,
  TZPayErrorCode.CONFIGURATION_ERROR,
  TZPayErrorCode.INSUFFICIENT_FUNDS,
];

/**
 * Retries an async operation with exponential backoff.
 * Automatically skips retry for non-recoverable errors.
 *
 * @example
 * const result = await withRetry(() => provider.requestPayment(req), { maxAttempts: 3 });
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    noRetryOn = DEFAULT_NO_RETRY,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;

      // Don't retry on known non-recoverable errors
      if (err instanceof TZPayError && noRetryOn.includes(err.code)) {
        throw err;
      }

      if (attempt === maxAttempts) break;

      // Exponential backoff with jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = Math.random() * 200;
      await sleep(delay + jitter);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
