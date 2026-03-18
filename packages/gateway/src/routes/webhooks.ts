import { Router, Request, Response, NextFunction } from 'express';
import { buildProvider } from '../providerFactory';

export const webhooksRouter = Router();

/**
 * POST /webhooks/:provider
 * Receive and parse payment callbacks from any provider.
 *
 * This endpoint:
 * 1. Parses the raw provider payload into a unified WebhookPayload
 * 2. Returns 200 immediately (providers require fast ack)
 * 3. Logs the parsed payload
 *
 * In production, add your own business logic here (fulfill orders, etc.)
 *
 * @example
 * M-Pesa will POST to: https://your-gateway.com/webhooks/mpesa
 * AzamPay will POST to: https://your-gateway.com/webhooks/azampay
 */
webhooksRouter.post(
  '/:provider',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider } = req.params;

      // Always ACK immediately — providers retry if they get a slow response
      res.status(200).json({ success: true, message: 'Webhook received' });

      // Parse the payload asynchronously after responding
      try {
        const tzPay = buildProvider(provider);
        const parsed = tzPay.parseWebhook(req.body);

        console.log(JSON.stringify({
          level: 'info',
          source: 'tz-pay-gateway',
          event: 'webhook_received',
          provider,
          transactionId: parsed.transactionId,
          status: parsed.status,
          amount: parsed.amount,
          reference: parsed.reference,
          timestamp: parsed.timestamp,
        }));

        // TODO: emit event, call your order fulfillment service, etc.
        // e.g. eventEmitter.emit('payment', parsed);

      } catch (parseErr) {
        console.error(JSON.stringify({
          level: 'error',
          source: 'tz-pay-gateway',
          event: 'webhook_parse_error',
          provider,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        }));
      }

    } catch (err) {
      next(err);
    }
  }
);
