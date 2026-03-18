import axios from 'axios';
import { AzamPayProvider } from '../../src/providers/AzamPayProvider';
import { TZPayError } from '../../src/errors/TZPayError';
import { Provider, Environment, Currency, TransactionStatus, TZPayErrorCode } from '../../src/types';

// Mock axios so no real HTTP calls are made
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockConfig = {
  provider: Provider.AZAMPAY,
  credentials: {
    apiKey: 'test-app-name',
    apiSecret: 'test-secret',
    extra: { clientId: 'test-client-id' },
  },
  environment: Environment.SANDBOX,
  auditLogging: false, // silence logs in tests
};

// Helper: mock a successful token response
function mockTokenSuccess() {
  mockedAxios.create.mockReturnThis();
  (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
    data: {
      data: {
        accessToken: 'mock-access-token-xyz',
        expire: new Date(Date.now() + 3_600_000).toISOString(),
      },
      message: 'Token generated',
      success: true,
    },
  });
}

describe('AzamPayProvider', () => {
  let provider: AzamPayProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    // axios.create() should return an object with .post/.get methods
    const mockHttp = {
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    mockedAxios.create.mockReturnValue(mockHttp as any);
    (mockedAxios as any).isAxiosError = jest.fn().mockReturnValue(false);

    provider = new AzamPayProvider(mockConfig);

    // Inject mock token directly to skip auth in most tests
    (provider as any).accessToken = 'mock-access-token-xyz';
    (provider as any).tokenExpiry = new Date(Date.now() + 3_600_000);
    // Point the http client's post to jest.fn() we can control
    (provider as any).http = {
      post: jest.fn(),
      get: jest.fn(),
    };
  });

  describe('requestPayment', () => {
    it('returns a PENDING payment response on success', async () => {
      (provider as any).http.post.mockResolvedValueOnce({
        data: {
          transactionId: 'AZM-TXN-001',
          message: 'Request submitted',
          success: true,
        },
      });

      const result = await provider.requestPayment({
        amount: 5000,
        currency: Currency.TZS,
        phoneNumber: '255712345678',
        reference: 'ORDER-001',
      });

      expect(result.status).toBe(TransactionStatus.PENDING);
      expect(result.provider).toBe(Provider.AZAMPAY);
      expect(result.amount).toBe(5000);
      expect(result.providerTransactionId).toBe('AZM-TXN-001');
      expect(result.transactionId).toMatch(/^TZP-/);
    });

    it('normalizes local phone format to E.164', async () => {
      (provider as any).http.post.mockResolvedValueOnce({
        data: { transactionId: 'AZM-001', message: 'ok', success: true },
      });

      const result = await provider.requestPayment({
        amount: 1000,
        currency: Currency.TZS,
        phoneNumber: '0712345678', // local format
        reference: 'REF-001',
      });

      expect(result.phoneNumber).toBe('255712345678');
    });

    it('returns FAILED status when provider success=false', async () => {
      (provider as any).http.post.mockResolvedValueOnce({
        data: {
          transactionId: '',
          message: 'Transaction failed',
          success: false,
        },
      });

      const result = await provider.requestPayment({
        amount: 1000,
        currency: Currency.TZS,
        phoneNumber: '255712345678',
        reference: 'REF-002',
      });

      expect(result.status).toBe(TransactionStatus.FAILED);
    });

    it('throws INVALID_AMOUNT for amount below 100', async () => {
      await expect(
        provider.requestPayment({
          amount: 50,
          currency: Currency.TZS,
          phoneNumber: '255712345678',
          reference: 'REF-003',
        })
      ).rejects.toThrow(TZPayError);
    });

    it('throws INVALID_PHONE_NUMBER for bad phone', async () => {
      await expect(
        provider.requestPayment({
          amount: 1000,
          currency: Currency.TZS,
          phoneNumber: 'notaphone',
          reference: 'REF-004',
        })
      ).rejects.toMatchObject({ code: TZPayErrorCode.INVALID_PHONE_NUMBER });
    });
  });

  describe('getTransactionStatus', () => {
    it('returns SUCCESS status for COMPLETED transaction', async () => {
      (provider as any).http.post.mockResolvedValueOnce({
        data: {
          data: {
            transactionId: 'AZM-TXN-001',
            msisdn: '255712345678',
            amount: '5000',
            status: 'COMPLETED',
            reference: 'ORDER-001',
          },
          message: 'Found',
          success: true,
        },
      });

      const result = await provider.getTransactionStatus({
        transactionId: 'TZP-123',
        providerTransactionId: 'AZM-TXN-001',
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(5000);
    });

    it('returns PENDING for pending transaction', async () => {
      (provider as any).http.post.mockResolvedValueOnce({
        data: {
          data: { transactionId: 'AZM-TXN-002', status: 'PENDING' },
          success: true,
        },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-456' });
      expect(result.status).toBe(TransactionStatus.PENDING);
    });
  });

  describe('refundTransaction', () => {
    it('throws UNSUPPORTED_OPERATION', async () => {
      await expect(
        provider.refundTransaction({ transactionId: 'TZP-001', reference: 'REF-001' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.UNSUPPORTED_OPERATION });
    });
  });

  describe('parseWebhook', () => {
    it('parses a successful webhook payload', () => {
      const raw = {
        transactionId: 'AZM-TXN-WEBHOOK',
        msisdn: '255712345678',
        amount: '5000',
        reference: 'ORDER-001',
        transactionStatus: 'COMPLETED',
      };

      const result = provider.parseWebhook(raw);

      expect(result.provider).toBe(Provider.AZAMPAY);
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(5000);
      expect(result.phoneNumber).toBe('255712345678');
    });
  });

  describe('verifyPhoneNumber', () => {
    it('returns valid for correct Tanzania number', async () => {
      const result = await provider.verifyPhoneNumber('255712345678');
      expect(result.isValid).toBe(true);
      expect(result.phoneNumber).toBe('255712345678');
    });

    it('returns invalid for bad number', async () => {
      const result = await provider.verifyPhoneNumber('badnumber');
      expect(result.isValid).toBe(false);
    });
  });
});
