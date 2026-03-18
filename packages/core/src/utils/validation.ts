import { TZPayError } from '../errors/TZPayError';
import { PaymentRequest, SendMoneyRequest, Currency } from '../types';

/**
 * Validates a Tanzanian phone number.
 * Accepts: 255XXXXXXXXX (E.164) or 0XXXXXXXXX (local) — normalises to E.164.
 */
export function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Already in E.164: 255XXXXXXXXX (12 digits), second digit is 6 or 7
  if (/^255[67]\d{8}$/.test(cleaned)) return cleaned;

  // Local format: 0XXXXXXXXX (10 digits)
  if (/^0[67]\d{8}$/.test(cleaned)) return `255${cleaned.slice(1)}`;

  // With +: +255XXXXXXXXX
  if (/^\+255[67]\d{8}$/.test(cleaned)) return cleaned.slice(1);

  throw TZPayError.invalidPhoneNumber(phone);
}

/**
 * Validates that a phone number belongs to a specific network prefix.
 * M-Pesa: 0741, 0742, 0743, 0744, 0745, 0746 (Vodacom)
 * Tigo:   0671, 0672, 0673, 0674, 0675 (Tigo)
 * Airtel: 0680–0689, 0690–0699 (Airtel)
 * Halo:   0621–0629 (HaloPesa / TTCL)
 */
export function detectNetwork(phone: string): string | null {
  let normalized: string;
  try {
    normalized = normalizePhoneNumber(phone);
  } catch {
    return null;
  }

  // E.164 format: 255XXXXXXXXX (12 digits)
  // slice(3,6) gives the first 3 digits after country code
  // e.g. 255741234567 → "741", 255682345678 → "682"
  const prefix = normalized.slice(3, 6);

  const networkMap: Record<string, string> = {
    // M-Pesa (Vodacom): 074x, 075x, 076x
    '741': 'mpesa', '742': 'mpesa', '743': 'mpesa', '744': 'mpesa',
    '745': 'mpesa', '746': 'mpesa', '747': 'mpesa', '748': 'mpesa', '749': 'mpesa',
    '750': 'mpesa', '751': 'mpesa', '752': 'mpesa', '753': 'mpesa', '754': 'mpesa',
    '755': 'mpesa', '756': 'mpesa', '757': 'mpesa', '758': 'mpesa', '759': 'mpesa',
    '760': 'mpesa', '761': 'mpesa', '762': 'mpesa', '763': 'mpesa', '764': 'mpesa',
    '765': 'mpesa', '766': 'mpesa', '767': 'mpesa', '768': 'mpesa', '769': 'mpesa',
    // Tigo Pesa: 071x, 065x, 067x
    '710': 'tigo', '711': 'tigo', '712': 'tigo', '713': 'tigo', '714': 'tigo',
    '715': 'tigo', '716': 'tigo', '717': 'tigo', '718': 'tigo', '719': 'tigo',
    '650': 'tigo', '651': 'tigo', '652': 'tigo', '653': 'tigo', '654': 'tigo',
    '671': 'tigo', '672': 'tigo', '673': 'tigo', '674': 'tigo', '675': 'tigo',
    // Airtel Money: 068x, 069x
    '680': 'airtel', '681': 'airtel', '682': 'airtel', '683': 'airtel', '684': 'airtel',
    '685': 'airtel', '686': 'airtel', '687': 'airtel', '688': 'airtel', '689': 'airtel',
    '690': 'airtel', '691': 'airtel', '692': 'airtel', '693': 'airtel', '694': 'airtel',
    '695': 'airtel', '696': 'airtel', '697': 'airtel', '698': 'airtel', '699': 'airtel',
    // HaloPesa (TTCL): 062x, 063x
    '620': 'halopesa', '621': 'halopesa', '622': 'halopesa', '623': 'halopesa',
    '624': 'halopesa', '625': 'halopesa', '626': 'halopesa', '627': 'halopesa',
    '628': 'halopesa', '629': 'halopesa',
    '630': 'halopesa', '631': 'halopesa', '632': 'halopesa', '633': 'halopesa',
  };

  return networkMap[prefix] ?? null;
}

/**
 * Validates a payment request — throws TZPayError if invalid.
 */
export function validatePaymentRequest(req: PaymentRequest): void {
  if (!req.amount || req.amount <= 0 || !Number.isInteger(req.amount)) {
    throw TZPayError.invalidAmount(req.amount);
  }
  if (req.amount < 100) {
    throw TZPayError.invalidAmount(req.amount); // min TZS 100
  }
  if (req.amount > 5_000_000) {
    throw new TZPayError({
      code: 'INVALID_AMOUNT' as any,
      message: `Amount ${req.amount} exceeds single-transaction limit of TZS 5,000,000`,
    });
  }
  if (req.currency !== Currency.TZS) {
    throw new TZPayError({
      code: 'INVALID_CURRENCY' as any,
      message: `Currency "${req.currency}" is not supported. Only TZS is accepted.`,
    });
  }
  normalizePhoneNumber(req.phoneNumber); // throws if invalid
  if (!req.reference || req.reference.trim().length === 0) {
    throw new TZPayError({
      code: 'MISSING_REQUIRED_FIELD' as any,
      message: 'reference is required',
    });
  }
}

export function validateSendMoneyRequest(req: SendMoneyRequest): void {
  validatePaymentRequest(req as PaymentRequest);
}

/**
 * Generates a unique transaction ID with a TZ-Pay-Connect prefix.
 */
export function generateTransactionId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TZP-${ts}-${rand}`;
}

/**
 * Returns current ISO 8601 timestamp.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Masks sensitive data for logging (show first 3 + last 2 chars of phone, hide secrets).
 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '***';
  return `${phone.slice(0, 6)}****${phone.slice(-2)}`;
}

export function maskSecret(secret: string): string {
  if (secret.length <= 6) return '***';
  return `${secret.slice(0, 3)}${'*'.repeat(secret.length - 6)}${secret.slice(-3)}`;
}
