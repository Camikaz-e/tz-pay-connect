import { TZPayErrorCode, Provider } from '../types';

export interface TZPayErrorDetails {
  code: TZPayErrorCode;
  message: string;
  provider?: Provider;
  httpStatus?: number;
  providerCode?: string;
  raw?: Record<string, unknown>;
}

/**
 * The single error class used across all TZ-Pay-Connect operations.
 * Always carries a typed error code so developers can handle specific cases.
 *
 * @example
 * try {
 *   await tzPay.requestPayment(req);
 * } catch (err) {
 *   if (err instanceof TZPayError) {
 *     if (err.code === TZPayErrorCode.INSUFFICIENT_FUNDS) {
 *       // handle specifically
 *     }
 *   }
 * }
 */
export class TZPayError extends Error {
  public readonly code: TZPayErrorCode;
  public readonly provider?: Provider;
  public readonly httpStatus?: number;
  public readonly providerCode?: string;
  public readonly raw?: Record<string, unknown>;

  constructor(details: TZPayErrorDetails) {
    super(details.message);
    this.name = 'TZPayError';
    this.code = details.code;
    this.provider = details.provider;
    this.httpStatus = details.httpStatus;
    this.providerCode = details.providerCode;
    this.raw = details.raw;

    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TZPayError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      provider: this.provider,
      httpStatus: this.httpStatus,
      providerCode: this.providerCode,
    };
  }

  static networkError(message: string, provider?: Provider): TZPayError {
    return new TZPayError({ code: TZPayErrorCode.NETWORK_ERROR, message, provider });
  }

  static timeout(provider?: Provider): TZPayError {
    return new TZPayError({
      code: TZPayErrorCode.TIMEOUT,
      message: 'Request timed out. The provider did not respond in time.',
      provider,
    });
  }

  static invalidCredentials(provider?: Provider): TZPayError {
    return new TZPayError({
      code: TZPayErrorCode.INVALID_CREDENTIALS,
      message: 'Invalid API credentials. Check your apiKey and apiSecret.',
      provider,
    });
  }

  static invalidPhoneNumber(phoneNumber: string): TZPayError {
    return new TZPayError({
      code: TZPayErrorCode.INVALID_PHONE_NUMBER,
      message: `Invalid phone number: "${phoneNumber}". Use E.164 format: 255XXXXXXXXX`,
    });
  }

  static invalidAmount(amount: number): TZPayError {
    return new TZPayError({
      code: TZPayErrorCode.INVALID_AMOUNT,
      message: `Invalid amount: ${amount}. Must be a positive whole number in TZS.`,
    });
  }

  static providerError(
    message: string,
    provider: Provider,
    providerCode?: string,
    raw?: Record<string, unknown>
  ): TZPayError {
    return new TZPayError({
      code: TZPayErrorCode.PROVIDER_ERROR,
      message,
      provider,
      providerCode,
      raw,
    });
  }

  static unsupportedOperation(operation: string, provider: Provider): TZPayError {
    return new TZPayError({
      code: TZPayErrorCode.UNSUPPORTED_OPERATION,
      message: `"${operation}" is not supported by ${provider}.`,
      provider,
    });
  }
}
