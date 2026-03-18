import {
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
  Provider,
  TransactionStatus,
  Currency,
  TZPayErrorCode,
} from '../types';
import { TZPayError } from '../errors/TZPayError';
import { BaseProvider } from './BaseProvider';
import { validatePaymentRequest, generateTransactionId, nowISO } from '../utils/validation';
import * as crypto from 'crypto';

// ── HaloPesa API Response Shapes ───────────────────────────────────────────

interface HaloPesaPaymentResponse {
  ResponseCode: string;
  ResponseDesc: string;
  Data?: {
    OrderID: string;
    PaymentRef?: string;
  };
}

interface HaloPesaStatusResponse {
  ResponseCode: string;
  ResponseDesc: string;
  Data?: {
    OrderID: string;
    Status: string;
    Amount?: string;
    MSISDN?: string;
    TransID?: string;
  };
}

interface HaloPesaDisbursementResponse {
  ResponseCode: string;
  ResponseDesc: string;
  Data?: {
    TransID: string;
    OrderID?: string;
  };
}

// ── HaloPesa Provider ──────────────────────────────────────────────────────

const HALOPESA_SANDBOX_URL = 'https://apigw.halopesa.co.tz/sandbox';
const HALOPESA_PRODUCTION_URL = 'https://apigw.halopesa.co.tz';

/**
 * HaloPesa Provider (TTCL Tanzania)
 *
 * Uses HMAC-SHA256 request signing instead of OAuth tokens.
 * Sandbox: Contact HaloPesa developer support for sandbox access.
 *
 * Required credentials:
 *   - apiKey:            Your HaloPesa API Key (MerchantID)
 *   - apiSecret:         Your HaloPesa Secret Key (for HMAC signing)
 *   - extra.merchantId:  Your merchant ID (same as apiKey usually)
 *   - extra.callbackUrl: Your payment callback URL
 */
export class HaloPesaProvider extends BaseProvider {
  private get baseUrl(): string {
    return this.getBaseUrl(HALOPESA_SANDBOX_URL, HALOPESA_PRODUCTION_URL);
  }

  // ── Request Signing ────────────────────────────────────────────────────

  /**
   * HaloPesa uses HMAC-SHA256 signing instead of OAuth.
   * Signature = HMAC-SHA256(timestamp + merchantId + requestBody, secretKey)
   */
  private signRequest(body: string, timestamp: string): string {
    const merchantId = this.config.credentials.extra?.merchantId ?? this.config.credentials.apiKey;
    const message = `${timestamp}${merchantId}${body}`;
    return crypto
      .createHmac('sha256', this.config.credentials.apiSecret ?? '')
      .update(message)
      .digest('hex');
  }

  private signedHeaders(body: string): Record<string, string> {
    const timestamp = new Date().toISOString();
    const merchantId = this.config.credentials.extra?.merchantId ?? this.config.credentials.apiKey;
    const signature = this.signRequest(body, timestamp);

    return {
      'X-Merchant-ID': merchantId,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'Content-Type': 'application/json',
    };
  }

  // ── requestPayment (C2B Push) ──────────────────────────────────────────

