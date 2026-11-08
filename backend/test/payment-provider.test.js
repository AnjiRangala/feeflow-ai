import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createRazorpayOrder,
  createRazorpayRefund,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature
} from '../src/services/payment-provider.js';

function hmac(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

test('Razorpay payment signatures require the exact order and payment pair', () => {
  const secret = 'sandbox-secret';
  const orderId = 'order_test';
  const paymentId = 'pay_test';
  const signature = hmac(`${orderId}|${paymentId}`, secret);
  assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId, signature }, secret), true);
  assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId: 'pay_other', signature }, secret), false);
});

test('Razorpay webhook signatures reject tampering and wrong secrets', () => {
  const body = '{"event":"payment.captured"}';
  const signature = hmac(body, 'sandbox-secret');
  assert.equal(verifyRazorpayWebhookSignature(body, signature, 'sandbox-secret'), true);
  assert.equal(verifyRazorpayWebhookSignature(`${body} `, signature, 'sandbox-secret'), false);
  assert.equal(verifyRazorpayWebhookSignature(body, signature, 'wrong-secret'), false);
});

test('Razorpay order creation sends the server-calculated amount and validates response', async () => {
  let request;
  const order = await createRazorpayOrder({
    amountPaise: 12500,
    receipt: 'fee-student-1',
    config: { RAZORPAY_KEY_ID: 'key_id', RAZORPAY_KEY_SECRET: 'key_secret' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { id: 'order_sandbox', amount: 12500, currency: 'INR' };
        }
      };
    }
  });

  test('Razorpay refund request sends the sandbox payment and exact amount', async () => {
    let request;
    const refund = await createRazorpayRefund({
      paymentId: 'pay_sandbox',
      amountPaise: 5000,
      config: { RAZORPAY_KEY_ID: 'key_id', RAZORPAY_KEY_SECRET: 'key_secret' },
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, async json() { return { id: 'rfnd_sandbox', amount: 5000 }; } };
      }
    });
    assert.equal(refund.id, 'rfnd_sandbox');
    assert.match(request.url, /payments\/pay_sandbox\/refund$/);
    assert.deepEqual(JSON.parse(request.options.body), { amount: 5000, speed: 'normal' });
  });
  assert.equal(order.id, 'order_sandbox');
  assert.equal(request.url, 'https://api.razorpay.com/v1/orders');
  assert.deepEqual(JSON.parse(request.options.body), {
    amount: 12500,
    currency: 'INR',
    receipt: 'fee-student-1',
    payment_capture: 1
  });
});
