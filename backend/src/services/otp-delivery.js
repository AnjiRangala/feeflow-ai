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

function createTransport(config, unavailableMessage) {
  const configured = config.SMTP_HOST && config.SMTP_PORT && config.SMTP_FROM;
  if (!configured) {
    throw new AppError(503, unavailableMessage);
  }
  return nodemailer.createTransport(createSmtpTransportOptions(config));
}

export function createOtpDelivery(config) {
  if (config.NODE_ENV === 'development') return async () => {};
  let transport;
  try {
    transport = createTransport(config, 'OTP delivery is not configured');
  } catch (error) {
    return async () => { throw error; };
  }
  return async (email, code, expiresMinutes) => {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Your FeeFlow AI verification code',
      text: `Your verification code is ${code}. It expires in ${expiresMinutes} minutes.`
    });
  };
}

export function createInvitationDelivery(config) {
  let transport;
  try {
    transport = createTransport(config, 'Invitation delivery is not configured');
  } catch (error) {
    return async () => { throw error; };
  }
  return async (email, token, expiresMinutes, role) => {
    const activationUrl = `${config.FRONTEND_URL.replace(/\/+$/, '')}/activate?token=${encodeURIComponent(token)}`;
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Activate your FeeFlow AI account',
      text: `Your ${role} FeeFlow AI account is ready. Activate it here: ${activationUrl}. This invitation expires in ${expiresMinutes} minutes.`
    });
  };
}
