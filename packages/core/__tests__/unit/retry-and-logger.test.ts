import { withRetry } from '../../src/utils/retry';
import { AuditLogger } from '../../src/utils/logger';
import { TZPayError } from '../../src/errors/TZPayError';
import { TZPayErrorCode, Provider, TransactionStatus, TransactionType, Currency } from '../../src/types';

// ── withRetry ─────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('returns result immediately on first success', async () => {
    const op = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(op, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds on second attempt', async () => {
    const op = jest.fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(op, { maxAttempts: 3, baseDelayMs: 0 });
    expect(result).toBe('recovered');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('retries up to maxAttempts then throws last error', async () => {
    const err = new Error('always fails');
    const op = jest.fn().mockRejectedValue(err);

    await expect(withRetry(op, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toThrow('always fails');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on INVALID_CREDENTIALS error', async () => {
    const credErr = TZPayError.invalidCredentials(Provider.AZAMPAY);
    const op = jest.fn().mockRejectedValue(credErr);

    await expect(withRetry(op, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toMatchObject({
      code: TZPayErrorCode.INVALID_CREDENTIALS,
    });
    expect(op).toHaveBeenCalledTimes(1); // no retry
  });

  it('does NOT retry on INVALID_PHONE_NUMBER error', async () => {
    const phoneErr = TZPayError.invalidPhoneNumber('bad');
    const op = jest.fn().mockRejectedValue(phoneErr);

    await expect(withRetry(op, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toMatchObject({
      code: TZPayErrorCode.INVALID_PHONE_NUMBER,
    });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on INVALID_AMOUNT error', async () => {
    const amtErr = TZPayError.invalidAmount(-1);
    const op = jest.fn().mockRejectedValue(amtErr);

    await expect(withRetry(op, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toMatchObject({
      code: TZPayErrorCode.INVALID_AMOUNT,
    });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('DOES retry on NETWORK_ERROR', async () => {
    const netErr = TZPayError.networkError('connection reset', Provider.MPESA);
    const op = jest.fn()
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce('success after retry');

    const result = await withRetry(op, { maxAttempts: 3, baseDelayMs: 0 });
    expect(result).toBe('success after retry');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('DOES retry on PROVIDER_ERROR', async () => {
    const provErr = TZPayError.providerError('upstream 500', Provider.AZAMPAY);
    const op = jest.fn()
      .mockRejectedValueOnce(provErr)
      .mockRejectedValueOnce(provErr)
      .mockResolvedValueOnce('third time lucky');

    const result = await withRetry(op, { maxAttempts: 3, baseDelayMs: 0 });
    expect(result).toBe('third time lucky');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('respects custom noRetryOn list', async () => {
    const err = new TZPayError({ code: TZPayErrorCode.PROVIDER_UNAVAILABLE, message: 'down' });
    const op = jest.fn().mockRejectedValue(err);

    await expect(
      withRetry(op, { maxAttempts: 3, baseDelayMs: 0, noRetryOn: [TZPayErrorCode.PROVIDER_UNAVAILABLE] })
    ).rejects.toMatchObject({ code: TZPayErrorCode.PROVIDER_UNAVAILABLE });
    expect(op).toHaveBeenCalledTimes(1);
  });
});

// ── AuditLogger ───────────────────────────────────────────────────────────

describe('AuditLogger', () => {
  const baseContext = {
    provider: Provider.AZAMPAY,
    transactionType: TransactionType.C2B,
    phoneNumber: '255712345678',
    amount: 5000,
    currency: Currency.TZS,
    reference: 'REF-001',
  };

  it('calls custom sink with masked phone number', () => {
    const sink = jest.fn();
    const logger = new AuditLogger({ enabled: true, sink });

    logger.log({ ...baseContext, id: 'TZP-001', timestamp: new Date().toISOString(), status: TransactionStatus.SUCCESS, durationMs: 120 });

    expect(sink).toHaveBeenCalledTimes(1);
    const entry = sink.mock.calls[0][0];
    expect(entry.phoneNumber).not.toBe('255712345678'); // should be masked
    expect(entry.phoneNumber).toContain('****');
    expect(entry.status).toBe(TransactionStatus.SUCCESS);
  });

  it('does NOT call sink when disabled', () => {
    const sink = jest.fn();
    const logger = new AuditLogger({ enabled: false, sink });

    logger.log({ ...baseContext, id: 'TZP-002', timestamp: new Date().toISOString(), status: TransactionStatus.SUCCESS, durationMs: 50 });

    expect(sink).not.toHaveBeenCalled();
  });

  it('timed() logs SUCCESS when operation succeeds', async () => {
    const sink = jest.fn();
    const logger = new AuditLogger({ enabled: true, sink });

    const result = await logger.timed(baseContext, async () => 'payment-done');

    expect(result).toBe('payment-done');
    expect(sink).toHaveBeenCalledTimes(1);
    const entry = sink.mock.calls[0][0];
    expect(entry.status).toBe(TransactionStatus.SUCCESS);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('timed() logs FAILED and rethrows when operation throws', async () => {
    const sink = jest.fn();
    const logger = new AuditLogger({ enabled: true, sink });

    await expect(
      logger.timed(baseContext, async () => { throw new Error('provider down'); })
    ).rejects.toThrow('provider down');

    const entry = sink.mock.calls[0][0];
    expect(entry.status).toBe(TransactionStatus.FAILED);
    expect(entry.error).toBe('provider down');
  });

  it('timed() includes durationMs in log entry', async () => {
    const sink = jest.fn();
    const logger = new AuditLogger({ enabled: true, sink });

    await logger.timed(baseContext, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'done';
    });

    const entry = sink.mock.calls[0][0];
    expect(entry.durationMs).toBeGreaterThanOrEqual(10);
  });
});
