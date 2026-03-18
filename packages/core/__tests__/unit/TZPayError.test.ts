import { TZPayError } from '../../src/errors/TZPayError';
import { TZPayErrorCode, Provider } from '../../src/types';

describe('TZPayError', () => {
  it('is an instance of Error', () => {
    const err = TZPayError.networkError('test', Provider.AZAMPAY);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TZPayError);
  });

  it('has name TZPayError', () => {
    const err = TZPayError.timeout(Provider.AZAMPAY);
    expect(err.name).toBe('TZPayError');
  });

  describe('static factories', () => {
    it('networkError sets correct code', () => {
      const err = TZPayError.networkError('connection refused', Provider.MPESA);
      expect(err.code).toBe(TZPayErrorCode.NETWORK_ERROR);
      expect(err.provider).toBe(Provider.MPESA);
      expect(err.message).toContain('connection refused');
    });

    it('timeout sets correct code', () => {
      const err = TZPayError.timeout(Provider.TIGO);
      expect(err.code).toBe(TZPayErrorCode.TIMEOUT);
      expect(err.provider).toBe(Provider.TIGO);
    });

    it('invalidCredentials sets correct code', () => {
      const err = TZPayError.invalidCredentials(Provider.AZAMPAY);
      expect(err.code).toBe(TZPayErrorCode.INVALID_CREDENTIALS);
    });

    it('invalidPhoneNumber sets correct code and includes phone in message', () => {
      const err = TZPayError.invalidPhoneNumber('badphone');
      expect(err.code).toBe(TZPayErrorCode.INVALID_PHONE_NUMBER);
      expect(err.message).toContain('badphone');
    });

    it('invalidAmount sets correct code and includes amount in message', () => {
      const err = TZPayError.invalidAmount(-50);
      expect(err.code).toBe(TZPayErrorCode.INVALID_AMOUNT);
      expect(err.message).toContain('-50');
    });

    it('providerError stores raw and providerCode', () => {
      const raw = { code: 'E001', detail: 'upstream error' };
      const err = TZPayError.providerError('upstream failed', Provider.AZAMPAY, 'E001', raw);
      expect(err.code).toBe(TZPayErrorCode.PROVIDER_ERROR);
      expect(err.providerCode).toBe('E001');
      expect(err.raw).toEqual(raw);
    });

    it('unsupportedOperation includes operation and provider in message', () => {
      const err = TZPayError.unsupportedOperation('refundTransaction', Provider.AZAMPAY);
      expect(err.code).toBe(TZPayErrorCode.UNSUPPORTED_OPERATION);
      expect(err.message).toContain('refundTransaction');
      expect(err.message).toContain('azampay');
    });
  });

  describe('toJSON', () => {
    it('serializes to plain object without stack trace', () => {
      const err = TZPayError.timeout(Provider.MPESA);
      const json = err.toJSON();
      expect(json).toHaveProperty('code', TZPayErrorCode.TIMEOUT);
      expect(json).toHaveProperty('name', 'TZPayError');
      expect(json).toHaveProperty('provider', Provider.MPESA);
      expect(json).not.toHaveProperty('stack');
    });
  });
});
