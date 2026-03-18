# TZ-Pay-Connect 🇹🇿

> **One SDK. All Tanzanian mobile money providers.**

[![CI](https://github.com/Camikaz-e/tz-pay-connect/actions/workflows/ci.yml/badge.svg)](https://github.com/Camikaz-e/tz-pay-connect/actions)
[![Tests](https://img.shields.io/badge/tests-130%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#contributing)

Stop learning five different APIs. TZ-Pay-Connect gives you **one consistent interface** for all Tanzanian mobile money providers.

---

## Supported Providers

| Provider | C2B (Push) | B2C (Payout) | Status | Refund | Auth Style |
|---|---|---|---|---|---|
| **AzamPay** | ✅ | ✅ | ✅ | ❌ | OAuth2 |
| **M-Pesa (Vodacom TZ)** | ✅ | ✅ | ✅ | ✅ | OAuth2 + HMAC |
| **Tigo Pesa** | ✅ | ✅ | ✅ | ❌ | OAuth2 |
| **Airtel Money** | ✅ | ✅ | ✅ | ❌ | OAuth2 |
| **HaloPesa (TTCL)** | ✅ | ✅ | ✅ | ❌ | HMAC-SHA256 |

---

## Quick Start

```bash
cd packages/core
pnpm install
```

```typescript
import { TZPayConnect, Provider, Environment, Currency } from '@tz-pay-connect/core';

// Works with ANY provider — same code, just change the provider name
const tzPay = new TZPayConnect({
  provider: Provider.AZAMPAY,
  credentials: {
    apiKey: 'your-app-name',
    apiSecret: 'your-client-secret',
    extra: { clientId: 'your-client-id' },
  },
  environment: Environment.SANDBOX,
});

// Request a payment (push to customer phone)
const payment = await tzPay.requestPayment({
  amount: 5000,
  currency: Currency.TZS,
  phoneNumber: '255712345678',
  reference: 'ORDER-001',
  description: 'Payment for order #001',
});

// Check status
const status = await tzPay.getTransactionStatus({
  transactionId: payment.transactionId,
  providerTransactionId: payment.providerTransactionId,
});

// Handle webhook callback
app.post('/webhook', (req, res) => {
  const result = tzPay.parseWebhook(req.body);
  if (result.status === 'SUCCESS') fulfillOrder(result.reference);
  res.sendStatus(200);
});
```

---

## Development Without Real Credentials

Use the built-in mock — zero real API calls, full functionality:

```typescript
const tzPay = new TZPayConnect({
  provider: Provider.MPESA,
  credentials: { apiKey: 'any' },
  environment: Environment.SANDBOX,
  useMock: true, // ← works without any real credentials
});

const result = await tzPay.requestPayment({ ... }); // returns realistic fake response
```

---

## Error Handling

Every error is a typed `TZPayError` with a code you can switch on:

```typescript
import { TZPayError, TZPayErrorCode } from '@tz-pay-connect/core';

try {
  await tzPay.requestPayment(req);
} catch (err) {
  if (err instanceof TZPayError) {
    switch (err.code) {
      case TZPayErrorCode.INVALID_PHONE_NUMBER:
        return res.status(400).json({ error: 'Invalid phone number' });
      case TZPayErrorCode.INSUFFICIENT_FUNDS:
        return res.status(402).json({ error: 'Insufficient funds' });
      case TZPayErrorCode.TIMEOUT:
        return res.status(504).json({ error: 'Provider timed out' });
    }
  }
}
```

---

## Project Structure

```
tz-pay-connect/
├── packages/
│   ├── core/                        ← TypeScript SDK
│   │   ├── src/
│   │   │   ├── types/               ← Unified interfaces & enums
│   │   │   ├── errors/              ← TZPayError class
│   │   │   ├── providers/           ← All 5 provider adapters
│   │   │   ├── mock/                ← MockProvider for testing
│   │   │   └── utils/               ← validation, retry, logger
│   │   └── __tests__/               ← 130 tests, all passing
│   └── gateway/                     ← Self-hostable REST API Gateway
│       ├── src/
│       │   ├── routes/              ← payments, webhooks, health
│       │   ├── middleware/          ← auth, validation, error handling
│       │   └── validators/          ← Zod request schemas
│       └── __tests__/               ← Gateway integration tests
├── .env.example                     ← Copy to .env and fill in credentials
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

---

## ⚠️ Important Disclaimer — Sandbox URLs

> **The sandbox/API URLs hardcoded in this SDK are based on each provider's publicly available documentation. Not all Tanzanian providers offer a self-serve public sandbox.**
>
> When you receive real credentials from a provider, they will give you the correct API URL for your account. You can override the default URL using `baseUrl` in your config:
>
> ```typescript
> const tzPay = new TZPayConnect({
>   provider: Provider.MPESA,
>   credentials: { ... },
>   environment: Environment.SANDBOX,
>   baseUrl: 'https://actual-url-the-provider-gave-you.co.tz', // ← override here
> });
> ```
>
> **Do not assume the default URLs in the code will work for your account without confirmation from the provider.**

| Provider | Default URL Used | Sandbox Available |
|---|---|---|
| **AzamPay** | `sandbox.azampay.co.tz` | ✅ Self-serve public sandbox |
| **M-Pesa TZ** | `sandbox.safaricom.co.ke` | ⚠️ Daraja-compatible structure — Vodacom TZ gives you their own URL |
| **Tigo Pesa** | `sandbox.tigopesa.co.tz` | ❌ No public sandbox — URL provided with credentials |
| **Airtel Money** | `openapiuat.airtel.africa` | ⚠️ UAT exists but TZ access requires approval |
| **HaloPesa** | `apigw.halopesa.co.tz/sandbox` | ❌ No public sandbox — URL provided with credentials |

---

## Getting Sandbox Credentials

| Provider | How to Get Access |
|---|---|
| **AzamPay** | Self-serve at [developers.azampay.co.tz](https://developers.azampay.co.tz) ✅ |
| **M-Pesa TZ** | Contact Vodacom Tanzania: `mpesa.api@vodacom.co.tz` |
| **Tigo Pesa** | Contact MIC Tanzania: `developer@tigo.co.tz` |
| **Airtel Money** | Register at [developers.airtel.africa](https://developers.airtel.africa) |
| **HaloPesa** | Contact TTCL: [ttcl.co.tz](https://www.ttcl.co.tz) |

See `.env.example` for detailed setup instructions per provider.

---

## Running Tests

```bash
cd packages/core
pnpm install
pnpm test              # 130 tests
pnpm test:coverage     # with coverage report
```

---

## REST API Gateway

The gateway wraps the SDK as a self-hostable HTTP service — so Python, PHP, and Flutter apps can use it too.

```bash
cd packages/gateway
pnpm install
cp ../../.env.example ../../.env  # fill in credentials
pnpm dev                           # starts on port 3000
```

```bash
# Request a payment
curl -X POST http://localhost:3000/payments/request \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"provider":"azampay","amount":5000,"currency":"TZS","phoneNumber":"255712345678","reference":"ORDER-001"}'

# Health check
curl http://localhost:3000/health
```

---

## Roadmap

- [x] TypeScript core SDK
- [x] All 5 providers (AzamPay, M-Pesa, Tigo, Airtel, HaloPesa)
- [x] MockProvider for development
- [x] REST API Gateway
- [ ] Python SDK
- [ ] PHP SDK
- [ ] Flutter/Dart SDK
- [ ] NIDA KYC integration
- [ ] TRA receipt generation
- [ ] Documentation site

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All PRs welcome — especially provider improvements, bug fixes, and documentation!

## License

MIT © TZ-Pay-Connect Contributors
