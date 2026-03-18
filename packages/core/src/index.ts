import {
  TZPayConnectConfig,
  Provider,
  IProvider,
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
} from './types';
import { TZPayError } from './errors/TZPayError';
import { TZPayErrorCode } from './types';
import { AzamPayProvider } from './providers/AzamPayProvider';
import { MPesaProvider } from './providers/MPesaProvider';
import { TigoProvider } from './providers/TigoProvider';
import { AirtelProvider } from './providers/AirtelProvider';
import { HaloPesaProvider } from './providers/HaloPesaProvider';
import { MockProvider } from './mock/MockProvider';

export type TZPayConnectConfigWithMock = TZPayConnectConfig & {
  /** Set true to use the built-in mock — no real API calls, no credentials needed */
  useMock?: boolean;
};

/**
 * TZPayConnect — the main SDK class.
 * One class. One API. All Tanzanian mobile money providers.
 *
 * @example
 * // With mock (no credentials needed)
 * const tzPay = new TZPayConnect({
 *   provider: Provider.MPESA,
 *   credentials: { apiKey: 'any' },
 *   environment: Environment.SANDBOX,
 *   useMock: true,
 * });
 *
 * // With real AzamPay sandbox credentials
 * const tzPay = new TZPayConnect({
 *   provider: Provider.AZAMPAY,
 *   credentials: { apiKey: 'app-name', apiSecret: 'secret', extra: { clientId: 'id' } },
 *   environment: Environment.SANDBOX,
 * });
 */
export class TZPayConnect {
  private readonly provider: IProvider;

  constructor(config: TZPayConnectConfigWithMock) {
    this.provider = TZPayConnect.createProvider(config);
  }

  requestPayment(req: PaymentRequest): Promise<PaymentResponse> {
    return this.provider.requestPayment(req);
  }

  sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse> {
    return this.provider.sendMoney(req);
  }

  getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse> {
    return this.provider.getTransactionStatus(req);
  }

  refundTransaction(req: RefundRequest): Promise<RefundResponse> {
    return this.provider.refundTransaction(req);
  }

  getBalance(): Promise<BalanceResponse> {
    return this.provider.getBalance();
  }

  verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse> {
    return this.provider.verifyPhoneNumber(phoneNumber);
  }

  parseWebhook(payload: Record<string, unknown>): WebhookPayload {
    return this.provider.parseWebhook(payload);
  }

  get providerName(): Provider {
    return this.provider.name;
  }

  private static createProvider(config: TZPayConnectConfigWithMock): IProvider {
    // useMock: true → return mock for any provider, no credentials needed
    if (config.useMock) {
      return new MockProvider({ provider: config.provider });
    }

    switch (config.provider) {
      case Provider.AZAMPAY:
        return new AzamPayProvider(config);
      case Provider.MPESA:
        return new MPesaProvider(config);
      case Provider.TIGO:
        return new TigoProvider(config);
      case Provider.AIRTEL:
        return new AirtelProvider(config);
      case Provider.HALOPESA:
        return new HaloPesaProvider(config);
      default:
        throw new TZPayError({
          code: TZPayErrorCode.CONFIGURATION_ERROR,
          message: `Unknown provider: "${config.provider}". Use the Provider enum.`,
        });
    }
  }
}

// Re-export everything developers need from one place
export * from './types';
export * from './errors/TZPayError';
export { AzamPayProvider } from './providers/AzamPayProvider';
export { MPesaProvider } from './providers/MPesaProvider';
export { TigoProvider } from './providers/TigoProvider';
export { AirtelProvider } from './providers/AirtelProvider';
export { HaloPesaProvider } from './providers/HaloPesaProvider';
export { MockProvider } from './mock/MockProvider';
export type { MockProviderOptions } from './mock/MockProvider';
