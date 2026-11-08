import assert from 'node:assert/strict';
import test from 'node:test';
import { processRazorpayRefund } from '../src/services/refunds.js';

const config = {
  RAZORPAY_KEY_ID: 'key_id',
  RAZORPAY_KEY_SECRET: 'key_secret'
};

function createHarness({ providerFails = false } = {}) {
  const refund = {
    _id: 'refund-id',
    status: 'approved',
    studentId: 'STU-1',
    refundAmountPaise: 5_000,
    providerRefundId: undefined,
    processingError: null
  };
  const payment = { providerPaymentId: 'pay_sandbox' };
  let providerCalls = 0;
  const Refund = {
    async exists() {
      return true;
    },
    findOne(filter) {
      return {
        async lean() {
          if (filter._id !== refund._id) return null;
          if (filter.status && filter.status !== refund.status) return null;
          return { ...refund };
        }
      };
    },
    findOneAndUpdate(filter, update) {
      if (filter.status !== refund.status ||
          filter.providerRefundId?.$exists && refund.providerRefundId !== undefined) {
        return { lean: async () => null };
      }
      Object.assign(refund, update.$set);
      return { lean: async () => ({ ...refund }) };
    },
    async updateOne(filter, update) {
      if (filter.status === refund.status && filter.providerRequestId === refund.providerRequestId) {
        Object.assign(refund, update.$set);
      }
    }
  };
  const Payment = {
    findOne() {
      return {
        sort() { return this; },
        async lean() { return payment; }
      };
    }
  };
  globalThis.fetch = async (url, options) => {
    providerCalls += 1;
    assert.match(url, /payments\/pay_sandbox\/refund$/);
    assert.equal(options.headers['X-Razorpay-Idempotency-Key'], refund.providerRequestId);
    if (providerFails) throw new Error('synthetic provider timeout');
    return {
      ok: true,
      async json() {
        return { id: 'rfnd_sandbox', amount: refund.refundAmountPaise };
      }
    };
  };
  return {
    models: { Refund, Payment },
    refund,
    get providerCalls() { return providerCalls; }
  };
}

test('concurrent refund processing submits one idempotent provider request', async () => {
  const harness = createHarness();
  const results = await Promise.allSettled([
    processRazorpayRefund(harness.models, 'refund-id', 'accounts-id', config),
    processRazorpayRefund(harness.models, 'refund-id', 'accounts-id', config)
  ]);

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status, reason }) => status === 'rejected' && reason.status === 409).length, 1);
  assert.equal(harness.providerCalls, 1);
  assert.equal(harness.refund.status, 'processed');
  assert.equal(harness.refund.providerRefundId, 'rfnd_sandbox');
});

test('failed provider refund remains processing and cannot be retried with a new key', async () => {
  const harness = createHarness({ providerFails: true });

  await assert.rejects(
    processRazorpayRefund(harness.models, 'refund-id', 'accounts-id', config),
    /synthetic provider timeout/
  );
  assert.equal(harness.providerCalls, 1);
  assert.equal(harness.refund.status, 'processing');
  assert.equal(harness.refund.processingError, 'synthetic provider timeout');

  await assert.rejects(
    processRazorpayRefund(harness.models, 'refund-id', 'accounts-id', config),
    (error) => error.status === 409
  );
  assert.equal(harness.providerCalls, 1);
});
