/**
 * TZ-Pay-Connect Core Types
 * These unified interfaces abstract ALL provider differences.
 * Developers write to these types — never to provider-specific types.
 */

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export enum Provider {
  MPESA = 'mpesa',
  TIGO = 'tigo',
  AIRTEL = 'airtel',
  AZAMPAY = 'azampay',
  HALOPESA = 'halopesa',
}

export enum Environment {
  SANDBOX = 'sandbox',
  PRODUCTION = 'production',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMEOUT = 'TIMEOUT',
  QUEUED = 'QUEUED',
}

export enum Currency {
  TZS = 'TZS',
}

export enum TransactionType {
  C2B = 'C2B', // Customer to Business (push payment)
  B2C = 'B2C', // Business to Customer (payout)
  B2B = 'B2B', // Business to Business
  REVERSAL = 'REVERSAL',
}

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

export interface ProviderCredentials {
  apiKey: string;
  apiSecret?: string;
  /** Provider-specific extra fields (e.g. shortCode, passKey) */
  extra?: Record<string, string>;
}

export interface TZPayConnectConfig {
  provider: Provider;
  credentials: ProviderCredentials;
  environment: Environment;
  /** Request timeout in ms. Default: 30000 */
  timeout?: number;
  /** Max retry attempts on network failure. Default: 3 */
  maxRetries?: number;
  /** Enable structured audit logging. Default: true */
  auditLogging?: boolean;
  /** Custom base URL (useful for testing / self-hosted gateway) */
  baseUrl?: string;
}

// ─────────────────────────────────────────────
// PAYMENT REQUEST & RESPONSE
// ─────────────────────────────────────────────

export interface PaymentRequest {
  /** Amount in TZS (whole number, no decimals) */
  amount: number;
  currency: Currency;
  /** Phone number in E.164 format: 255XXXXXXXXX */
  phoneNumber: string;
  /** Your internal reference (order ID, invoice ID, etc.) */
  reference: string;
  /** Human-readable description shown to customer */
  description?: string;
  /** Callback URL for async payment notifications */
  callbackUrl?: string;
  /** Your internal metadata — stored in audit log, not sent to provider */
  metadata?: Record<string, unknown>;
}

export interface PaymentResponse {
  /** TZ-Pay-Connect internal transaction ID */
  transactionId: string;
  /** Provider's own transaction/reference ID */
  providerTransactionId?: string;
  status: TransactionStatus;
  provider: Provider;
  amount: number;
  currency: Currency;
  phoneNumber: string;
  reference: string;
  /** Human readable message from provider */
  message?: string;
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** Raw provider response — useful for debugging */
  raw?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// SEND MONEY (B2C)
// ─────────────────────────────────────────────

export interface SendMoneyRequest {
  amount: number;
  currency: Currency;
  phoneNumber: string;
  reference: string;
  description?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface SendMoneyResponse extends PaymentResponse {}

// ─────────────────────────────────────────────
// TRANSACTION STATUS
// ─────────────────────────────────────────────

export interface TransactionStatusRequest {
  transactionId: string;
  /** If you have the provider's own ID, you can use that too */
  providerTransactionId?: string;
}

export interface TransactionStatusResponse {
  transactionId: string;
  providerTransactionId?: string;
  status: TransactionStatus;
  provider: Provider;
  amount?: number;
  currency?: Currency;
  phoneNumber?: string;
  reference?: string;
  message?: string;
  timestamp: string;
  completedAt?: string;
  raw?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// REFUND / REVERSAL
// ─────────────────────────────────────────────

export interface RefundRequest {
  transactionId: string;
  amount?: number; // partial refund — if omitted, full refund
  reason?: string;
  reference: string;
}

export interface RefundResponse {
  refundId: string;
  originalTransactionId: string;
  status: TransactionStatus;
  amount: number;
  currency: Currency;
  message?: string;
  timestamp: string;
  raw?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// ACCOUNT / BALANCE
// ─────────────────────────────────────────────

export interface BalanceResponse {
  provider: Provider;
  balance: number;
  currency: Currency;
  accountName?: string;
  timestamp: string;
  raw?: Record<string, unknown>;
}

export interface PhoneVerificationResponse {
  phoneNumber: string;
  isValid: boolean;
  isRegistered: boolean;
  provider?: Provider;
  accountName?: string;
  message?: string;
}

// ─────────────────────────────────────────────
// WEBHOOKS / CALLBACKS
// ─────────────────────────────────────────────

export interface WebhookPayload {
  provider: Provider;
  transactionId: string;
  providerTransactionId?: string;
  status: TransactionStatus;
  amount: number;
  currency: Currency;
  phoneNumber: string;
  reference: string;
  timestamp: string;
  raw: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  provider: Provider;
  transactionType: TransactionType;
  transactionId?: string;
  phoneNumber: string;
  amount: number;
  currency: Currency;
  status: TransactionStatus;
  reference: string;
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────

export enum TZPayErrorCode {
  // Network
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  // Auth
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  // Validation
  INVALID_PHONE_NUMBER = 'INVALID_PHONE_NUMBER',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_CURRENCY = 'INVALID_CURRENCY',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  // Provider
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  // Transaction
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  REFUND_NOT_SUPPORTED = 'REFUND_NOT_SUPPORTED',
  // SDK
  UNSUPPORTED_OPERATION = 'UNSUPPORTED_OPERATION',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// ─────────────────────────────────────────────
// PROVIDER INTERFACE — every adapter implements this
// ─────────────────────────────────────────────

export interface IProvider {
  readonly name: Provider;
  readonly environment: Environment;

  requestPayment(req: PaymentRequest): Promise<PaymentResponse>;
  sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse>;
  getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse>;
  refundTransaction(req: RefundRequest): Promise<RefundResponse>;
  getBalance(): Promise<BalanceResponse>;
  verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse>;
  parseWebhook(payload: Record<string, unknown>): WebhookPayload;
}
