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
  TransactionType,
  Currency,
} from '../types';
import { TZPayError } from '../errors/TZPayError';
import { TZPayErrorCode } from '../types';
import { BaseProvider } from './BaseProvider';
import { validatePaymentRequest, generateTransactionId, nowISO } from '../utils/validation';
import { TZPayConnectConfig } from '../types';

// ── AzamPay API Response Shapes ────────────────────────────────────────────

interface AzamPayTokenResponse {
  data: {
    accessToken: string;
    expire: string;
  };
  message: string;
  success: boolean;
}

interface AzamPayCheckoutResponse {
  transactionId: string;
  message: string;
  success: boolean;
}

interface AzamPayDisbursementResponse {
  data: {
    transactionId: string;
    referenceId: string;
    amount: string;
  };
  message: string;
  success: boolean;
}

interface AzamPayTransactionStatusResponse {
  data: {
    transactionId: string;
    msisdn: string;
    amount: string;
    operatorId: string;
    reference: string;
    status: 'COMPLETED' | 'PENDING' | 'FAILED';
    operator: string;
  };
  message: string;
  success: boolean;
}

// ── AzamPay Provider ────────────────────────────────────────────────────────

const AZAMPAY_SANDBOX_URL = 'https://sandbox.azampay.co.tz';
const AZAMPAY_PRODUCTION_URL = 'https://checkout.azampay.co.tz';
const AZAMPAY_AUTH_SANDBOX = 'https://authenticator.sandbox.azampay.co.tz';
const AZAMPAY_AUTH_PRODUCTION = 'https://authenticator.azampay.co.tz';

/**
 * AzamPay Provider
 *
 * AzamPay is the most developer-friendly Tanzanian payment gateway.
 * Supports all major mobile money networks through a single API.
 * Sandbox: https://developers.azampay.co.tz
 *
 * Required credentials:
 *   - apiKey:    Your AzamPay App Name
 *   - apiSecret: Your AzamPay Client Secret
 *   - extra.clientId: Your AzamPay Client ID
 */
export class AzamPayProvider extends BaseProvider {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private get authUrl(): string {
    return this.environment === 'sandbox' ? AZAMPAY_AUTH_SANDBOX : AZAMPAY_AUTH_PRODUCTION;
  }

  private get apiUrl(): string {
    return this.getBaseUrl(AZAMPAY_SANDBOX_URL, AZAMPAY_PRODUCTION_URL);
  }

