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
import { TZPayConnectConfig } from '../types';

interface MPesaAuthResponse { access_token: string; expires_in: string; }
interface MPesaSTKPushResponse { MerchantRequestID: string; CheckoutRequestID: string; ResponseCode: string; ResponseDescription: string; CustomerMessage: string; }
interface MPesaSTKQueryResponse { ResponseCode: string; ResponseDescription: string; MerchantRequestID: string; CheckoutRequestID: string; ResultCode: string; ResultDesc: string; }
interface MPesaB2CResponse { ConversationID: string; OriginatorConversationID: string; ResponseCode: string; ResponseDescription: string; }
interface MPesaReversalResponse { ConversationID: string; OriginatorConversationID: string; ResponseCode: string; ResponseDescription: string; }

const MPESA_SANDBOX_URL = 'https://sandbox.safaricom.co.ke';
const MPESA_PRODUCTION_URL = 'https://openapi.m-pesa.com';

export class MPesaProvider extends BaseProvider {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private get baseUrl(): string {
    return this.getBaseUrl(MPESA_SANDBOX_URL, MPESA_PRODUCTION_URL);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 30_000)) {
      return this.accessToken;
    }
    const credentials = Buffer.from(
      `${this.config.credentials.apiKey}:${this.config.credentials.apiSecret}`
    ).toString('base64');
    const response = await this.get<MPesaAuthResponse>(
      `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );
    if (!response.access_token) throw TZPayError.invalidCredentials(Provider.MPESA);
    this.accessToken = response.access_token;
    this.tokenExpiry = new Date(Date.now() + Number(response.expires_in) * 1000);
    return this.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private generatePassword(timestamp: string): string {
    const shortCode = this.config.credentials.extra?.shortCode;
    const passKey = this.config.credentials.extra?.passKey;
    if (!shortCode || !passKey) {
      throw new TZPayError({ code: TZPayErrorCode.CONFIGURATION_ERROR, message: 'M-Pesa requires credentials.extra.shortCode and credentials.extra.passKey', provider: Provider.MPESA });
    }
    return Buffer.from(`${shortCode}${passKey}${timestamp}`).toString('base64');
  }

  private getTimestamp(): string {
    return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  }

  async requestPayment(req: PaymentRequest): Promise<PaymentResponse> {
    validatePaymentRequest(req);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();
    const timestamp = this.getTimestamp();
    const shortCode = this.config.credentials.extra?.shortCode;
    const callbackUrl = req.callbackUrl ?? this.config.credentials.extra?.callbackUrl;
    if (!callbackUrl) throw new TZPayError({ code: TZPayErrorCode.CONFIGURATION_ERROR, message: 'M-Pesa STK Push requires a callbackUrl', provider: Provider.MPESA });

    return this.retry(async () => {
      const headers = await this.authHeaders();
      const payload = {
        BusinessShortCode: shortCode,
        Password: this.generatePassword(timestamp),
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: req.amount,
        PartyA: phoneNumber,
        PartyB: shortCode,
        PhoneNumber: phoneNumber,
        CallBackURL: callbackUrl,
        AccountReference: req.reference,
        TransactionDesc: req.description ?? req.reference,
      };
      const response = await this.post<MPesaSTKPushResponse>(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, payload, { headers });
      if (response.ResponseCode !== '0') throw TZPayError.providerError(response.ResponseDescription, Provider.MPESA, response.ResponseCode, response as unknown as Record<string, unknown>);
      return {
        transactionId,
        providerTransactionId: response.CheckoutRequestID,
        status: TransactionStatus.PENDING,
        provider: Provider.MPESA,
        amount: req.amount,
        currency: req.currency,
        phoneNumber,
        reference: req.reference,
        message: response.CustomerMessage,
        timestamp: nowISO(),
        raw: response as unknown as Record<string, unknown>,
      };
    });
  }

  async sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse> {
    validatePaymentRequest(req as PaymentRequest);
    const phoneNumber = this.normalizePhone(req.phoneNumber);
    const transactionId = generateTransactionId();
    const initiatorName = this.config.credentials.extra?.b2cInitiator;
    const securityCredential = this.config.credentials.extra?.securityCred;
    const shortCode = this.config.credentials.extra?.shortCode;
    const callbackUrl = req.callbackUrl ?? this.config.credentials.extra?.callbackUrl;
    if (!initiatorName || !securityCredential || !shortCode || !callbackUrl) throw new TZPayError({ code: TZPayErrorCode.CONFIGURATION_ERROR, message: 'M-Pesa B2C requires: extra.b2cInitiator, extra.securityCred, extra.shortCode, callbackUrl', provider: Provider.MPESA });

    return this.retry(async () => {
      const headers = await this.authHeaders();
      const payload = { InitiatorName: initiatorName, SecurityCredential: securityCredential, CommandID: 'BusinessPayment', Amount: req.amount, PartyA: shortCode, PartyB: phoneNumber, Remarks: req.description ?? req.reference, QueueTimeOutURL: callbackUrl, ResultURL: callbackUrl, Occasion: req.reference };
      const response = await this.post<MPesaB2CResponse>(`${this.baseUrl}/mpesa/b2c/v1/paymentrequest`, payload, { headers });
      if (response.ResponseCode !== '0') throw TZPayError.providerError(response.ResponseDescription, Provider.MPESA, response.ResponseCode);
      return { transactionId, providerTransactionId: response.ConversationID, status: TransactionStatus.PENDING, provider: Provider.MPESA, amount: req.amount, currency: req.currency, phoneNumber, reference: req.reference, message: response.ResponseDescription, timestamp: nowISO(), raw: response as unknown as Record<string, unknown> };
    });
  }

  async getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse> {
    const timestamp = this.getTimestamp();
    const shortCode = this.config.credentials.extra?.shortCode;
    return this.retry(async () => {
      const headers = await this.authHeaders();
      const payload = { BusinessShortCode: shortCode, Password: this.generatePassword(timestamp), Timestamp: timestamp, CheckoutRequestID: req.providerTransactionId ?? req.transactionId };
      const response = await this.post<MPesaSTKQueryResponse>(`${this.baseUrl}/mpesa/stkpushquery/v1/query`, payload, { headers });
      return { transactionId: req.transactionId, providerTransactionId: response.CheckoutRequestID, status: this.mapResultCode(response.ResultCode), provider: Provider.MPESA, currency: Currency.TZS, message: response.ResultDesc, timestamp: nowISO(), raw: response as unknown as Record<string, unknown> };
    });
  }

  async refundTransaction(req: RefundRequest): Promise<RefundResponse> {
    const initiatorName = this.config.credentials.extra?.b2cInitiator;
    const securityCredential = this.config.credentials.extra?.securityCred;
    const shortCode = this.config.credentials.extra?.shortCode;
    const callbackUrl = this.config.credentials.extra?.callbackUrl;
    if (!initiatorName || !securityCredential || !shortCode || !callbackUrl) throw new TZPayError({ code: TZPayErrorCode.CONFIGURATION_ERROR, message: 'M-Pesa reversal requires: extra.b2cInitiator, extra.securityCred, extra.shortCode, extra.callbackUrl', provider: Provider.MPESA });
    return this.retry(async () => {
      const headers = await this.authHeaders();
      const payload = { Initiator: initiatorName, SecurityCredential: securityCredential, CommandID: 'TransactionReversal', TransactionID: req.transactionId, Amount: req.amount, ReceiverParty: shortCode, RecieverIdentifierType: '11', ResultURL: callbackUrl, QueueTimeOutURL: callbackUrl, Remarks: req.reason ?? 'Reversal', Occasion: req.reference };
      const response = await this.post<MPesaReversalResponse>(`${this.baseUrl}/mpesa/reversal/v1/request`, payload, { headers });
      if (response.ResponseCode !== '0') throw TZPayError.providerError(response.ResponseDescription, Provider.MPESA, response.ResponseCode);
      return { refundId: generateTransactionId(), originalTransactionId: req.transactionId, status: TransactionStatus.PENDING, amount: req.amount ?? 0, currency: Currency.TZS, message: response.ResponseDescription, timestamp: nowISO(), raw: response as unknown as Record<string, unknown> };
    });
  }

  async getBalance(): Promise<BalanceResponse> {
    throw TZPayError.unsupportedOperation('getBalance (use callback)', Provider.MPESA);
  }

  async verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse> {
    try {
      const normalized = this.normalizePhone(phoneNumber);
      const prefix = normalized.slice(3, 6);
      const mpesaPrefixes = ['741','742','743','744','745','746','747','748','749','750','751','752','753','754','755','756','757','758','759','760','761','762','763','764','765','766','767','768','769'];
      const isMpesa = mpesaPrefixes.includes(prefix);
      return { phoneNumber: normalized, isValid: true, isRegistered: isMpesa, provider: isMpesa ? Provider.MPESA : undefined, message: isMpesa ? 'Valid M-Pesa number' : 'Valid number but not on Vodacom/M-Pesa network' };
    } catch {
      return { phoneNumber, isValid: false, isRegistered: false, message: 'Invalid phone number format' };
    }
  }

  parseWebhook(payload: Record<string, unknown>): WebhookPayload {
    const body = (payload.Body as Record<string, unknown>) ?? payload;
    const stkCallback = (body.stkCallback as Record<string, unknown>) ?? body;
    const resultCode = String(stkCallback.ResultCode ?? payload.ResultCode ?? '');
    const metadata = stkCallback.CallbackMetadata as Record<string, unknown> | undefined;
    const items = (metadata?.Item as Array<Record<string, unknown>>) ?? [];
    const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;
    return {
      provider: Provider.MPESA,
      transactionId: String(stkCallback.CheckoutRequestID ?? payload.CheckoutRequestID ?? ''),
      providerTransactionId: String(getItem('MpesaReceiptNumber') ?? ''),
      status: resultCode === '0' ? TransactionStatus.SUCCESS : TransactionStatus.FAILED,
      amount: Number(getItem('Amount') ?? 0),
      currency: Currency.TZS,
      phoneNumber: String(getItem('PhoneNumber') ?? payload.PhoneNumber ?? ''),
      reference: String(stkCallback.MerchantRequestID ?? ''),
      timestamp: nowISO(),
      raw: payload,
    };
  }

  private mapResultCode(resultCode?: string): TransactionStatus {
    switch (resultCode) {
      case '0': return TransactionStatus.SUCCESS;
      case '1032': return TransactionStatus.CANCELLED;
      case '1037': return TransactionStatus.TIMEOUT;
      case undefined: case '': return TransactionStatus.PENDING;
      default: return TransactionStatus.FAILED;
    }
  }
}
