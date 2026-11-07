import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

function gatewayKey(secret) {
  return createHmac('sha256', secret).update('feeflow.mock-gateway.callback.v1').digest();
}

function callbackPayload(callback) {
  return JSON.stringify([
    callback.callbackId,
    callback.orderId,
    callback.studentId,
    callback.parentUserId,
    callback.installmentId,
    callback.amountPaise,
    callback.transactionId,
    callback.status,
    callback.occurredAt
  ]);
}

export function createMockGatewayCallback(order, outcome, secret, now = new Date()) {
  const callback = {
    callbackId: randomUUID(),
    orderId: String(order._id),
    studentId: order.studentId,
    parentUserId: order.parentUserId,
    installmentId: String(order.installmentId),
    amountPaise: order.amountPaise,
    transactionId: order.transactionId,
    status: outcome === 'success' ? 'succeeded' : 'failed',
    occurredAt: now.toISOString()
  };
  callback.signature = createHmac('sha256', gatewayKey(secret))
    .update(callbackPayload(callback))
    .digest('hex');
  return callback;
}

export function verifyMockGatewayCallback(callback, secret) {
  if (!callback || !/^[a-f\d-]{36}$/i.test(callback.callbackId ?? '') ||
      !/^[a-f\d]{24}$/i.test(callback.orderId ?? '') ||
      !/^[a-f\d]{24}$/i.test(callback.installmentId ?? '') ||
      !Number.isSafeInteger(callback.amountPaise) || callback.amountPaise < 1 ||
      !['succeeded', 'failed'].includes(callback.status) ||
      !Number.isFinite(Date.parse(callback.occurredAt)) ||
      !/^[a-f\d]{64}$/i.test(callback.signature ?? '')) {
    return false;
  }
  const expected = createHmac('sha256', gatewayKey(secret))
    .update(callbackPayload(callback))
    .digest();
  const received = Buffer.from(callback.signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
