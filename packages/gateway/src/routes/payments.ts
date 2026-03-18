import { Router, Request, Response, NextFunction } from 'express';
import { Currency } from '@tz-pay-connect/core';
import { validate } from '../middleware/validate';
import { buildProvider } from '../providerFactory';
import {
  requestPaymentSchema,
  sendMoneySchema,
  transactionStatusSchema,
  refundSchema,
  verifyPhoneSchema,
  RequestPaymentBody,
  SendMoneyBody,
  TransactionStatusBody,
  RefundBody,
  VerifyPhoneBody,
} from '../validators/schemas';

export const paymentsRouter = Router();

/**
 * POST /payments/request
 * Initiate a C2B push payment (prompt customer to pay on their phone).
 *
 * @example
 * POST /payments/request
 * {
 *   "provider": "azampay",
 *   "amount": 5000,
 *   "currency": "TZS",
 *   "phoneNumber": "255712345678",
 *   "reference": "ORDER-001",
 *   "description": "Payment for order #001",
 *   "callbackUrl": "https://your-app.com/webhook"
 * }
 */
paymentsRouter.post(
  '/request',
  validate(requestPaymentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as RequestPaymentBody;
      const tzPay = buildProvider(body.provider);

      const result = await tzPay.requestPayment({
        amount: body.amount,
        currency: body.currency as Currency,
        phoneNumber: body.phoneNumber,
        reference: body.reference,
        description: body.description,
        callbackUrl: body.callbackUrl,
        metadata: body.metadata,
      });

      res.status(202).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /payments/send
 * Send money to a customer (B2C payout / disbursement).
 *
 * @example
 * POST /payments/send
 * {
 *   "provider": "mpesa",
 *   "amount": 10000,
 *   "currency": "TZS",
 *   "phoneNumber": "255741234567",
 *   "reference": "PAYOUT-001"
 * }
 */
paymentsRouter.post(
  '/send',
  validate(sendMoneySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as SendMoneyBody;
      const tzPay = buildProvider(body.provider);

      const result = await tzPay.sendMoney({
        amount: body.amount,
        currency: body.currency as Currency,
        phoneNumber: body.phoneNumber,
        reference: body.reference,
        description: body.description,
        callbackUrl: body.callbackUrl,
        metadata: body.metadata,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /payments/status
 * Check the current status of a transaction.
 *
 * @example
 * POST /payments/status
 * {
 *   "provider": "azampay",
 *   "transactionId": "TZP-XXXXXXXX",
 *   "providerTransactionId": "AZM-TXN-001"
 * }
 */
paymentsRouter.post(
  '/status',
  validate(transactionStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as TransactionStatusBody;
      const tzPay = buildProvider(body.provider);

      const result = await tzPay.getTransactionStatus({
        transactionId: body.transactionId,
        providerTransactionId: body.providerTransactionId,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /payments/refund
 * Refund or reverse a completed transaction.
 *
 * @example
 * POST /payments/refund
 * {
 *   "provider": "mpesa",
 *   "transactionId": "TZP-XXXXXXXX",
 *   "amount": 5000,
 *   "reference": "REFUND-001",
 *   "reason": "Customer requested refund"
 * }
 */
paymentsRouter.post(
  '/refund',
  validate(refundSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as RefundBody;
      const tzPay = buildProvider(body.provider);

      const result = await tzPay.refundTransaction({
        transactionId: body.transactionId,
        amount: body.amount,
        reason: body.reason,
        reference: body.reference,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /payments/verify-phone
 * Verify if a phone number is registered for mobile money.
 *
 * @example
 * POST /payments/verify-phone
 * { "provider": "mpesa", "phoneNumber": "255741234567" }
 */
paymentsRouter.post(
  '/verify-phone',
  validate(verifyPhoneSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as VerifyPhoneBody;
      const tzPay = buildProvider(body.provider);

      const result = await tzPay.verifyPhoneNumber(body.phoneNumber);

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /payments/balance/:provider
 * Get current wallet/account balance.
 *
 * @example GET /payments/balance/azampay
 */
paymentsRouter.get(
  '/balance/:provider',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider } = req.params;
      const tzPay = buildProvider(provider);

      const result = await tzPay.getBalance();

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
