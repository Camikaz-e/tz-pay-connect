import { MPesaProvider } from '../../src/providers/MPesaProvider';
import { Provider, Environment, Currency, TransactionStatus, TZPayErrorCode } from '../../src/types';
import { TZPayError } from '../../src/errors/TZPayError';

const mockConfig = {
  provider: Provider.MPESA,
  credentials: {
    apiKey: 'test-consumer-key',
    apiSecret: 'test-consumer-secret',
    extra: {
      shortCode: '174379',
      passKey: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
      b2cInitiator: 'testapi',
      securityCred: 'mock-security-credential',
      callbackUrl: 'https://example.com/mpesa/callback',
    },
  },
  environment: Environment.SANDBOX,
  auditLogging: false,
};

describe('MPesaProvider', () => {
  let provider: MPesaProvider;
  let mockHttp: { post: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    mockHttp = { post: jest.fn(), get: jest.fn() };
    provider = new MPesaProvider(mockConfig);
    // Inject mock http and pre-set token to skip auth
    (provider as any).http = mockHttp;
    (provider as any).accessToken = 'mock-token-xyz';
    (provider as any).tokenExpiry = new Date(Date.now() + 3_600_000);
  });

  // ── requestPayment ──────────────────────────────────────────────────

  describe('requestPayment', () => {
    it('returns PENDING on successful STK push (ResponseCode 0)', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: {
          MerchantRequestID: 'MR-001',
          CheckoutRequestID: 'ws_CO_123456789',
          ResponseCode: '0',
          ResponseDescription: 'Success. Request accepted for processing',
          CustomerMessage: 'Success. Request accepted for processing',
        },
      });

      const result = await provider.requestPayment({
        amount: 10000,
        currency: Currency.TZS,
        phoneNumber: '255741234567',
        reference: 'ORDER-001',
        description: 'Test payment',
      });

      expect(result.status).toBe(TransactionStatus.PENDING);
      expect(result.provider).toBe(Provider.MPESA);
      expect(result.providerTransactionId).toBe('ws_CO_123456789');
      expect(result.amount).toBe(10000);
      expect(result.transactionId).toMatch(/^TZP-/);
    });

    it('throws PROVIDER_ERROR on non-zero ResponseCode', async () => {
      mockHttp.post.mockResolvedValue({
        data: {
          MerchantRequestID: 'MR-002',
          CheckoutRequestID: '',
          ResponseCode: '1',
          ResponseDescription: 'Request failed',
          CustomerMessage: 'Request failed',
        },
      });

      await expect(
        provider.requestPayment({
          amount: 5000,
          currency: Currency.TZS,
          phoneNumber: '255741234567',
          reference: 'ORDER-002',
        })
      ).rejects.toMatchObject({ code: TZPayErrorCode.PROVIDER_ERROR });
    });

    it('normalizes 07XX local phone to E.164', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '0', CheckoutRequestID: 'ws_CO_999', MerchantRequestID: 'MR-003', ResponseDescription: 'Success', CustomerMessage: 'OK' },
      });

      const result = await provider.requestPayment({
        amount: 1000, currency: Currency.TZS,
        phoneNumber: '0741234567', reference: 'REF-003',
      });

      expect(result.phoneNumber).toBe('255741234567');
    });

    it('throws CONFIGURATION_ERROR if shortCode is missing', async () => {
      const badProvider = new MPesaProvider({
        ...mockConfig,
        credentials: { apiKey: 'k', apiSecret: 's', extra: {} },
      });
      (badProvider as any).accessToken = 'tok';
      (badProvider as any).tokenExpiry = new Date(Date.now() + 3600000);
      (badProvider as any).http = mockHttp;

      await expect(
        badProvider.requestPayment({ amount: 1000, currency: Currency.TZS, phoneNumber: '255741234567', reference: 'R' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.CONFIGURATION_ERROR });
    });

    it('throws INVALID_AMOUNT for amount below 100', async () => {
      await expect(
        provider.requestPayment({ amount: 50, currency: Currency.TZS, phoneNumber: '255741234567', reference: 'R' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.INVALID_AMOUNT });
    });
  });

  // ── getTransactionStatus ────────────────────────────────────────────

  describe('getTransactionStatus', () => {
    it('returns SUCCESS for ResultCode 0', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: {
          ResponseCode: '0',
          ResponseDescription: 'The service request has been accepted successfully',
          MerchantRequestID: 'MR-001',
          CheckoutRequestID: 'ws_CO_123456789',
          ResultCode: '0',
          ResultDesc: 'The service request is processed successfully.',
        },
      });

      const result = await provider.getTransactionStatus({
        transactionId: 'TZP-LOCAL',
        providerTransactionId: 'ws_CO_123456789',
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
    });

    it('returns CANCELLED for ResultCode 1032 (user cancelled)', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: {
          ResponseCode: '0', ResponseDescription: 'ok',
          MerchantRequestID: 'MR-002', CheckoutRequestID: 'ws_CO_999',
          ResultCode: '1032',
          ResultDesc: 'Request cancelled by user',
        },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-LOCAL' });
      expect(result.status).toBe(TransactionStatus.CANCELLED);
    });

    it('returns FAILED for non-zero, non-1032 ResultCode', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: {
          ResponseCode: '0', ResponseDescription: 'ok',
          MerchantRequestID: 'MR-003', CheckoutRequestID: 'ws_CO_888',
          ResultCode: '1',
          ResultDesc: 'The balance is insufficient for the transaction',
        },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-LOCAL' });
      expect(result.status).toBe(TransactionStatus.FAILED);
    });
  });

  // ── parseWebhook ────────────────────────────────────────────────────

  describe('parseWebhook', () => {
    it('parses a successful STK push callback', () => {
      const payload = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'MR-001',
            CheckoutRequestID: 'ws_CO_123456789',
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 10000 },
                { Name: 'MpesaReceiptNumber', Value: 'LGR7IRYKKL' },
                { Name: 'PhoneNumber', Value: 255741234567 },
              ],
            },
          },
        },
      };

      const result = provider.parseWebhook(payload);

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(10000);
      expect(result.providerTransactionId).toBe('LGR7IRYKKL');
      expect(result.provider).toBe(Provider.MPESA);
    });

    it('parses a failed STK push callback', () => {
      const payload = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'MR-002',
            CheckoutRequestID: 'ws_CO_FAILED',
            ResultCode: 1032,
            ResultDesc: 'Request cancelled by user',
          },
        },
      };

      const result = provider.parseWebhook(payload);
      expect(result.status).toBe(TransactionStatus.FAILED);
    });
  });

  // ── generatePassword ────────────────────────────────────────────────

  describe('password generation', () => {
    it('generates a valid base64 password', () => {
      const timestamp = '20240101120000';
      const password = (provider as any).generatePassword(timestamp);
      const decoded = Buffer.from(password, 'base64').toString();
      expect(decoded).toContain(mockConfig.credentials.extra!.shortCode!);
      expect(decoded).toContain(timestamp);
    });
  });

  // ── verifyPhoneNumber ───────────────────────────────────────────────

  describe('verifyPhoneNumber', () => {
    it('identifies M-Pesa numbers correctly', async () => {
      const result = await provider.verifyPhoneNumber('255741234567');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(true);
      expect(result.provider).toBe(Provider.MPESA);
    });

    it('returns valid but not M-Pesa for Airtel number', async () => {
      const result = await provider.verifyPhoneNumber('255682345678');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(false); // not an M-Pesa prefix
    });

    it('returns invalid for bad number', async () => {
      const result = await provider.verifyPhoneNumber('notanumber');
      expect(result.isValid).toBe(false);
    });
  });
});
