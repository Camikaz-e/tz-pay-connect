import { AuditLogEntry, TransactionStatus, TransactionType, Provider, Currency } from '../types';
import { maskPhone } from './validation';

export interface AuditLoggerOptions {
  enabled: boolean;
  /** Custom log sink — defaults to console.log in JSON */
  sink?: (entry: AuditLogEntry) => void;
}

/**
 * Structured audit logger for all payment operations.
 * Every transaction is logged with timing, status, and masked PII.
 * Pluggable sink allows writing to files, databases, or log services.
 */
export class AuditLogger {
  private readonly enabled: boolean;
  private readonly sink: (entry: AuditLogEntry) => void;

  constructor(options: AuditLoggerOptions) {
    this.enabled = options.enabled;
    this.sink = options.sink ?? defaultSink;
  }

  log(entry: Omit<AuditLogEntry, 'phoneNumber'> & { phoneNumber: string }): void {
    if (!this.enabled) return;

    const safeEntry: AuditLogEntry = {
      ...entry,
      phoneNumber: maskPhone(entry.phoneNumber),
    };

    this.sink(safeEntry);
  }

  /**
   * Helper to time an operation and log it automatically.
   */
  async timed<T>(
    context: {
      provider: Provider;
      transactionType: TransactionType;
      phoneNumber: string;
      amount: number;
      currency: Currency;
      reference: string;
      transactionId?: string;
      metadata?: Record<string, unknown>;
    },
    operation: () => Promise<T>
  ): Promise<T> {
    const startMs = Date.now();
    const id = context.transactionId ?? `pending-${Date.now()}`;

    try {
      const result = await operation();
      this.log({
        id,
        timestamp: new Date().toISOString(),
        ...context,
        transactionId: id,
        status: TransactionStatus.SUCCESS,
        durationMs: Date.now() - startMs,
      });
      return result;
    } catch (err) {
      this.log({
        id,
        timestamp: new Date().toISOString(),
        ...context,
        transactionId: id,
        status: TransactionStatus.FAILED,
        durationMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

function defaultSink(entry: AuditLogEntry): void {
  console.log(JSON.stringify({ level: 'info', source: 'tz-pay-connect', ...entry }));
}