  async requestPayment(req: PaymentRequest): Promise<PaymentResponse> {
    validatePaymentRequest(req);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();
    const callbackUrl = req.callbackUrl ?? this.config.credentials.extra?.callbackUrl;

    if (!callbackUrl) {
      throw new TZPayError({
        code: TZPayErrorCode.CONFIGURATION_ERROR,
        message: 'HaloPesa requires a callbackUrl in the request or credentials.extra.callbackUrl',
        provider: Provider.HALOPESA,
      });
    }

    return this.retry(async () => {
      const payload = {
        OrderID: req.reference,
        MSISDN: phoneNumber,
        Amount: String(req.amount),
        Currency: req.currency,
        Description: req.description ?? req.reference,
        CallBackURL: callbackUrl,
      };

      const bodyStr = JSON.stringify(payload);
      const headers = this.signedHeaders(bodyStr);

      const response = await this.post<HaloPesaPaymentResponse>(
        `${this.baseUrl}/payment/request`,
        payload,
        { headers }
      );

      const success = response.ResponseCode === '0' || response.ResponseCode === '200';

      if (!success) {
        throw TZPayError.providerError(
          response.ResponseDesc,
          Provider.HALOPESA,
          response.ResponseCode,
          response as unknown as Record<string, unknown>
        );
      }

      return {
        transactionId,
        providerTransactionId: response.Data?.OrderID ?? response.Data?.PaymentRef,
        status: TransactionStatus.PENDING,
        provider: Provider.HALOPESA,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.ResponseDesc,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── sendMoney (B2C Disbursement) ───────────────────────────────────────

  async sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse> {
    validatePaymentRequest(req as PaymentRequest);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();

    return this.retry(async () => {
      const payload = {
        OrderID: req.reference,
        MSISDN: phoneNumber,
        Amount: String(req.amount),
        Currency: req.currency,
        Remarks: req.description ?? req.reference,
      };

      const bodyStr = JSON.stringify(payload);
      const headers = this.signedHeaders(bodyStr);

      const response = await this.post<HaloPesaDisbursementResponse>(
        `${this.baseUrl}/disbursement/pay`,
        payload,
        { headers }
      );

      const success = response.ResponseCode === '0' || response.ResponseCode === '200';

      if (!success) {
        throw TZPayError.providerError(
          response.ResponseDesc,
          Provider.HALOPESA,
          response.ResponseCode
        );
      }

      return {
        transactionId,
        providerTransactionId: response.Data?.TransID,
        status: TransactionStatus.SUCCESS,
        provider: Provider.HALOPESA,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.ResponseDesc,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── getTransactionStatus ───────────────────────────────────────────────

  async getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse> {
    return this.retry(async () => {
      const payload = { OrderID: req.providerTransactionId ?? req.transactionId };
      const bodyStr = JSON.stringify(payload);
      const headers = this.signedHeaders(bodyStr);

      const response = await this.post<HaloPesaStatusResponse>(
        `${this.baseUrl}/payment/status`,
        payload,
        { headers }
      );

      const txn = response.Data;

      return {
        transactionId: req.transactionId,
        providerTransactionId: txn?.TransID ?? txn?.OrderID,
        status: this.mapHaloStatus(txn?.Status, response.ResponseCode),
        provider: Provider.HALOPESA,
        amount: txn?.Amount ? Number(txn.Amount) : undefined,
        currency: Currency.TZS,
        phoneNumber: txn?.MSISDN,
        message: response.ResponseDesc,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── refundTransaction ──────────────────────────────────────────────────

  async refundTransaction(_req: RefundRequest): Promise<RefundResponse> {
    throw TZPayError.unsupportedOperation('refundTransaction', Provider.HALOPESA);
  }

  // ── getBalance ─────────────────────────────────────────────────────────

  async getBalance(): Promise<BalanceResponse> {
    throw TZPayError.unsupportedOperation('getBalance', Provider.HALOPESA);
  }

  // ── verifyPhoneNumber ──────────────────────────────────────────────────

  async verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse> {
    try {
      const normalized = this.normalizePhone(phoneNumber);
      const prefix = normalized.slice(3, 6);
      const haloPrefixes = [
        '620','621','622','623','624','625','626','627','628','629',
        '630','631','632','633',
      ];
      const isHalo = haloPrefixes.includes(prefix);

      return {
        phoneNumber: normalized,
        isValid: true,
        isRegistered: isHalo,
        provider: isHalo ? Provider.HALOPESA : undefined,
        message: isHalo ? 'Valid HaloPesa number' : 'Valid number but not on HaloPesa/TTCL network',
      };
    } catch {
      return { phoneNumber, isValid: false, isRegistered: false, message: 'Invalid phone number format' };
    }
  }

  // ── parseWebhook ───────────────────────────────────────────────────────

  parseWebhook(payload: Record<string, unknown>): WebhookPayload {
    const data = (payload.Data as Record<string, unknown>) ?? payload;
    return {
      provider: Provider.HALOPESA,
      transactionId: String(data.OrderID ?? payload.OrderID ?? ''),
      providerTransactionId: String(data.TransID ?? payload.TransID ?? ''),
      status: this.mapHaloStatus(String(data.Status ?? payload.Status ?? ''), String(payload.ResponseCode ?? '')),
      amount: Number(data.Amount ?? payload.Amount ?? 0),
      currency: Currency.TZS,
      phoneNumber: String(data.MSISDN ?? payload.MSISDN ?? ''),
      reference: String(data.OrderID ?? payload.OrderID ?? ''),
      timestamp: nowISO(),
      raw: payload,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private mapHaloStatus(status?: string, responseCode?: string): TransactionStatus {
    const s = (status ?? '').toUpperCase();
    if (s === 'SUCCESS' || s === 'COMPLETED') return TransactionStatus.SUCCESS;
    if (s === 'PENDING' || s === 'PROCESSING' || s === 'INITIATED') return TransactionStatus.PENDING;
    if (s === 'FAILED' || s === 'FAILURE' || s === 'ERROR') return TransactionStatus.FAILED;
    if (s === 'CANCELLED' || s === 'EXPIRED') return TransactionStatus.CANCELLED;
    // Only fall back to responseCode when no status present
    if (!s) {
      if (responseCode === '0' || responseCode === '200') return TransactionStatus.SUCCESS;
    }
    return TransactionStatus.PENDING;
  }
}
