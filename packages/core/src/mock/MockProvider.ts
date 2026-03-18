import {
  IProvider,
  Provider,
  Environment,
  PaymentRequest,
  PaymentResponse,
  SendMoneyRequest,
  SendMoneyResponse,
  TransactionStatusRequest,
  TransactionStatusResponse,
  RefundRequest,
  RefundResponse,
  BalanceResponse,
  PhoneVerificationResponse,
  WebhookPayload,
  TransactionStatus,
  Currency,
  TransactionType,
} from '../types';
import { TZPayError } from '../errors/TZPayError';
import { TZPayErrorCode } from '../types';
import { validatePaymentRequest, generateTransactionId, normalizePhoneNumber, nowISO } from '../utils/validation';

export interface MockProviderOptions {
  provider?: Provider;
  scenario?: 'success' | 'failure' | 'pending' | 'timeout' | number;
  delayMs?: number;
  initialBalance?: number;
}

export class MockProvider implements IProvider {
  public readonly name: Provider;
  public readonly environment: Environment = Environment.SANDBOX;

  private readonly scenario: MockProviderOptions['scenario'];
  private readonly delayMs: number;
  private balance: number;

  private transactions: Map<string, {
    status: TransactionStatus;
    amount: number;
    phoneNumber: string;
    reference: string;
    currency: Currency;
    type: TransactionType;
    createdAt: string;
  }> = new Map();

  constructor(options: MockProviderOptions = {}) {
    this.name = options.provider ?? Provider.AZAMPAY;
    this.scenario = options.scenario ?? 'success';
    this.delayMs = options.delayMs ?? 100;
    this.balance = options.initialBalance ?? 1_000_000;
  }

  async requestPayment(req: PaymentRequest): Promise<PaymentResponse> {
    validatePaymentRequest(req);
    await this.simulateDelay();
    this.maybeThrow();

    const phoneNumber = normalizePhoneNumber(req.phoneNumber);
    const transactionId = generateTransactionId();
    const status = this.resolveStatus();

    this.transactions.set(transactionId, {
      status, amount: req.amount, phoneNumber,
      reference: req.reference, currency: req.currency,
      type: TransactionType.C2B, createdAt: nowISO(),
    });

    return {
      transactionId,
      providerTransactionId: `MOCK-${transactionId}`,
      status,
      provider: this.name,
      amount: req.amount,
      currency: req.currency,
      phoneNumber,
      reference: req.reference,
      message: this.statusMessage(status, 'payment'),
      timestamp: nowISO(),
      raw: { mock: true, scenario: this.scenario },
    };
  }

  async sendMoney(req: SendMoneyRequest): Promise<SendMoneyResponse> {
    validatePaymentRequest(req as PaymentRequest);
    await this.simulateDelay();
    this.maybeThrow();

    if (req.amount > this.balance) {
      throw new TZPayError({
        code: TZPayErrorCode.INSUFFICIENT_FUNDS,
        message: `Insufficient balance. Available: TZS ${this.balance.toLocaleString()}, Requested: TZS ${req.amount.toLocaleString()}`,
        provider: this.name,
      });
    }

    const phoneNumber = normalizePhoneNumber(req.phoneNumber);
    const transactionId = generateTransactionId();
    const status = this.resolveStatus();

    if (status === TransactionStatus.SUCCESS) this.balance -= req.amount;

    this.transactions.set(transactionId, {
      status, amount: req.amount, phoneNumber,
      reference: req.reference, currency: req.currency,
      type: TransactionType.B2C, createdAt: nowISO(),
    });

    return {
      transactionId,
      providerTransactionId: `MOCK-${transactionId}`,
      status, provider: this.name, amount: req.amount,
      currency: req.currency, phoneNumber, reference: req.reference,
      message: this.statusMessage(status, 'disbursement'),
      timestamp: nowISO(), raw: { mock: true },
    };
  }

  async getTransactionStatus(req: TransactionStatusRequest): Promise<TransactionStatusResponse> {
    await this.simulateDelay();
    const txn = this.transactions.get(req.transactionId);

    if (!txn) {
      throw new TZPayError({
        code: TZPayErrorCode.TRANSACTION_NOT_FOUND,
        message: `Transaction "${req.transactionId}" not found.`,
        provider: this.name,
      });
    }

    return {
      transactionId: req.transactionId,
      providerTransactionId: `MOCK-${req.transactionId}`,
      status: txn.status, provider: this.name,
      amount: txn.amount, currency: txn.currency,
      phoneNumber: txn.phoneNumber, reference: txn.reference,
      message: this.statusMessage(txn.status, 'status check'),
      timestamp: nowISO(),
      completedAt: txn.status === TransactionStatus.SUCCESS ? nowISO() : undefined,
      raw: { mock: true },
    };
  }

