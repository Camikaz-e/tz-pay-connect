import { z } from 'zod';

// ── Reusable field schemas ─────────────────────────────────────────────────

const phoneSchema = z
  .string()
  .min(10, 'Phone number too short')
  .max(15, 'Phone number too long')
  .regex(/^(\+?255|0)[67]\d{8}$/, 'Invalid Tanzanian phone number. Use 255XXXXXXXXX or 07XXXXXXXX');

const amountSchema = z
  .number({ invalid_type_error: 'amount must be a number' })
  .int('amount must be a whole number (no decimals)')
  .min(100, 'Minimum amount is TZS 100')
  .max(5_000_000, 'Maximum single transaction is TZS 5,000,000');

const referenceSchema = z
  .string()
  .min(1, 'reference is required')
  .max(100, 'reference must be under 100 characters')
  .regex(/^[a-zA-Z0-9\-_]+$/, 'reference must be alphanumeric (hyphens and underscores allowed)');

const providerSchema = z.enum(
  ['mpesa', 'tigo', 'airtel', 'azampay', 'halopesa'],
  { errorMap: () => ({ message: 'provider must be one of: mpesa, tigo, airtel, azampay, halopesa' }) }
);

// ── Request Schemas ────────────────────────────────────────────────────────

export const requestPaymentSchema = z.object({
  provider: providerSchema,
  amount: amountSchema,
  currency: z.literal('TZS'),
  phoneNumber: phoneSchema,
  reference: referenceSchema,
  description: z.string().max(200).optional(),
  callbackUrl: z.string().url('callbackUrl must be a valid URL').optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const sendMoneySchema = z.object({
  provider: providerSchema,
  amount: amountSchema,
  currency: z.literal('TZS'),
  phoneNumber: phoneSchema,
  reference: referenceSchema,
  description: z.string().max(200).optional(),
  callbackUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const transactionStatusSchema = z.object({
  provider: providerSchema,
  transactionId: z.string().min(1, 'transactionId is required'),
  providerTransactionId: z.string().optional(),
});

export const refundSchema = z.object({
  provider: providerSchema,
  transactionId: z.string().min(1, 'transactionId is required'),
  amount: amountSchema.optional(),
  reason: z.string().max(200).optional(),
  reference: referenceSchema,
});

export const verifyPhoneSchema = z.object({
  provider: providerSchema,
  phoneNumber: phoneSchema,
});

export const webhookSchema = z.object({
  provider: providerSchema,
});

// ── Inferred Types ─────────────────────────────────────────────────────────

export type RequestPaymentBody = z.infer<typeof requestPaymentSchema>;
export type SendMoneyBody = z.infer<typeof sendMoneySchema>;
export type TransactionStatusBody = z.infer<typeof transactionStatusSchema>;
export type RefundBody = z.infer<typeof refundSchema>;
export type VerifyPhoneBody = z.infer<typeof verifyPhoneSchema>;
