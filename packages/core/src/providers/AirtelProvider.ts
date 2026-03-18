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

// ── Airtel Money API Response Shapes ───────────────────────────────────────

interface AirtelAuthResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
}

interface AirtelPaymentResponse {
  data: {
    transaction: {
      id: string;
      status: string;
      airtel_money_id?: string;
    };
  };
  status: {
    code: string;
    message: string;
    result_code: string;
    success: boolean;
  };
}

interface AirtelDisbursementResponse {
  data: {
    transaction: {
      reference_id: string;
      airtel_money_id?: string;
      status: string;
    };
  };
  status: {
    code: string;
    message: string;
    result_code: string;
    success: boolean;
  };
}

interface AirtelStatusResponse {
  data: {
    transaction: {
      id: string;
      status: string;
      airtel_money_id?: string;
      message?: string;
    };
  };
  status: {
    code: string;
    message: string;
    success: boolean;
  };
}

interface AirtelBalanceResponse {
  data: {
    balance: string;
    currency: string;
  };
  status: {
    code: string;
    message: string;
    success: boolean;
  };
}

// ── Airtel Money Provider ──────────────────────────────────────────────────

const AIRTEL_SANDBOX_URL = 'https://openapiuat.airtel.africa';
const AIRTEL_PRODUCTION_URL = 'https://openapi.airtel.africa';

/**
 * Airtel Money Tanzania Provider
 *
 * Uses the Airtel Africa Open API (same API across Africa).
 * Sandbox: https://developers.airtel.africa
 *
 * Required credentials:
 *   - apiKey:       Your Airtel Client ID
 *   - apiSecret:    Your Airtel Client Secret
 *   - extra.country: Country code, default 'TZ'
 *   - extra.currency: Currency code, default 'TZS'
 */
export class AirtelProvider extends BaseProvider {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private get baseUrl(): string {
    return this.getBaseUrl(AIRTEL_SANDBOX_URL, AIRTEL_PRODUCTION_URL);
  }

  private get country(): string {
    return this.config.credentials.extra?.country ?? 'TZ';
  }

  private get currency(): string {
    return this.config.credentials.extra?.currency ?? 'TZS';
  }