  async refundTransaction(req: RefundRequest): Promise<RefundResponse> {
    await this.simulateDelay();
    const txn = this.transactions.get(req.transactionId);

    if (!txn) {
      throw new TZPayError({
        code: TZPayErrorCode.TRANSACTION_NOT_FOUND,
        message: `Transaction "${req.transactionId}" not found.`,
        provider: this.name,
      });
    }
    if (txn.status !== TransactionStatus.SUCCESS) {
      throw new TZPayError({
        code: TZPayErrorCode.TRANSACTION_FAILED,
        message: `Cannot refund a transaction with status: ${txn.status}`,
        provider: this.name,
      });
    }

    const refundAmount = req.amount ?? txn.amount;
    this.balance += refundAmount;
    txn.status = TransactionStatus.CANCELLED;

    return {
      refundId: generateTransactionId(),
      originalTransactionId: req.transactionId,
      status: TransactionStatus.SUCCESS,
      amount: refundAmount, currency: txn.currency,
      message: 'Refund processed successfully',
      timestamp: nowISO(), raw: { mock: true },
    };
  }

  async getBalance(): Promise<BalanceResponse> {
    await this.simulateDelay();
    return {
      provider: this.name, balance: this.balance,
      currency: Currency.TZS, accountName: 'Mock Business Account',
      timestamp: nowISO(), raw: { mock: true },
    };
  }

  async verifyPhoneNumber(phoneNumber: string): Promise<PhoneVerificationResponse> {
    await this.simulateDelay();
    try {
      const normalized = normalizePhoneNumber(phoneNumber);
      return {
        phoneNumber: normalized, isValid: true, isRegistered: true,
        provider: this.name, accountName: 'Mock Account Holder',
        message: 'Valid and registered (mock)',
      };
    } catch {
      return { phoneNumber, isValid: false, isRegistered: false };
    }
  }

  parseWebhook(payload: Record<string, unknown>): WebhookPayload {
    return {
      provider: this.name,
      transactionId: String(payload.transactionId ?? generateTransactionId()),
      providerTransactionId: String(payload.providerTransactionId ?? ''),
      status: (payload.status as TransactionStatus) ?? TransactionStatus.SUCCESS,
      amount: Number(payload.amount ?? 0),
      currency: Currency.TZS,
      phoneNumber: String(payload.phoneNumber ?? ''),
      reference: String(payload.reference ?? ''),
      timestamp: nowISO(), raw: payload,
    };
  }

  // ── Test Helpers ────────────────────────────────────────────────────

  getStoredTransactions() { return Object.fromEntries(this.transactions); }

  setTransactionStatus(transactionId: string, status: TransactionStatus): void {
    const txn = this.transactions.get(transactionId);
    if (txn) txn.status = status;
  }

  reset(balance?: number): void {
    this.transactions.clear();
    this.balance = balance ?? 1_000_000;
  }

  getCurrentBalance(): number { return this.balance; }

  // ── Private ────────────────────────────────────────────────────────

  private async simulateDelay(): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  private maybeThrow(): void {
    if (this.scenario === 'timeout') throw TZPayError.timeout(this.name);
  }

  private resolveStatus(): TransactionStatus {
    if (this.scenario === 'success') return TransactionStatus.SUCCESS;
    if (this.scenario === 'failure') return TransactionStatus.FAILED;
    if (this.scenario === 'pending') return TransactionStatus.PENDING;
    if (this.scenario === 'timeout') return TransactionStatus.FAILED;
    if (typeof this.scenario === 'number')
      return Math.random() * 100 < this.scenario ? TransactionStatus.SUCCESS : TransactionStatus.FAILED;
    return TransactionStatus.SUCCESS;
  }

  private statusMessage(status: TransactionStatus, op: string): string {
    const map: Record<TransactionStatus, string> = {
      [TransactionStatus.SUCCESS]: `Mock ${op} completed successfully`,
      [TransactionStatus.PENDING]: `Mock ${op} is pending`,
      [TransactionStatus.FAILED]: `Mock ${op} failed (simulated)`,
      [TransactionStatus.CANCELLED]: `Mock ${op} was cancelled`,
      [TransactionStatus.TIMEOUT]: `Mock ${op} timed out`,
      [TransactionStatus.QUEUED]: `Mock ${op} is queued`,
    };
    return map[status] ?? `Mock ${op}`;
  }
}
