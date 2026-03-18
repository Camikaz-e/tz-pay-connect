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

// ── Tigo Pesa API Response Shapes ──────────────────────────────────────────

interface TigoAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface TigoPushResponse {
  ResponseCode: string;
  ResponseDescription: string;
  ReferenceID: string;
  MFSTransactionID?: string;
}

interface TigoB2CResponse {
  ResponseCode: string;
  ResponseDescription: string;
  ReferenceID: string;
  MFSTransactionID?: string;
}

interface TigoStatusResponse {
  ResponseCode: string;
  ResponseDescription: string;
  TxnID?: string;
  RefID?: string;
  TxnStatus?: string;
  Amount?: string;
  MSISDN?: string;
}

// ── Tigo Pesa Provider ─────────────────────────────────────────────────────

const TIGO_SANDBOX_URL = 'https://sandbox.tigopesa.co.tz';
const TIGO_PRODUCTION_URL = 'https://www.tigopesa.co.tz';
const TIGO_AUTH_URL = 'https://account.tigo.co.tz/v1/oauth/generate/accesstoken';

/**
 * Tigo Pesa Provider (MIC Tanzania)
 *
 * Uses the Tigo Pesa Open API.
 * Sandbox: Contact Tigo developer portal for sandbox access.
 *
 * Required credentials:
 *   - apiKey:              Your Tigo API Username (client_id)
 *   - apiSecret:           Your Tigo API Password (client_secret)
 *   - extra.accountMSISDN: Your business Tigo Pesa number
 *   - extra.accountName:   Your registered business account name
 *   - extra.billerCode:    Your biller/merchant code
 *   - extra.billerMSISDN:  Your biller MSISDN
 */
export class TigoProvider extends BaseProvider {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private get baseUrl(): string {
    return this.getBaseUrl(TIGO_SANDBOX_URL, TIGO_PRODUCTION_URL);
  }

