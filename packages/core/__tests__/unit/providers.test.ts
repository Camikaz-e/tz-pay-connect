/**
 * Tests for Tigo, Airtel, and HaloPesa providers.
 * All use mocked HTTP — no real API calls made.
 */

import { TigoProvider } from '../../src/providers/TigoProvider';
import { AirtelProvider } from '../../src/providers/AirtelProvider';
import { HaloPesaProvider } from '../../src/providers/HaloPesaProvider';
import { Provider, Environment, Currency, TransactionStatus, TZPayErrorCode } from '../../src/types';
import { TZPayError } from '../../src/errors/TZPayError';

// ── Shared mock HTTP setup ─────────────────────────────────────────────────

function makeMockHttp() {
  return { post: jest.fn(), get: jest.fn() };
}

function injectMock(provider: any, mockHttp: ReturnType<typeof makeMockHttp>) {
  provider.http = mockHttp;
  // Pre-set token so auth is skipped
  provider.accessToken = 'mock-token-xyz';
  provider.tokenExpiry = new Date(Date.now() + 3_600_000);
}

// ══════════════════════════════════════════════════════════════════════════
// TIGO PESA
// ══════════════════════════════════════════════════════════════════════════

describe('TigoProvider', () => {
  let provider: TigoProvider;
  let mockHttp: ReturnType<typeof makeMockHttp>;

  const tigoConfig = {
    provider: Provider.TIGO,
    credentials: {
      apiKey: 'tigo-client-id',
      apiSecret: 'tigo-client-secret',
      extra: {
        billerCode: 'BILLER001',
        billerMSISDN: '255710000000',
        accountMSISDN: '255710000000',
        accountName: 'Test Business',
      },
    },
    environment: Environment.SANDBOX,
    auditLogging: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHttp = makeMockHttp();
    provider = new TigoProvider(tigoConfig);
    injectMock(provider, mockHttp);
  });

  describe('requestPayment', () => {
    it('returns PENDING on successful push', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '200', ResponseDescription: 'Request accepted', ReferenceID: 'REF-001', MFSTransactionID: 'TIGO-TXN-001' },
      });

      const result = await provider.requestPayment({
        amount: 3000,
        currency: Currency.TZS,
        phoneNumber: '255712345678',
        reference: 'ORDER-001',
      });

      expect(result.status).toBe(TransactionStatus.PENDING);
      expect(result.provider).toBe(Provider.TIGO);
      expect(result.providerTransactionId).toBe('TIGO-TXN-001');
      expect(result.transactionId).toMatch(/^TZP-/);
    });

    it('normalizes local phone format', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '200', ResponseDescription: 'ok', ReferenceID: 'REF-002' },
      });

      const result = await provider.requestPayment({
        amount: 1000,
        currency: Currency.TZS,
        phoneNumber: '0712345678',
        reference: 'ORDER-002',
      });

      expect(result.phoneNumber).toBe('255712345678');
    });

    it('throws PROVIDER_ERROR on non-200 response code', async () => {
      mockHttp.post.mockResolvedValue({
        data: { ResponseCode: '500', ResponseDescription: 'System error', ReferenceID: '' },
      });

      await expect(
        provider.requestPayment({ amount: 1000, currency: Currency.TZS, phoneNumber: '255712345678', reference: 'REF-003' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.PROVIDER_ERROR });
    });

    it('throws CONFIGURATION_ERROR when billerMSISDN is missing', async () => {
      const badProvider = new TigoProvider({
        ...tigoConfig,
        credentials: { apiKey: 'key', apiSecret: 'secret', extra: { billerCode: 'BC001' } },
      });
      injectMock(badProvider, mockHttp);

      await expect(
        badProvider.requestPayment({ amount: 1000, currency: Currency.TZS, phoneNumber: '255712345678', reference: 'REF' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.CONFIGURATION_ERROR });
    });

    it('throws INVALID_AMOUNT for zero amount', async () => {
      await expect(
        provider.requestPayment({ amount: 0, currency: Currency.TZS, phoneNumber: '255712345678', reference: 'REF' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.INVALID_AMOUNT });
    });
  });

  describe('getTransactionStatus', () => {
    it('maps SUCCESS status correctly', async () => {
      mockHttp.get.mockResolvedValueOnce({
        data: { ResponseCode: '200', ResponseDescription: 'Found', TxnID: 'TIGO-TXN-001', TxnStatus: 'SUCCESS', Amount: '3000', MSISDN: '255712345678' },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-001', providerTransactionId: 'TIGO-TXN-001' });
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(3000);
    });

    it('maps PENDING status correctly', async () => {
      mockHttp.get.mockResolvedValue({
        data: { ResponseCode: '200', ResponseDescription: 'ok', TxnID: 'TIGO-TXN-002', TxnStatus: 'PENDING' },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-002' });
      expect(result.status).toBe(TransactionStatus.PENDING);
    });

    it('maps FAILED status correctly', async () => {
      mockHttp.get.mockResolvedValue({
        data: { ResponseCode: '200', ResponseDescription: 'ok', TxnID: 'TIGO-TXN-003', TxnStatus: 'FAILED' },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-003' });
      expect(result.status).toBe(TransactionStatus.FAILED);
    });
  });

  describe('sendMoney', () => {
    it('returns SUCCESS on B2C payout', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '0', ResponseDescription: 'Payment successful', ReferenceID: 'PAYOUT-001', MFSTransactionID: 'TIGO-B2C-001' },
      });

      const result = await provider.sendMoney({
        amount: 5000,
        currency: Currency.TZS,
        phoneNumber: '255712345678',
        reference: 'PAYOUT-001',
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.provider).toBe(Provider.TIGO);
    });
  });

  describe('refundTransaction', () => {
    it('throws UNSUPPORTED_OPERATION', async () => {
      await expect(
        provider.refundTransaction({ transactionId: 'TZP-001', reference: 'REF' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.UNSUPPORTED_OPERATION });
    });
  });

  describe('parseWebhook', () => {
    it('parses a successful Tigo webhook', () => {
      const result = provider.parseWebhook({
        txnStatus: 'SUCCESS',
        refID: 'REF-001',
        mfsTransactionID: 'TIGO-TXN-001',
        amount: '5000',
        customerMSISDN: '255712345678',
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(5000);
      expect(result.provider).toBe(Provider.TIGO);
    });
  });

  describe('verifyPhoneNumber', () => {
    it('confirms valid Tigo number', async () => {
      const result = await provider.verifyPhoneNumber('255712345678');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(true);
      expect(result.provider).toBe(Provider.TIGO);
    });

    it('flags M-Pesa number as not registered on Tigo', async () => {
      const result = await provider.verifyPhoneNumber('255741234567');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AIRTEL MONEY
// ══════════════════════════════════════════════════════════════════════════

describe('AirtelProvider', () => {
  let provider: AirtelProvider;
  let mockHttp: ReturnType<typeof makeMockHttp>;

  const airtelConfig = {
    provider: Provider.AIRTEL,
    credentials: {
      apiKey: 'airtel-client-id',
      apiSecret: 'airtel-client-secret',
      extra: { country: 'TZ', currency: 'TZS', msisdn: '255680000000' },
    },
    environment: Environment.SANDBOX,
    auditLogging: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHttp = makeMockHttp();
    provider = new AirtelProvider(airtelConfig);
    injectMock(provider, mockHttp);
  });

  describe('requestPayment', () => {
    it('returns PENDING on successful C2B push', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: {
          data: { transaction: { id: 'TXN-001', airtel_money_id: 'AIR-001', status: 'SUCCESS' } },
          status: { code: '200', message: 'Request accepted', result_code: 'ESB000010', success: true },
        },
      });

      const result = await provider.requestPayment({
        amount: 2000,
        currency: Currency.TZS,
        phoneNumber: '255682345678',
        reference: 'ORDER-001',
      });

      expect(result.status).toBe(TransactionStatus.PENDING);
      expect(result.provider).toBe(Provider.AIRTEL);
      expect(result.providerTransactionId).toBe('AIR-001');
    });

    it('throws PROVIDER_ERROR when success is false', async () => {
      mockHttp.post.mockResolvedValue({
        data: {
          data: { transaction: { id: '', status: 'FAILED' } },
          status: { code: '400', message: 'Invalid request', result_code: 'ESB000033', success: false },
        },
      });

      await expect(
        provider.requestPayment({ amount: 1000, currency: Currency.TZS, phoneNumber: '255682345678', reference: 'REF-002' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.PROVIDER_ERROR });
    });

    it('normalizes local phone format', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: {
          data: { transaction: { id: 'TXN-003', status: 'SUCCESS' } },
          status: { code: '200', message: 'ok', success: true },
        },
      });

      const result = await provider.requestPayment({
        amount: 1500,
        currency: Currency.TZS,
        phoneNumber: '0682345678',
        reference: 'ORDER-003',
      });

      expect(result.phoneNumber).toBe('255682345678');
    });
  });

  describe('getTransactionStatus', () => {
    it('maps TS (Transaction Success) to SUCCESS', async () => {
      mockHttp.get.mockResolvedValueOnce({
        data: {
          data: { transaction: { id: 'TXN-001', airtel_money_id: 'AIR-001', status: 'TS', message: 'Completed' } },
          status: { code: '200', message: 'ok', success: true },
        },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-001', providerTransactionId: 'AIR-001' });
      expect(result.status).toBe(TransactionStatus.SUCCESS);
    });

    it('maps TF (Transaction Failed) to FAILED', async () => {
      mockHttp.get.mockResolvedValueOnce({
        data: {
          data: { transaction: { id: 'TXN-002', status: 'TF', message: 'Failed' } },
          status: { code: '200', message: 'ok', success: true },
        },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-002' });
      expect(result.status).toBe(TransactionStatus.FAILED);
    });

    it('maps TP (Transaction Pending) to PENDING', async () => {
      mockHttp.get.mockResolvedValueOnce({
        data: {
          data: { transaction: { id: 'TXN-003', status: 'TP' } },
          status: { code: '200', message: 'ok', success: true },
        },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-003' });
      expect(result.status).toBe(TransactionStatus.PENDING);
    });
  });

  describe('parseWebhook', () => {
    it('parses a successful Airtel webhook', () => {
      const result = provider.parseWebhook({
        transaction: {
          id: 'TXN-HOOK-001',
          airtel_money_id: 'AIR-HOOK-001',
          status: 'TS',
          amount: 2000,
          msisdn: '255682345678',
          reference: 'ORDER-001',
        },
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(2000);
      expect(result.provider).toBe(Provider.AIRTEL);
    });
  });

  describe('verifyPhoneNumber', () => {
    it('confirms valid Airtel number', async () => {
      const result = await provider.verifyPhoneNumber('255682345678');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(true);
      expect(result.provider).toBe(Provider.AIRTEL);
    });

    it('flags Tigo number as not on Airtel', async () => {
      const result = await provider.verifyPhoneNumber('255712345678');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(false);
    });
  });

  describe('refundTransaction', () => {
    it('throws UNSUPPORTED_OPERATION', async () => {
      await expect(
        provider.refundTransaction({ transactionId: 'TZP-001', reference: 'REF' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.UNSUPPORTED_OPERATION });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// HALOPESA
// ══════════════════════════════════════════════════════════════════════════

describe('HaloPesaProvider', () => {
  let provider: HaloPesaProvider;
  let mockHttp: ReturnType<typeof makeMockHttp>;

  const haloConfig = {
    provider: Provider.HALOPESA,
    credentials: {
      apiKey: 'halo-merchant-id',
      apiSecret: 'halo-secret-key-abc123',
      extra: {
        merchantId: 'HALO-MERCHANT-001',
        callbackUrl: 'https://example.com/halo/callback',
      },
    },
    environment: Environment.SANDBOX,
    auditLogging: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHttp = makeMockHttp();
    provider = new HaloPesaProvider(haloConfig);
    // HaloPesa uses HMAC signing, not OAuth — no token to inject
    (provider as any).http = mockHttp;
  });

  describe('requestPayment', () => {
    it('returns PENDING on successful push', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '0', ResponseDesc: 'Request accepted', Data: { OrderID: 'ORDER-001', PaymentRef: 'HALO-PAY-001' } },
      });

      const result = await provider.requestPayment({
        amount: 4000,
        currency: Currency.TZS,
        phoneNumber: '255621234567',
        reference: 'ORDER-001',
      });

      expect(result.status).toBe(TransactionStatus.PENDING);
      expect(result.provider).toBe(Provider.HALOPESA);
      expect(result.transactionId).toMatch(/^TZP-/);
    });

    it('throws CONFIGURATION_ERROR when callbackUrl is missing', async () => {
      const badProvider = new HaloPesaProvider({
        ...haloConfig,
        credentials: { apiKey: 'key', apiSecret: 'secret', extra: { merchantId: 'M001' } },
      });
      (badProvider as any).http = mockHttp;

      await expect(
        badProvider.requestPayment({ amount: 1000, currency: Currency.TZS, phoneNumber: '255621234567', reference: 'REF' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.CONFIGURATION_ERROR });
    });

    it('throws PROVIDER_ERROR on non-zero response', async () => {
      mockHttp.post.mockResolvedValue({
        data: { ResponseCode: '500', ResponseDesc: 'System unavailable', Data: null },
      });

      await expect(
        provider.requestPayment({ amount: 1000, currency: Currency.TZS, phoneNumber: '255621234567', reference: 'REF-ERR' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.PROVIDER_ERROR });
    });

    it('uses callbackUrl from request when provided', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '0', ResponseDesc: 'ok', Data: { OrderID: 'REF-CB' } },
      });

      await provider.requestPayment({
        amount: 1000,
        currency: Currency.TZS,
        phoneNumber: '255621234567',
        reference: 'REF-CB',
        callbackUrl: 'https://override.com/callback',
      });

      const payload = mockHttp.post.mock.calls[0][1];
      expect(payload.CallBackURL).toBe('https://override.com/callback');
    });
  });

  describe('HaloPesa HMAC signing', () => {
    it('includes X-Merchant-ID, X-Timestamp, X-Signature headers', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '0', ResponseDesc: 'ok', Data: { OrderID: 'REF-SIGN' } },
      });

      await provider.requestPayment({
        amount: 1000,
        currency: Currency.TZS,
        phoneNumber: '255621234567',
        reference: 'REF-SIGN',
      });

      const headers = mockHttp.post.mock.calls[0][2]?.headers;
      expect(headers).toHaveProperty('X-Merchant-ID');
      expect(headers).toHaveProperty('X-Timestamp');
      expect(headers).toHaveProperty('X-Signature');
      // Signature must be a hex string (HMAC-SHA256 output)
      expect(headers['X-Signature']).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('getTransactionStatus', () => {
    it('maps SUCCESS status', async () => {
      mockHttp.post.mockResolvedValueOnce({
        data: { ResponseCode: '0', ResponseDesc: 'Found', Data: { OrderID: 'ORDER-001', TransID: 'HALO-001', Status: 'SUCCESS', Amount: '4000', MSISDN: '255621234567' } },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-001', providerTransactionId: 'ORDER-001' });
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(4000);
    });

    it('maps PENDING status', async () => {
      mockHttp.post.mockResolvedValue({
        data: { ResponseCode: '0', ResponseDesc: 'ok', Data: { OrderID: 'ORDER-002', Status: 'PENDING' } },
      });

      const result = await provider.getTransactionStatus({ transactionId: 'TZP-002' });
      expect(result.status).toBe(TransactionStatus.PENDING);
    });
  });

  describe('parseWebhook', () => {
    it('parses a successful HaloPesa webhook', () => {
      const result = provider.parseWebhook({
        Data: { OrderID: 'ORDER-HOOK', TransID: 'HALO-HOOK-001', Status: 'SUCCESS', Amount: '4000', MSISDN: '255621234567' },
        ResponseCode: '0',
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(4000);
      expect(result.provider).toBe(Provider.HALOPESA);
    });
  });

  describe('verifyPhoneNumber', () => {
    it('confirms valid HaloPesa number', async () => {
      const result = await provider.verifyPhoneNumber('255621234567');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(true);
      expect(result.provider).toBe(Provider.HALOPESA);
    });

    it('flags Airtel number as not on HaloPesa', async () => {
      const result = await provider.verifyPhoneNumber('255682345678');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(false);
    });
  });

  describe('getBalance', () => {
    it('throws UNSUPPORTED_OPERATION', async () => {
      await expect(provider.getBalance()).rejects.toMatchObject({ code: TZPayErrorCode.UNSUPPORTED_OPERATION });
    });
  });

  describe('refundTransaction', () => {
    it('throws UNSUPPORTED_OPERATION', async () => {
      await expect(
        provider.refundTransaction({ transactionId: 'TZP-001', reference: 'REF' })
      ).rejects.toMatchObject({ code: TZPayErrorCode.UNSUPPORTED_OPERATION });
    });
  });
});
