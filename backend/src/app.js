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

export function createApp({ config, models, deliverOtp, logOtp, messageProvider, auditLog, riskFetchImpl }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: config.FRONTEND_URL,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (req, res) => {
    const databaseConnected = models.connection.readyState === 1;
    res.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? 'ok' : 'unavailable',
      database: databaseConnected ? 'connected' : 'disconnected'
    });
  });

  app.use('/api/auth', createAuthRouter({
    ...models,
    config,
    deliverOtp,
    logOtp
  }));
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
