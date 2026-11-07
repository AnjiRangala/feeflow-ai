import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { config } from './config/env.js';
import * as models from './models/index.js';
import { createMockMessageProvider } from './services/mock-message-provider.js';
import { createOtpDelivery } from './services/otp-delivery.js';
import { startReminderScheduler } from './services/reminders.js';

try {
  await connectDatabase(config.MONGO_URI);
  await models.Reminder.init();
  await models.CounsellorTask.init();
  await models.RiskAssessment.init();
  const auditLog = (event) => console.info(JSON.stringify(event));
  const messageProvider = createMockMessageProvider(auditLog);
  const app = createApp({
    config,
    models: { ...models, connection: models.User.db },
    deliverOtp: createOtpDelivery(config),
    messageProvider,
    auditLog
  });
  const server = app.listen(config.PORT, () => {
    console.info(`FeeFlow AI API listening on http://localhost:${config.PORT}`);
  });
  const reminderScheduler = startReminderScheduler({
    models: { ...models, connection: models.User.db },
    config,
    provider: messageProvider,
    auditLog
  });

  const shutdown = async () => {
    server.close();
    await reminderScheduler.stop();
    await models.User.db.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Unable to start FeeFlow AI API:', error);
  process.exitCode = 1;
}