  // ── Authentication ─────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 30_000)) {
      return this.accessToken;
    }

    const credentials = Buffer.from(
      `${this.config.credentials.apiKey}:${this.config.credentials.apiSecret}`
    ).toString('base64');

    const response = await this.post<TigoAuthResponse>(
      TIGO_AUTH_URL,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.access_token) throw TZPayError.invalidCredentials(Provider.TIGO);

    this.accessToken = response.access_token;
    this.tokenExpiry = new Date(Date.now() + response.expires_in * 1000);
    return this.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private requireExtra(fields: string[]): void {
    for (const field of fields) {
      if (!this.config.credentials.extra?.[field]) {
        throw new TZPayError({
          code: TZPayErrorCode.CONFIGURATION_ERROR,
          message: `Tigo Pesa requires credentials.extra.${field}`,
          provider: Provider.TIGO,
        });
      }
    }
  }

  // ── requestPayment (C2B Push) ──────────────────────────────────────────

  async requestPayment(req: PaymentRequest): Promise<PaymentResponse> {
    validatePaymentRequest(req);
    this.requireExtra(['billerCode', 'billerMSISDN']);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();

    return this.retry(async () => {
      const headers = await this.authHeaders();

      const payload = {
        CustomerMSISDN: phoneNumber,
        BillerMSISDN: this.config.credentials.extra!.billerMSISDN,
        Amount: String(req.amount),
        Remarks: req.description ?? req.reference,
        ReferenceID: req.reference,
      };

      const response = await this.post<TigoPushResponse>(
        `${this.baseUrl}/v1/tigo/payment-collection/request-payment`,
        payload,
        { headers }
      );

      const success = response.ResponseCode === '200' || response.ResponseCode === '0';

      if (!success) {
        throw TZPayError.providerError(
          response.ResponseDescription,
          Provider.TIGO,
          response.ResponseCode,
          response as unknown as Record<string, unknown>
        );
      }

      return {
        transactionId,
        providerTransactionId: response.MFSTransactionID ?? response.ReferenceID,
        status: TransactionStatus.PENDING,
        provider: Provider.TIGO,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.ResponseDescription,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── sendMoney (B2C) ────────────────────────────────────────────────────

  async sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse> {
    validatePaymentRequest(req as PaymentRequest);
    this.requireExtra(['accountMSISDN', 'billerCode']);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();

    return this.retry(async () => {
      const headers = await this.authHeaders();

      const payload = {
        SenderMSISDN: this.config.credentials.extra!.accountMSISDN,
        ReceiverMSISDN: phoneNumber,
        Amount: String(req.amount),
        Remarks: req.description ?? req.reference,
        ReferenceID: req.reference,
      };

      const response = await this.post<TigoB2CResponse>(
        `${this.baseUrl}/v1/tigo/disbursement/pay`,
        payload,
        { headers }
      );

      const success = response.ResponseCode === '200' || response.ResponseCode === '0';

      if (!success) {
        throw TZPayError.providerError(
          response.ResponseDescription,
          Provider.TIGO,
          response.ResponseCode
        );
      }

      return {
        transactionId,
        providerTransactionId: response.MFSTransactionID ?? response.ReferenceID,
        status: TransactionStatus.SUCCESS,
        provider: Provider.TIGO,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.ResponseDescription,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── getTransactionStatus ───────────────────────────────────────────────

  async getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse> {
    return this.retry(async () => {
      const headers = await this.authHeaders();

      const response = await this.get<TigoStatusResponse>(
        `${this.baseUrl}/v1/tigo/payment-collection/status/${req.providerTransactionId ?? req.transactionId}`,
        { headers }
      );

      return {
        transactionId: req.transactionId,
        providerTransactionId: response.TxnID ?? response.RefID,
        status: this.mapTigoStatus(response.TxnStatus, response.ResponseCode),
        provider: Provider.TIGO,
        amount: response.Amount ? Number(response.Amount) : undefined,
        currency: Currency.TZS,
        phoneNumber: response.MSISDN,
        message: response.ResponseDescription,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── refundTransaction ──────────────────────────────────────────────────

  async refundTransaction(_req: RefundRequest): Promise<RefundResponse> {
    throw TZPayError.unsupportedOperation('refundTransaction', Provider.TIGO);
  }

  // ── getBalance ─────────────────────────────────────────────────────────

  async getBalance(): Promise<BalanceResponse> {
    this.requireExtra(['accountMSISDN']);
    const headers = await this.authHeaders();

    const response = await this.get<{ Balance: string; Currency: string; ResponseCode: string }>(
      `${this.baseUrl}/v1/tigo/account/balance/${this.config.credentials.extra!.accountMSISDN}`,
      { headers }
    );

    return {
      provider: Provider.TIGO,
      balance: Number(response.Balance ?? 0),
      currency: Currency.TZS,
      timestamp: nowISO(),
      raw: response as unknown as Record<string, unknown>,
    };
  }

  // ── verifyPhoneNumber ──────────────────────────────────────────────────

  async verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse> {
    try {
      const normalized = this.normalizePhone(phoneNumber);
      const prefix = normalized.slice(3, 6);
      const tigoPrefixes = [
        '710','711','712','713','714','715','716','717','718','719',
        '650','651','652','653','654','671','672','673','674','675',
      ];
      const isTigo = tigoPrefixes.includes(prefix);

      return {
        phoneNumber: normalized,
        isValid: true,
        isRegistered: isTigo,
        provider: isTigo ? Provider.TIGO : undefined,
        message: isTigo ? 'Valid Tigo Pesa number' : 'Valid number but not on Tigo network',
      };
    } catch {
      return { phoneNumber, isValid: false, isRegistered: false, message: 'Invalid phone number format' };
    }
  }

  // ── parseWebhook ───────────────────────────────────────────────────────

  parseWebhook(payload: Record<string, unknown>): WebhookPayload {
    const status = String(payload.txnStatus ?? payload.ResponseCode ?? '');
    return {
      provider: Provider.TIGO,
      transactionId: String(payload.refID ?? payload.ReferenceID ?? ''),
      providerTransactionId: String(payload.mfsTransactionID ?? payload.TxnID ?? ''),
      status: this.mapTigoStatus(status, String(payload.ResponseCode ?? '')),
      amount: Number(payload.amount ?? 0),
      currency: Currency.TZS,
      phoneNumber: String(payload.customerMSISDN ?? payload.MSISDN ?? ''),
      reference: String(payload.refID ?? payload.ReferenceID ?? ''),
      timestamp: nowISO(),
      raw: payload,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private mapTigoStatus(txnStatus?: string, responseCode?: string): TransactionStatus {
    const s = (txnStatus ?? '').toUpperCase();
    // Check txnStatus FIRST — responseCode is HTTP-level, not transaction-level
    if (s === 'SUCCESS' || s === 'COMPLETED') return TransactionStatus.SUCCESS;
    if (s === 'PENDING' || s === 'PROCESSING') return TransactionStatus.PENDING;
    if (s === 'FAILED' || s === 'FAILURE') return TransactionStatus.FAILED;
    if (s === 'CANCELLED') return TransactionStatus.CANCELLED;
    // Only use responseCode when no txnStatus is present
    if (!s) {
      if (responseCode === '200' || responseCode === '0') return TransactionStatus.SUCCESS;
    }
    return TransactionStatus.PENDING;
  }
}