  // ── Authentication ─────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 30_000)) {
      return this.accessToken;
    }

    const response = await this.post<AirtelAuthResponse>(
      `${this.baseUrl}/auth/oauth2/token`,
      {
        client_id: this.config.credentials.apiKey,
        client_secret: this.config.credentials.apiSecret,
        grant_type: 'client_credentials',
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.access_token) throw TZPayError.invalidCredentials(Provider.AIRTEL);

    this.accessToken = response.access_token;
    this.tokenExpiry = new Date(Date.now() + Number(response.expires_in) * 1000);
    return this.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'X-Country': this.country,
      'X-Currency': this.currency,
    };
  }

  // ── requestPayment (C2B Push) ──────────────────────────────────────────

  async requestPayment(req: PaymentRequest): Promise<PaymentResponse> {
    validatePaymentRequest(req);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();

    return this.retry(async () => {
      const headers = await this.authHeaders();

      const payload = {
        reference: req.reference,
        subscriber: {
          country: this.country,
          currency: this.currency,
          msisdn: phoneNumber,
        },
        transaction: {
          amount: req.amount,
          country: this.country,
          currency: this.currency,
          id: transactionId,
        },
      };

      const response = await this.post<AirtelPaymentResponse>(
        `${this.baseUrl}/merchant/v1/payments/`,
        payload,
        { headers }
      );

      if (!response.status?.success) {
        throw TZPayError.providerError(
          response.status?.message ?? 'Payment request failed',
          Provider.AIRTEL,
          response.status?.result_code,
          response as unknown as Record<string, unknown>
        );
      }

      return {
        transactionId,
        providerTransactionId: response.data?.transaction?.airtel_money_id ?? response.data?.transaction?.id,
        status: TransactionStatus.PENDING,
        provider: Provider.AIRTEL,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.status?.message,
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
      const headers = await this.authHeaders();

      const payload = {
        payee: {
          msisdn: phoneNumber,
        },
        reference: req.description ?? req.reference,
        pin: this.config.credentials.extra?.pin ?? '',
        transaction: {
          amount: req.amount,
          id: transactionId,
          type: 'B2C',
        },
      };

      const response = await this.post<AirtelDisbursementResponse>(
        `${this.baseUrl}/standard/v1/disbursements/`,
        payload,
        { headers }
      );

      if (!response.status?.success) {
        throw TZPayError.providerError(
          response.status?.message ?? 'Disbursement failed',
          Provider.AIRTEL,
          response.status?.result_code
        );
      }

      return {
        transactionId,
        providerTransactionId: response.data?.transaction?.airtel_money_id,
        status: TransactionStatus.SUCCESS,
        provider: Provider.AIRTEL,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.status?.message,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── getTransactionStatus ───────────────────────────────────────────────

  async getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse> {
    return this.retry(async () => {
      const headers = await this.authHeaders();

      const response = await this.get<AirtelStatusResponse>(
        `${this.baseUrl}/standard/v1/payments/${req.providerTransactionId ?? req.transactionId}`,
        { headers }
      );

      const txn = response.data?.transaction;

      return {
        transactionId: req.transactionId,
        providerTransactionId: txn?.airtel_money_id ?? txn?.id,
        status: this.mapAirtelStatus(txn?.status),
        provider: Provider.AIRTEL,
        currency: Currency.TZS,
        message: txn?.message ?? response.status?.message,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── refundTransaction ──────────────────────────────────────────────────

  async refundTransaction(_req: RefundRequest): Promise<RefundResponse> {
    throw TZPayError.unsupportedOperation('refundTransaction', Provider.AIRTEL);
  }

  // ── getBalance ─────────────────────────────────────────────────────────

  async getBalance(): Promise<BalanceResponse> {
    const headers = await this.authHeaders();

    const msisdn = this.config.credentials.extra?.msisdn;
    if (!msisdn) {
      throw new TZPayError({
        code: TZPayErrorCode.CONFIGURATION_ERROR,
        message: 'Airtel getBalance requires credentials.extra.msisdn',
        provider: Provider.AIRTEL,
      });
    }

    const response = await this.get<AirtelBalanceResponse>(
      `${this.baseUrl}/standard/v1/users/balance`,
      { headers }
    );

    return {
      provider: Provider.AIRTEL,
      balance: Number(response.data?.balance ?? 0),
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
      const airtelPrefixes = [
        '680','681','682','683','684','685','686','687','688','689',
        '690','691','692','693','694','695','696','697','698','699',
      ];
      const isAirtel = airtelPrefixes.includes(prefix);

      return {
        phoneNumber: normalized,
        isValid: true,
        isRegistered: isAirtel,
        provider: isAirtel ? Provider.AIRTEL : undefined,
        message: isAirtel ? 'Valid Airtel Money number' : 'Valid number but not on Airtel network',
      };
    } catch {
      return { phoneNumber, isValid: false, isRegistered: false, message: 'Invalid phone number format' };
    }
  }

  // ── parseWebhook ───────────────────────────────────────────────────────

  parseWebhook(payload: Record<string, unknown>): WebhookPayload {
    const transaction = (payload.transaction as Record<string, unknown>) ?? payload;
    return {
      provider: Provider.AIRTEL,
      transactionId: String(transaction.id ?? payload.id ?? ''),
      providerTransactionId: String(transaction.airtel_money_id ?? ''),
      status: this.mapAirtelStatus(String(transaction.status ?? payload.status ?? '')),
      amount: Number(transaction.amount ?? payload.amount ?? 0),
      currency: Currency.TZS,
      phoneNumber: String(transaction.msisdn ?? payload.msisdn ?? ''),
      reference: String(transaction.reference ?? payload.reference ?? ''),
      timestamp: nowISO(),
      raw: payload,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private mapAirtelStatus(status?: string): TransactionStatus {
    switch ((status ?? '').toUpperCase()) {
      case 'TS': // Transaction Success
      case 'SUCCESS':
      case 'COMPLETED':
        return TransactionStatus.SUCCESS;
      case 'TF': // Transaction Failed
      case 'FAILED':
      case 'FAILURE':
        return TransactionStatus.FAILED;
      case 'TP': // Transaction Pending
      case 'PENDING':
        return TransactionStatus.PENDING;
      case 'EXPIRED':
      case 'CANCELLED':
        return TransactionStatus.CANCELLED;
      default:
        return TransactionStatus.PENDING;
    }
  }
}
