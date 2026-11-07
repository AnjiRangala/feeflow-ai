import nodemailer from 'nodemailer';
import { AppError } from '../lib/errors.js';

export function createSmtpTransportOptions(config) {
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    requireTLS: !config.SMTP_SECURE,
    auth: config.SMTP_USER ? {
      user: config.SMTP_USER,
      pass: config.SMTP_PASSWORD
    } : undefined
  };
}

export function createOtpDelivery(config) {
  if (config.NODE_ENV === 'development') {
    return async () => {};
  }

  const configured = config.SMTP_HOST && config.SMTP_PORT && config.SMTP_FROM;
  if (!configured) {
    return async () => {
      throw new AppError(503, 'OTP delivery is not configured');
    };
  }

  const transport = nodemailer.createTransport(createSmtpTransportOptions(config));

  return async (email, code, expiresMinutes) => {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Your FeeFlow AI verification code',
      text: `Your verification code is ${code}. It expires in ${expiresMinutes} minutes.`
    });
  };
}
