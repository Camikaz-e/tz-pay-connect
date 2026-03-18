import { createApp } from './app';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: 'info',
    source: 'tz-pay-gateway',
    message: `TZ-Pay-Connect Gateway started`,
    port: PORT,
    host: HOST,
    environment: process.env.PROVIDER_ENV ?? 'sandbox',
    mockMode: process.env.PROVIDER_MOCK === 'true',
    timestamp: new Date().toISOString(),
  }));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(JSON.stringify({ level: 'info', source: 'tz-pay-gateway', message: 'SIGTERM received — shutting down gracefully' }));
  server.close(() => {
    console.log(JSON.stringify({ level: 'info', source: 'tz-pay-gateway', message: 'Server closed' }));
    process.exit(0);
  });
});

export default app;
