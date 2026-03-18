# TZ-Pay-Connect 🇹🇿

> **One SDK. All Tanzanian mobile money providers.**

[![Tests](https://img.shields.io/badge/tests-45%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

Stop learning five different APIs. TZ-Pay-Connect gives you a single, consistent interface for **M-Pesa, Tigo Pesa, Airtel Money, AzamPay, and HaloPesa**.

---

## Quick Start

```bash
npm install @tz-pay-connect/core
# or
pnpm add @tz-pay-connect/core
```

```typescript
import { TZPayConnect, Provider, Environment, Currency } from '@tz-pay-connect/core';

const tzPay = new TZPayConnect({
  provider: Provider.AZAMPAY,
  credentials: {
    apiKey: 'your-app-name',
    apiSecret: 'your-client-secret',
    extra: { clientId: 'your-client-id' },
  },
  environment: Environment.SANDBOX, // switch to PRODUCTION when ready
});

// Request a payment (push to customer's phone)
const payment = await tzPay.requestPayment({
  amount: 5000,           // TZS — whole numbers only
  currency: Currency.TZS,
  phoneNumber: '255712345678',
  reference: 'ORDER-001',
  description: 'Payment for order #001',
});

console.log(payment.transactionId); // TZP-XXXXXXXX
console.log(payment.status);        // PENDING → poll for final status

// Check status
const status = await tzPay.getTransactionStatus({
  transactionId: payment.transactionId,
  providerTransactionId: payment.providerTransactionId,
});

// Handle webhook callback
app.post('/webhook', (req, res) => {
  const result = tzPay.parseWebhook(req.body);
  if (result.status === 'SUCCESS') {
    fulfillOrder(result.reference);
  }
  res.sendStatus(200);
});
```

---

## Supported Providers

| Provider     | C2B (Push) | B2C (Payout) | Status Check | Refund | Sandbox |
|-------------|------------|--------------|--------------|--------|---------|
| **AzamPay** | ✅ | ✅ | ✅ | ❌ | ✅ |
| M-Pesa      | 🔜 | 🔜 | 🔜 | 🔜 | 🔜 |
| Tigo Pesa   | 🔜 | 🔜 | 🔜 | 🔜 | 🔜 |
| Airtel Money| 🔜 | 🔜 | 🔜 | 🔜 | 🔜 |
| HaloPesa    | 🔜 | 🔜 | 🔜 | 🔜 | 🔜 |

---

## Project Structure

```
tz-pay-connect/
├── packages/
│   ├── core/                  ← TypeScript SDK (you are here)
│   │   ├── src/
│   │   │   ├── types/         ← Unified interfaces & enums
│   │   │   ├── errors/        ← TZPayError class
│   │   │   ├── providers/     ← Provider adapters
│   │   │   │   ├── BaseProvider.ts
│   │   │   │   └── AzamPayProvider.ts
│   │   │   └── utils/         ← validation, retry, logger
│   │   └── __tests__/
│   │       └── unit/          ← 45 tests, all passing ✅
│   ├── sdk-python/            ← Coming Phase 3
│   ├── sdk-php/               ← Coming Phase 3
│   └── sdk-flutter/           ← Coming Phase 3
└── docs/                      ← Coming Phase 4
```

---

## Error Handling

Every error is a typed `TZPayError` with a `code` you can handle:

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
        return res.status(504).json({ error: 'Provider timed out, please retry' });
      default:
        return res.status(500).json({ error: err.message });
    }
  }
}
```

---

## Getting Sandbox Credentials

### AzamPay (Recommended — start here)
1. Register at [developers.azampay.co.tz](https://developers.azampay.co.tz)
2. Create an app to get your `clientId`, `appName`, and `clientSecret`
3. Use `Environment.SANDBOX` — no real money involved

---

## Running Tests

```bash
cd packages/core
pnpm test              # run all tests
pnpm test:coverage     # with coverage report
pnpm test:watch        # watch mode
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All PRs welcome!

---

## License

MIT © TZ-Pay-Connect Contributors
