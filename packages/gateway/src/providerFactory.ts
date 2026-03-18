import {
  TZPayConnect,
  Provider,
  Environment,
  TZPayConnectConfig,
} from '@tz-pay-connect/core';

/**
 * Builds a TZPayConnect instance from a provider name + environment variables.
 *
 * Credentials are read from environment variables — NEVER from request bodies.
 *
 * Environment variable naming convention:
 *   MPESA_API_KEY, MPESA_API_SECRET, MPESA_SHORT_CODE, MPESA_PASS_KEY, ...
 *   AZAMPAY_API_KEY, AZAMPAY_API_SECRET, AZAMPAY_CLIENT_ID, ...
 *   TIGO_API_KEY, TIGO_API_SECRET, TIGO_BILLER_MSISDN, ...
 *   AIRTEL_API_KEY, AIRTEL_API_SECRET, ...
 *   HALOPESA_API_KEY, HALOPESA_API_SECRET, HALOPESA_MERCHANT_ID, ...
 *
 * Set PROVIDER_MOCK=true to use MockProvider for all providers (no credentials needed).
 */
export function buildProvider(providerName: string): TZPayConnect {
  const useMock = process.env.PROVIDER_MOCK === 'true';
  const environment =
    process.env.PROVIDER_ENV === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;

  const provider = providerName as Provider;
  const config = buildConfig(provider, environment);

  return new TZPayConnect({ ...config, useMock } as any);
}

function buildConfig(provider: Provider, environment: Environment): TZPayConnectConfig {
  const base = {
    provider,
    environment,
    timeout: Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000),
    maxRetries: Number(process.env.MAX_RETRIES ?? 3),
    auditLogging: process.env.AUDIT_LOGGING !== 'false',
  };

  switch (provider) {
    case Provider.AZAMPAY:
      return {
        ...base,
        credentials: {
          apiKey: env('AZAMPAY_API_KEY'),
          apiSecret: env('AZAMPAY_API_SECRET'),
          extra: {
            clientId: env('AZAMPAY_CLIENT_ID'),
          },
        },
      };

    case Provider.MPESA:
      return {
        ...base,
        credentials: {
          apiKey: env('MPESA_API_KEY'),
          apiSecret: env('MPESA_API_SECRET'),
          extra: {
            shortCode: env('MPESA_SHORT_CODE'),
            passKey: env('MPESA_PASS_KEY'),
            callbackUrl: process.env.MPESA_CALLBACK_URL ?? '',
            b2cInitiator: process.env.MPESA_B2C_INITIATOR ?? '',
            securityCred: process.env.MPESA_SECURITY_CRED ?? '',
          },
        },
      };

    case Provider.TIGO:
      return {
        ...base,
        credentials: {
          apiKey: env('TIGO_API_KEY'),
          apiSecret: env('TIGO_API_SECRET'),
          extra: {
            billerCode: env('TIGO_BILLER_CODE'),
            billerMSISDN: env('TIGO_BILLER_MSISDN'),
            accountMSISDN: process.env.TIGO_ACCOUNT_MSISDN ?? '',
            accountName: process.env.TIGO_ACCOUNT_NAME ?? '',
          },
        },
      };

    case Provider.AIRTEL:
      return {
        ...base,
        credentials: {
          apiKey: env('AIRTEL_API_KEY'),
          apiSecret: env('AIRTEL_API_SECRET'),
          extra: {
            country: process.env.AIRTEL_COUNTRY ?? 'TZ',
            currency: process.env.AIRTEL_CURRENCY ?? 'TZS',
            msisdn: process.env.AIRTEL_MSISDN ?? '',
          },
        },
      };

    case Provider.HALOPESA:
      return {
        ...base,
        credentials: {
          apiKey: env('HALOPESA_API_KEY'),
          apiSecret: env('HALOPESA_API_SECRET'),
          extra: {
            merchantId: env('HALOPESA_MERCHANT_ID'),
            callbackUrl: process.env.HALOPESA_CALLBACK_URL ?? '',
          },
        },
      };

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Read a required env var — throws clearly if missing.
 * In mock mode, returns a placeholder so startup doesn't fail.
 */
function env(key: string): string {
  const value = process.env[key];
  if (!value) {
    if (process.env.PROVIDER_MOCK === 'true') return `mock-${key.toLowerCase()}`;
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Set it in your .env file or environment. See docs for setup guide.`
    );
  }
  return value;
}
