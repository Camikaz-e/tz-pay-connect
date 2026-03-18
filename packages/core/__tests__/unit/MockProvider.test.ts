import { MockProvider } from '../../src/mock/MockProvider';
import { Provider, Currency, TransactionStatus, TZPayErrorCode } from '../../src/types';

const baseRequest = {
  amount: 5000,
  currency: Currency.TZS,
  phoneNumber: '255712345678',
  reference: 'ORDER-001',
};

describe('MockProvider', () => {
  describe('scenario: success (default)', () => {
    let mock: MockProvider;
    beforeEach(() => { mock = new MockProvider({ delayMs: 0 }); });

    it('requestPayment returns SUCCESS', async () => {
      const result = await mock.requestPayment(baseRequest);
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.provider).toBe(Provider.AZAMPAY);
      expect(result.transactionId).toMatch(/^TZP-/);
    });

    it('sendMoney returns SUCCESS and deducts balance', async () => {
      const before = mock.getCurrentBalance();
      const result = await mock.sendMoney(baseRequest);
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(mock.getCurrentBalance()).toBe(before - baseRequest.amount);
    });

    it('getTransactionStatus returns stored status', async () => {
      const payment = await mock.requestPayment(baseRequest);
      const status = await mock.getTransactionStatus({ transactionId: payment.transactionId });
      expect(status.status).toBe(TransactionStatus.SUCCESS);
      expect(status.amount).toBe(5000);
    });

    it('refundTransaction works on a SUCCESS transaction', async () => {
      const payment = await mock.requestPayment(baseRequest);
      const balanceBefore = mock.getCurrentBalance();
      const refund = await mock.refundTransaction({ transactionId: payment.transactionId, reference: 'REFUND-001' });
      expect(refund.status).toBe(TransactionStatus.SUCCESS);
      expect(mock.getCurrentBalance()).toBe(balanceBefore + 5000);
    });

    it('getBalance returns balance', async () => {
      const result = await mock.getBalance();
      expect(result.balance).toBe(1_000_000);
      expect(result.currency).toBe(Currency.TZS);
    });

    it('verifyPhoneNumber returns valid for TZ number', async () => {
      const result = await mock.verifyPhoneNumber('255741234567');
      expect(result.isValid).toBe(true);
      expect(result.isRegistered).toBe(true);
    });

    it('verifyPhoneNumber returns invalid for bad number', async () => {
      const result = await mock.verifyPhoneNumber('notaphone');
      expect(result.isValid).toBe(false);
    });
  });

  describe('scenario: failure', () => {
    let mock: MockProvider;
    beforeEach(() => { mock = new MockProvider({ scenario: 'failure', delayMs: 0 }); });

    it('requestPayment returns FAILED', async () => {
      const result = await mock.requestPayment(baseRequest);
      expect(result.status).toBe(TransactionStatus.FAILED);
    });

    it('sendMoney returns FAILED and does NOT deduct balance', async () => {
      const before = mock.getCurrentBalance();
      const result = await mock.sendMoney(baseRequest);
      expect(result.status).toBe(TransactionStatus.FAILED);
      expect(mock.getCurrentBalance()).toBe(before);
    });
  });

  describe('scenario: pending', () => {
    it('requestPayment returns PENDING', async () => {
      const mock = new MockProvider({ scenario: 'pending', delayMs: 0 });
      const result = await mock.requestPayment(baseRequest);
      expect(result.status).toBe(TransactionStatus.PENDING);
    });
  });

  describe('scenario: timeout', () => {
    it('requestPayment throws TIMEOUT error', async () => {
      const mock = new MockProvider({ scenario: 'timeout', delayMs: 0 });
      await expect(mock.requestPayment(baseRequest))
        .rejects.toMatchObject({ code: TZPayErrorCode.TIMEOUT });
    });
  });

  describe('edge cases', () => {
    let mock: MockProvider;
    beforeEach(() => { mock = new MockProvider({ delayMs: 0 }); });

    it('throws INSUFFICIENT_FUNDS when sendMoney exceeds balance', async () => {
      await expect(mock.sendMoney({ ...baseRequest, amount: 2_000_000 }))
        .rejects.toMatchObject({ code: TZPayErrorCode.INSUFFICIENT_FUNDS });
    });

    it('throws TRANSACTION_NOT_FOUND for unknown transactionId', async () => {
      await expect(mock.getTransactionStatus({ transactionId: 'NONEXISTENT' }))
        .rejects.toMatchObject({ code: TZPayErrorCode.TRANSACTION_NOT_FOUND });
    });

    it('throws TRANSACTION_FAILED when refunding non-success transaction', async () => {
      const failMock = new MockProvider({ scenario: 'failure', delayMs: 0 });
      const payment = await failMock.requestPayment(baseRequest);
      await expect(failMock.refundTransaction({ transactionId: payment.transactionId, reference: 'R' }))
        .rejects.toMatchObject({ code: TZPayErrorCode.TRANSACTION_FAILED });
    });

    it('throws INVALID_PHONE_NUMBER for bad phone', async () => {
      await expect(mock.requestPayment({ ...baseRequest, phoneNumber: 'bad' }))
        .rejects.toMatchObject({ code: TZPayErrorCode.INVALID_PHONE_NUMBER });
    });

    it('throws INVALID_AMOUNT for zero amount', async () => {
      await expect(mock.requestPayment({ ...baseRequest, amount: 0 }))
        .rejects.toMatchObject({ code: TZPayErrorCode.INVALID_AMOUNT });
    });
  });

  describe('test helpers', () => {
    let mock: MockProvider;
    beforeEach(() => { mock = new MockProvider({ delayMs: 0 }); });

    it('setTransactionStatus allows manual override', async () => {
      const payment = await mock.requestPayment(baseRequest);
      mock.setTransactionStatus(payment.transactionId, TransactionStatus.FAILED);
      const status = await mock.getTransactionStatus({ transactionId: payment.transactionId });
      expect(status.status).toBe(TransactionStatus.FAILED);
    });

    it('reset clears all transactions and resets balance', async () => {
      await mock.requestPayment(baseRequest);
      mock.reset(500_000);
      expect(mock.getCurrentBalance()).toBe(500_000);
      expect(Object.keys(mock.getStoredTransactions()).length).toBe(0);
    });

    it('getStoredTransactions returns all stored transactions', async () => {
      await mock.requestPayment(baseRequest);
      await mock.requestPayment({ ...baseRequest, reference: 'ORDER-002' });
      expect(Object.keys(mock.getStoredTransactions()).length).toBe(2);
    });

    it('parseWebhook returns unified payload', () => {
      const result = mock.parseWebhook({
        transactionId: 'TXN-001', amount: 5000,
        phoneNumber: '255741234567', reference: 'ORDER-001',
        status: TransactionStatus.SUCCESS,
      });
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(result.amount).toBe(5000);
    });
  });

  describe('custom provider identity', () => {
    it('uses specified provider name', async () => {
      const mock = new MockProvider({ provider: Provider.MPESA, delayMs: 0 });
      const result = await mock.requestPayment(baseRequest);
      expect(result.provider).toBe(Provider.MPESA);
    });

    it('initialBalance option sets starting balance', async () => {
      const mock = new MockProvider({ initialBalance: 250_000, delayMs: 0 });
      expect(mock.getCurrentBalance()).toBe(250_000);
    });
  });
});
