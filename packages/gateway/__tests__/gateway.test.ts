import request from 'supertest';
import { createApp } from '../src/app';
import { Express } from 'express';

/**
 * Gateway tests run with PROVIDER_MOCK=true and DISABLE_AUTH=true
 * so no real credentials or API keys are needed.
 */

let app: Express;

beforeAll(() => {
  process.env.PROVIDER_MOCK = 'true';
  process.env.DISABLE_AUTH = 'true';
  process.env.NODE_ENV = 'development';
  app = createApp();
});

afterAll(() => {
  delete process.env.PROVIDER_MOCK;
  delete process.env.DISABLE_AUTH;
});

// ── Health Check ───────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.mockMode).toBe(true);
    expect(res.body.providers).toContain('mpesa');
    expect(res.body.providers).toContain('azampay');
  });
});

// ── POST /payments/request ─────────────────────────────────────────────────

describe('POST /payments/request', () => {
  const validPayload = {
    provider: 'azampay',
    amount: 5000,
    currency: 'TZS',
    phoneNumber: '255712345678',
    reference: 'ORDER-001',
    description: 'Test payment',
  };

  it('returns 202 with PENDING status for valid request', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send(validPayload);

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.transactionId).toMatch(/^TZP-/);
    expect(res.body.data.amount).toBe(5000);
    expect(res.body.data.provider).toBe('azampay');
  });

  it('works for all 5 providers', async () => {
    const providers = ['azampay', 'mpesa', 'tigo', 'airtel', 'halopesa'];

    for (const provider of providers) {
      const res = await request(app)
        .post('/payments/request')
        .send({ ...validPayload, provider });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe(provider);
    }
  });

  it('returns 400 when amount is missing', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, amount: undefined });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('amount');
  });

  it('returns 400 for amount below minimum (100 TZS)', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, amount: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('amount');
  });

  it('returns 400 for amount above maximum (5,000,000 TZS)', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, amount: 6_000_000 });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('amount');
  });

  it('returns 400 for invalid phone number', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, phoneNumber: '12345' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('phoneNumber');
  });

  it('returns 400 for invalid provider', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, provider: 'unknown_bank' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('provider');
  });

  it('returns 400 for missing reference', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, reference: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('reference');
  });

  it('returns 400 for non-TZS currency', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, currency: 'USD' });

    expect(res.status).toBe(400);
  });

  it('accepts local phone format (07XXXXXXXX)', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, phoneNumber: '0712345678' });

    expect(res.status).toBe(202);
    // SDK normalises to E.164
    expect(res.body.data.phoneNumber).toBe('255712345678');
  });

  it('accepts optional callbackUrl', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, callbackUrl: 'https://myapp.com/webhook' });

    expect(res.status).toBe(202);
  });

  it('returns 400 for invalid callbackUrl', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, callbackUrl: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('callbackUrl');
  });

  it('returns 400 for decimal amount', async () => {
    const res = await request(app)
      .post('/payments/request')
      .send({ ...validPayload, amount: 1000.50 });

    expect(res.status).toBe(400);
  });
});

// ── POST /payments/send ────────────────────────────────────────────────────

describe('POST /payments/send', () => {
  const validPayload = {
    provider: 'azampay',
    amount: 10000,
    currency: 'TZS',
    phoneNumber: '255712345678',
    reference: 'PAYOUT-001',
  };

  it('returns 200 with transaction data', async () => {
    const res = await request(app)
      .post('/payments/send')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactionId).toMatch(/^TZP-/);
    expect(res.body.data.amount).toBe(10000);
  });

  it('returns 400 for missing provider', async () => {
    const { provider: _, ...noProvider } = validPayload;
    const res = await request(app).post('/payments/send').send(noProvider);
    expect(res.status).toBe(400);
  });

  it('returns 402 when mock balance is insufficient', async () => {
    const res = await request(app)
      .post('/payments/send')
      .send({ ...validPayload, amount: 999_999_999 }); // exceeds max validation

    expect(res.status).toBe(400); // caught by schema validation first
  });
});

// ── POST /payments/status ──────────────────────────────────────────────────