  // ── Authentication ─────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 30s buffer)
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 30_000)) {
      return this.accessToken;
    }

    const clientId = this.config.credentials.extra?.clientId;
    if (!clientId) {
      throw new TZPayError({
        code: TZPayErrorCode.CONFIGURATION_ERROR,
        message: 'AzamPay requires credentials.extra.clientId to be set.',
        provider: Provider.AZAMPAY,
      });
    }

    const response = await this.post<AzamPayTokenResponse>(
      `${this.authUrl}/AppRegistration/GenerateToken`,
      {
        appName: this.config.credentials.apiKey,
        clientId,
        clientSecret: this.config.credentials.apiSecret,
      }
    );

    if (!response.success || !response.data?.accessToken) {
      throw TZPayError.invalidCredentials(Provider.AZAMPAY);
    }

    this.accessToken = response.data.accessToken;
    this.tokenExpiry = new Date(response.data.expire);
    return this.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  // ── requestPayment (C2B Push) ──────────────────────────────────────────

  async requestPayment(req: PaymentRequest): Promise<PaymentResponse> {
    validatePaymentRequest(req);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();
    const provider = this.detectMNO(phoneNumber);

    return this.retry(async () => {
      const headers = await this.authHeaders();

      const payload = {
        accountNumber: phoneNumber,
        additionalProperties: req.metadata ?? {},
        amount: String(req.amount),
        currency: req.currency,
        externalId: req.reference,
        language: 'sw',
        provider: provider,
        redirectFailURL: req.callbackUrl ?? '',
        redirectSuccessURL: req.callbackUrl ?? '',
      };

      const response = await this.post<AzamPayCheckoutResponse>(
        `${this.apiUrl}/azampay/mno/checkout`,
        payload,
        { headers }
      );

      return {
        transactionId,
        providerTransactionId: response.transactionId,
        status: response.success ? TransactionStatus.PENDING : TransactionStatus.FAILED,
        provider: Provider.AZAMPAY,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.message,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── sendMoney (B2C Disbursement) ──────────────────────────────────────

  async sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse> {
    validatePaymentRequest(req as PaymentRequest);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();

    return this.retry(async () => {
      const headers = await this.authHeaders();

      const payload = {
        amount: String(req.amount),
        currency: req.currency,
        externalId: req.reference,
        memo: req.description ?? 'TZ-Pay-Connect disbursement',
        provider: this.detectMNO(phoneNumber),
        msisdn: phoneNumber,
      };

      const response = await this.post<AzamPayDisbursementResponse>(
        `${this.apiUrl}/azampay/disbursement`,
        payload,
        { headers }
      );

      return {
        transactionId,
        providerTransactionId: response.data?.transactionId,
        status: response.success ? TransactionStatus.PENDING : TransactionStatus.FAILED,
        provider: Provider.AZAMPAY,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.message,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── getTransactionStatus ──────────────────────────────────────────────

  async getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse> {
    return this.retry(async () => {
      const headers = await this.authHeaders();

      const response = await this.post<AzamPayTransactionStatusResponse>(
        `${this.apiUrl}/azampay/gettransactionstatus`,
        { pgReferenceId: req.providerTransactionId ?? req.transactionId },
        { headers }
      );

      return {
        transactionId: req.transactionId,
        providerTransactionId: response.data?.transactionId,
        status: this.mapStatus(response.data?.status),
        provider: Provider.AZAMPAY,
        amount: response.data?.amount ? Number(response.data.amount) : undefined,
        currency: Currency.TZS,
        phoneNumber: response.data?.msisdn,
        reference: response.data?.reference,
        message: response.message,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  // ── refundTransaction ─────────────────────────────────────────────────

  async refundTransaction(_req: RefundRequest): Promise<RefundResponse> {
    throw TZPayError.unsupportedOperation('refundTransaction', Provider.AZAMPAY);
  }

  // ── getBalance ────────────────────────────────────────────────────────

  async getBalance(): Promise<BalanceResponse> {
    throw TZPayError.unsupportedOperation('getBalance', Provider.AZAMPAY);
  }

  // ── verifyPhoneNumber ─────────────────────────────────────────────────

  async verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse> {
    try {
      const normalized = this.normalizePhone(phoneNumber);
      const network = this.detectMNO(normalized);
      return {
        phoneNumber: normalized,
        isValid: true,
        isRegistered: true, // AzamPay doesn't have a standalone verify endpoint
        provider: Provider.AZAMPAY,
        message: `Number appears valid for network: ${network}`,
      };
    } catch {
      return {
        phoneNumber,
        isValid: false,
        isRegistered: false,
        message: 'Invalid phone number format',
      };
    }
  }

  // ── parseWebhook ──────────────────────────────────────────────────────

  parseWebhook(payload: Record<string, unknown>): WebhookPayload {
    return {
      provider: Provider.AZAMPAY,
      transactionId: String(payload.transactionId ?? ''),
      providerTransactionId: String(payload.transactionId ?? ''),
      status: this.mapStatus(payload.transactionStatus as string),
      amount: Number(payload.amount ?? 0),
      currency: Currency.TZS,
      phoneNumber: String(payload.msisdn ?? ''),
      reference: String(payload.reference ?? ''),
      timestamp: nowISO(),
      raw: payload,
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  /**
   * Detects the MNO name that AzamPay expects based on phone prefix.
   * AzamPay uses: 'Mpesa' | 'TigoPesa' | 'AirtelMoney' | 'HaloPesa'
   */
  private detectMNO(phone: string): string {
    const prefix = phone.slice(3, 6); // e.g. "074" from "255074XXXXXXX"
    const map: Record<string, string> = {
      '074': 'Mpesa',
      '075': 'Mpesa',
      '076': 'Mpesa',
      '071': 'TigoPesa',
      '065': 'TigoPesa',
      '067': 'TigoPesa',
      '068': 'AirtelMoney',
      '069': 'AirtelMoney',
      '062': 'HaloPesa',
      '063': 'HaloPesa',
    };
    return map[prefix] ?? 'Mpesa'; // default fallback
  }

  private mapStatus(status?: string): TransactionStatus {
    switch (status?.toUpperCase()) {
      case 'COMPLETED':
      case 'SUCCESS':
        return TransactionStatus.SUCCESS;
      case 'PENDING':
        return TransactionStatus.PENDING;
      case 'FAILED':
      case 'FAILURE':
        return TransactionStatus.FAILED;
      case 'CANCELLED':
        return TransactionStatus.CANCELLED;
      default:
        return TransactionStatus.PENDING;
    }
  }
}
