import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../lib/errors.js';

function signature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(left ?? '');
  const b = Buffer.from(right ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyRazorpayPaymentSignature({ orderId, paymentId, signature: received }, secret) {
  return Boolean(secret && safeEqual(signature(`${orderId}|${paymentId}`, secret), received));
}

export function verifyRazorpayWebhookSignature(rawBody, received, secret) {
  return Boolean(secret && safeEqual(signature(rawBody, secret), received));
}

export async function createRazorpayOrder({ amountPaise, receipt, config, fetchImpl = globalThis.fetch }) {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    throw new AppError(503, 'Razorpay sandbox credentials are not configured');
  }
  const response = await fetchImpl('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 })
  });
  if (!response.ok) throw new AppError(503, 'Payment gateway could not create an order');
  const order = await response.json();
  if (order.amount !== amountPaise || order.currency !== 'INR' || typeof order.id !== 'string') {
    throw new AppError(502, 'Payment gateway returned an invalid order');
  }
  return order;
}

export async function createRazorpayRefund({
  paymentId,
  amountPaise,
  config,
  idempotencyKey,
  fetchImpl = globalThis.fetch
}) {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    throw new AppError(503, 'Razorpay sandbox credentials are not configured');
  }
  const response = await fetchImpl(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Razorpay-Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify({ amount: amountPaise, speed: 'normal' })
  });
  if (!response.ok) throw new AppError(503, 'Payment gateway could not create a refund');
  const refund = await response.json();
  if (typeof refund.id !== 'string' || refund.amount !== amountPaise) {
    throw new AppError(502, 'Payment gateway returned an invalid refund');
  }
  return refund;
}