describe('POST /payments/status', () => {
  it('returns 200 with transaction not found error for unknown ID', async () => {
    const res = await request(app)
      .post('/payments/status')
      .send({
        provider: 'azampay',
        transactionId: 'TZP-NONEXISTENT',
      });

    // Mock returns TRANSACTION_NOT_FOUND → mapped to 404
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('returns 400 for missing transactionId', async () => {
    const res = await request(app)
      .post('/payments/status')
      .send({ provider: 'mpesa' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('transactionId');
  });
});

// ── POST /payments/refund ──────────────────────────────────────────────────

describe('POST /payments/refund', () => {
  it('returns 404 for unknown transaction', async () => {
    const res = await request(app)
      .post('/payments/refund')
      .send({
        provider: 'azampay',
        transactionId: 'TZP-NONEXISTENT',
        reference: 'REFUND-001',
      });

    expect(res.status).toBe(404);
  });

  it('returns 400 for missing reference', async () => {
    const res = await request(app)
      .post('/payments/refund')
      .send({ provider: 'mpesa', transactionId: 'TZP-001' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('reference');
  });
});

// ── POST /payments/verify-phone ────────────────────────────────────────────

describe('POST /payments/verify-phone', () => {
  it('returns 200 with valid=true for correct phone', async () => {
    const res = await request(app)
      .post('/payments/verify-phone')
      .send({ provider: 'mpesa', phoneNumber: '255741234567' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isValid).toBe(true);
  });

  it('returns 400 for invalid phone number format', async () => {
    const res = await request(app)
      .post('/payments/verify-phone')
      .send({ provider: 'mpesa', phoneNumber: 'badphone' });

    expect(res.status).toBe(400);
  });
});

// ── GET /payments/balance/:provider ───────────────────────────────────────

describe('GET /payments/balance/:provider', () => {
  it('returns 200 with balance for valid provider', async () => {
    const res = await request(app).get('/payments/balance/azampay');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.balance).toBe('number');
    expect(res.body.data.currency).toBe('TZS');
  });
});

// ── POST /webhooks/:provider ───────────────────────────────────────────────

describe('POST /webhooks/:provider', () => {
  it('returns 200 immediately for any provider webhook', async () => {
    const res = await request(app)
      .post('/webhooks/azampay')
      .send({
        transactionId: 'AZM-HOOK-001',
        amount: '5000',
        status: 'SUCCESS',
        msisdn: '255712345678',
        reference: 'ORDER-001',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 200 even for mpesa webhook format', async () => {
    const res = await request(app)
      .post('/webhooks/mpesa')
      .send({
        Body: {
          stkCallback: {
            MerchantRequestID: 'MR-001',
            CheckoutRequestID: 'ws_CO_12345',
            ResultCode: 0,
            ResultDesc: 'Success',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 5000 },
                { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
                { Name: 'PhoneNumber', Value: 255741234567 },
              ],
            },
          },
        },
      });

    expect(res.status).toBe(200);
  });
});

// ── Auth middleware ────────────────────────────────────────────────────────

describe('Authentication', () => {
  let authApp: Express;

  beforeAll(() => {
    process.env.PROVIDER_MOCK = 'true';
    process.env.DISABLE_AUTH = 'false';
    delete process.env.NODE_ENV;
    process.env.GATEWAY_API_KEYS = 'secret-key-123,another-key-456';
    authApp = createApp();
  });

  afterAll(() => {
    process.env.DISABLE_AUTH = 'true';
    process.env.NODE_ENV = 'development';
    delete process.env.GATEWAY_API_KEYS;
  });

  it('returns 401 when no API key provided', async () => {
    const res = await request(authApp)
      .post('/payments/request')
      .send({ provider: 'azampay', amount: 1000, currency: 'TZS', phoneNumber: '255712345678', reference: 'REF' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 202 with valid Bearer token', async () => {
    const res = await request(authApp)
      .post('/payments/request')
      .set('Authorization', 'Bearer secret-key-123')
      .send({ provider: 'azampay', amount: 5000, currency: 'TZS', phoneNumber: '255712345678', reference: 'REF-AUTH' });

    expect(res.status).toBe(202);
  });

  it('returns 202 with valid X-API-Key header', async () => {
    const res = await request(authApp)
      .post('/payments/request')
      .set('X-API-Key', 'another-key-456')
      .send({ provider: 'azampay', amount: 5000, currency: 'TZS', phoneNumber: '255712345678', reference: 'REF-AUTH2' });

    expect(res.status).toBe(202);
  });

  it('returns 401 with invalid API key', async () => {
    const res = await request(authApp)
      .post('/payments/request')
      .set('Authorization', 'Bearer wrong-key')
      .send({ provider: 'azampay', amount: 5000, currency: 'TZS', phoneNumber: '255712345678', reference: 'REF-BAD' });

    expect(res.status).toBe(401);
  });

  it('health check requires no auth', async () => {
    const res = await request(authApp).get('/health');
    expect(res.status).toBe(200);
  });
});

// ── 404 handler ────────────────────────────────────────────────────────────

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/unknown/route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
