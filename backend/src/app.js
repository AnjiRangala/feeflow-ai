import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createAuthenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createAssistantRouter } from './routes/assistant.routes.js';
import { createFeeRouter } from './routes/fee.routes.js';
import { createPaymentRouter } from './routes/payment.routes.js';
import { createParentPaymentRouter } from './routes/parent-payment.routes.js';
import { createReminderRouter } from './routes/reminder.routes.js';
import { createRefundRouter } from './routes/refund.routes.js';
import { createRiskRouter } from './routes/risk.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';
import { verifyRazorpayWebhookSignature } from './services/payment-provider.js';
import { processRazorpayWebhook } from './services/parent-payments.js';
import { createRequestMetrics } from './lib/logger.js';

export function createApp({ config, models, deliverOtp, deliverInvitation = async () => {}, logOtp, messageProvider, auditLog, riskFetchImpl }) {
  const app = express();
  const requestMetrics = createRequestMetrics();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: config.FRONTEND_URL,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.post('/api/parent-payments/webhooks/razorpay', express.raw({ type: 'application/json', limit: '50kb' }),
    async (req, res, next) => {
      try {
        if (config.PAYMENT_PROVIDER !== 'razorpay') return res.status(404).json({ error: 'Payment gateway is disabled' });
        const signature = req.get('x-razorpay-signature');
        if (!verifyRazorpayWebhookSignature(req.body, signature, config.RAZORPAY_WEBHOOK_SECRET)) {
          return res.status(400).json({ error: 'Invalid webhook signature' });
        }
        const payload = JSON.parse(req.body.toString('utf8'));
        const eventId = req.get('x-razorpay-event-id');
        if (!eventId || typeof payload.event !== 'string') {
          return res.status(400).json({ error: 'Invalid webhook payload' });
        }
        const result = await processRazorpayWebhook(models, payload);
        await models.PaymentWebhookEvent.create({
          eventId,
          event: payload.event,
          payload,
          status: result.status === 'ignored' ? 'ignored' : 'processed'
        });
        return res.status(200).json({ received: true, status: result.status });
      } catch (error) {
        if (error?.code === 11000) return res.status(200).json({ received: true, duplicate: true });
        return next(error);
      }
    });
  app.use(express.json({ limit: '10kb' }));
  app.use(requestMetrics.middleware);

  app.get('/api/health', (req, res) => {
    const databaseConnected = models.connection.readyState === 1;
    res.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? 'ok' : 'unavailable',
      database: databaseConnected ? 'connected' : 'disconnected'
    });
  });
  app.get('/api/health/metrics', (req, res) => res.json(requestMetrics.snapshot()));

  app.use('/api/auth', createAuthRouter({
    ...models,
    config,
    deliverOtp,
    logOtp
  }));
  app.use('/api/admin', createAdminRouter(models, config, { deliverInvitation }));
  app.use('/api/fees', createFeeRouter(models, config));
  app.use('/api/refunds', createRefundRouter(models, config));
  app.use('/api/payments', createPaymentRouter(models, config));
  app.use('/api/parent-payments', createParentPaymentRouter(models, config));
  app.use('/api/reminders', createReminderRouter(models, config, {
    provider: messageProvider,
    auditLog
  }));
  app.use('/api/assistant', createAssistantRouter(models, config));
  app.use('/api/risks', createRiskRouter(models, config, { fetchImpl: riskFetchImpl }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
