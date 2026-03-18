import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  IProvider,
  Provider,
  Environment,
  TZPayConnectConfig,
  PaymentRequest,
  PaymentResponse,
  SendMoneyRequest,
  SendMoneyResponse,
  TransactionStatusRequest,
  TransactionStatusResponse,
  RefundRequest,
  RefundResponse,
  BalanceResponse,
  PhoneVerificationResponse,
  WebhookPayload,
} from '../types';
import { TZPayError } from '../errors/TZPayError';
import { TZPayErrorCode } from '../types';
import { withRetry } from '../utils/retry';
import { AuditLogger } from '../utils/logger';
import { normalizePhoneNumber } from '../utils/validation';

/**
 * BaseProvider — every provider adapter extends this.
 * Handles: HTTP client setup, retry logic, audit logging, phone normalisation.
 * Subclasses only need to implement the abstract methods.
 */
export abstract class BaseProvider implements IProvider {
  public readonly name: Provider;
  public readonly environment: Environment;

  protected readonly config: TZPayConnectConfig;
  protected readonly http: AxiosInstance;
  protected readonly logger: AuditLogger;
  protected readonly maxRetries: number;

  constructor(config: TZPayConnectConfig) {
    this.config = config;
    this.name = config.provider;
    this.environment = config.environment;
    this.maxRetries = config.maxRetries ?? 3;

    this.http = axios.create({
      timeout: config.timeout ?? 30_000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'tz-pay-connect/0.1.0',
      },
    });

    this.logger = new AuditLogger({
      enabled: config.auditLogging ?? true,
    });

    this.setupInterceptors();
  }

  // ─── abstract methods each provider MUST implement ───────────────────────

  abstract requestPayment(req: PaymentRequest): Promise<PaymentResponse>;
  abstract sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse>;
  abstract getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse>;
  abstract refundTransaction(req: RefundRequest): Promise<RefundResponse>;
  abstract getBalance(): Promise<BalanceResponse>;
  abstract verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse>;
  abstract parseWebhook(payload: Record<string, unknown>): WebhookPayload;

  // ─── shared helpers available to all subclasses ───────────────────────────

  /**
   * Wraps a provider call with retry logic.
   */
  protected retry<T>(operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, { maxAttempts: this.maxRetries });
  }

  /**
   * Normalises a phone number — available to all providers.
   */
  protected normalizePhone(phone: string): string {
    return normalizePhoneNumber(phone);
  }

  /**
   * Makes an authenticated GET request.
   */
  protected async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.http.get<T>(url, config);
      return response.data;
    } catch (err) {
      throw this.mapAxiosError(err);
    }
  }

  /**
   * Makes an authenticated POST request.
   */
  protected async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.http.post<T>(url, data, config);
      return response.data;
    } catch (err) {
      throw this.mapAxiosError(err);
    }
  }

  /**
   * Returns the correct base URL for sandbox vs production.
   */
  protected getBaseUrl(sandboxUrl: string, productionUrl: string): string {
    if (this.config.baseUrl) return this.config.baseUrl;
    return this.environment === Environment.SANDBOX ? sandboxUrl : productionUrl;
  }

  /**
   * Converts Axios errors into typed TZPayErrors.
   */
  private mapAxiosError(err: unknown): TZPayError {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return TZPayError.timeout(this.name);
      }
      if (!err.response) {
        return TZPayError.networkError(
          `No response from ${this.name}: ${err.message}`,
          this.name
        );
      }
      const status = err.response.status;
      if (status === 401 || status === 403) {
        return TZPayError.invalidCredentials(this.name);
      }
      return TZPayError.providerError(
        err.response.data?.message ?? err.message,
        this.name,
        String(status),
        err.response.data
      );
    }
    if (err instanceof TZPayError) return err;
    return new TZPayError({
      code: TZPayErrorCode.UNKNOWN_ERROR,
      message: err instanceof Error ? err.message : String(err),
      provider: this.name,
    });
  }

  private setupInterceptors(): void {
    // Log all outgoing requests in non-production
    if (this.environment === Environment.SANDBOX) {
      this.http.interceptors.request.use((req) => {
        console.debug(`[TZPay:${this.name}] → ${req.method?.toUpperCase()} ${req.url}`);
        return req;
      });
    }
  }
}
