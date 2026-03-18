import { normalizePhoneNumber, detectNetwork, generateTransactionId, maskPhone, maskSecret } from '../../src/utils/validation';
import { TZPayError } from '../../src/errors/TZPayError';
import { TZPayErrorCode, Currency } from '../../src/types';
import { validatePaymentRequest } from '../../src/utils/validation';

describe('normalizePhoneNumber', () => {
  it('accepts valid E.164 Tanzanian numbers', () => {
    expect(normalizePhoneNumber('255712345678')).toBe('255712345678');
    expect(normalizePhoneNumber('255682345678')).toBe('255682345678');
  });

  it('converts local format (0XXXXXXXXX) to E.164', () => {
    expect(normalizePhoneNumber('0712345678')).toBe('255712345678');
    expect(normalizePhoneNumber('0682345678')).toBe('255682345678');
  });

  it('strips leading + sign', () => {
    expect(normalizePhoneNumber('+255712345678')).toBe('255712345678');
  });

  it('strips spaces and dashes', () => {
    expect(normalizePhoneNumber('0712 345 678')).toBe('255712345678');
    expect(normalizePhoneNumber('0712-345-678')).toBe('255712345678');
  });

  it('throws TZPayError for invalid numbers', () => {
    expect(() => normalizePhoneNumber('12345')).toThrow(TZPayError);
    expect(() => normalizePhoneNumber('255012345678')).toThrow(TZPayError);
    expect(() => normalizePhoneNumber('abcdefghij')).toThrow(TZPayError);
  });

  it('throws with INVALID_PHONE_NUMBER code', () => {
    try {
      normalizePhoneNumber('badnumber');
    } catch (err) {
      expect(err).toBeInstanceOf(TZPayError);
      expect((err as TZPayError).code).toBe(TZPayErrorCode.INVALID_PHONE_NUMBER);
    }
  });
});

describe('detectNetwork', () => {
  it('detects M-Pesa numbers', () => {
    expect(detectNetwork('255741234567')).toBe('mpesa');
    expect(detectNetwork('255761234567')).toBe('mpesa');
  });

  it('detects Tigo Pesa numbers', () => {
    expect(detectNetwork('255712345678')).toBe('tigo');
    expect(detectNetwork('255651234567')).toBe('tigo');
  });

  it('detects Airtel Money numbers', () => {
    expect(detectNetwork('255682345678')).toBe('airtel');
    expect(detectNetwork('255691234567')).toBe('airtel');
  });

  it('returns null for unknown prefix', () => {
    // 255600... is not a registered network prefix
    expect(detectNetwork('255600123456')).toBeNull();
  });

  it('returns null for completely invalid number without throwing', () => {
    expect(detectNetwork('badnumber')).toBeNull();
  });
});

describe('validatePaymentRequest', () => {
  const validRequest = {
    amount: 5000,
    currency: Currency.TZS,
    phoneNumber: '255712345678',
    reference: 'ORDER-001',
  };

  it('passes a valid request without throwing', () => {
    expect(() => validatePaymentRequest(validRequest)).not.toThrow();
  });

  it('throws for amount 0', () => {
    expect(() => validatePaymentRequest({ ...validRequest, amount: 0 })).toThrow(TZPayError);
  });

  it('throws for negative amount', () => {
    expect(() => validatePaymentRequest({ ...validRequest, amount: -100 })).toThrow(TZPayError);
  });

  it('throws for amount below minimum (100 TZS)', () => {
    expect(() => validatePaymentRequest({ ...validRequest, amount: 50 })).toThrow(TZPayError);
  });

  it('throws for amount above maximum (5,000,000 TZS)', () => {
    expect(() => validatePaymentRequest({ ...validRequest, amount: 6_000_000 })).toThrow(TZPayError);
  });

  it('throws for non-integer amount', () => {
    expect(() => validatePaymentRequest({ ...validRequest, amount: 100.50 })).toThrow(TZPayError);
  });

  it('throws for missing reference', () => {
    expect(() => validatePaymentRequest({ ...validRequest, reference: '' })).toThrow(TZPayError);
  });

  it('throws for invalid phone number', () => {
    expect(() => validatePaymentRequest({ ...validRequest, phoneNumber: 'invalid' })).toThrow(TZPayError);
  });
});

describe('generateTransactionId', () => {
  it('generates IDs with TZP- prefix', () => {
    expect(generateTransactionId()).toMatch(/^TZP-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, generateTransactionId));
    expect(ids.size).toBe(1000);
  });
});

describe('maskPhone', () => {
  it('masks middle digits of phone number', () => {
    const masked = maskPhone('255712345678');
    expect(masked).toMatch(/^255712/);
    expect(masked).toContain('****');
  });
});

describe('maskSecret', () => {
  it('masks the middle of a secret', () => {
    const masked = maskSecret('mysupersecretkey');
    expect(masked).toMatch(/^mys/);
    expect(masked).toContain('*');
    expect(masked).toMatch(/key$/);
  });

  it('handles short secrets gracefully', () => {
    expect(maskSecret('abc')).toBe('***');
  });
});
