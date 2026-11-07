import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/auth.js';
import { completeParentMockPayment } from '../src/services/parent-payments.js';
import { createMockGatewayCallback } from '../src/services/mock-payment-gateway.js';

const config = {
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
  JWT_EXPIRES_IN: '2h',
  OTP_HMAC_SECRET: 'test-otp-secret-that-is-long-enough-123456',
  OTP_EXPIRES_MINUTES: 5,
  MOCK_PAYMENTS_ENABLED: true,
  RECEIPT_GST_NOTE: 'GST not configured; no tax calculated or collected. Project assumption only.'
};
const parentId = '64b000000000000000000001';
const otherParentId = '64b000000000000000000002';

function createHarness(runtimeConfig = config) {
  const parent = { _id: parentId, id: parentId, role: 'parent', studentId: 'STU-1', isActive: true };
  const otherParent = { _id: otherParentId, id: otherParentId, role: 'parent', studentId: 'STU-2', isActive: true };
  const student = {
    studentId: 'STU-1',
    name: 'Parent Student',
    batch: 'JEE 2027',
    centre: 'Jaipur',
    parentEmail: 'parent@feeflow.demo',
    parentPhone: '+919000000001',
    isActive: true
  };
  const installment = {
    _id: '64b000000000000000000010',
    installmentNumber: 1,
    dueDate: new Date('2027-01-10T00:00:00.000Z'),
    amountPaise: 10000,
    paidAmountPaise: 2500,
    status: 'partially_paid',
    payments: []
  };
  const plan = {
    _id: '64b000000000000000000020',
    studentId: 'STU-1',
    totalFeePaise: 10000,
    discountPaise: 0,
    netFeePaise: 10000,
    numberOfInstallments: 1,
    installments: [installment],
    save: async () => {}
  };
  const payments = [];
  const orders = [];
  const query = (resolve) => ({
    lean: async () => resolve(),
    session: async () => resolve(),
    sort() { return this; }
  });
  const User = {
    findById: async (id) => [parent, otherParent].find((user) => user.id === id) ?? null
  };
  const Student = {
    find: (filter) => query(() => filter.studentId
      ? [student].filter((entry) => entry.studentId === filter.studentId)
      : [student]),
    findOne: (filter) => query(() => filter.studentId === student.studentId ? student : null)
  };
  const FeePlan = {
    find: () => query(() => [plan]),
    findOne: (filter) => query(() => filter.studentId === plan.studentId ? plan : null)
  };
  class Payment {
    constructor(data) {
      Object.assign(this, data, { _id: `64b0000000000000000000${String(payments.length + 30).padStart(2, '0')}` });
    }
    async save() { payments.push(this); }
    static find(filter) {
      return query(() => payments.filter((payment) =>
        payment.status === filter.status && filter.installmentId.$in.some((id) =>
          id.toString() === payment.installmentId.toString()
        )));
    }
    static findById(id) { return query(() => payments.find((payment) => payment._id === id) ?? null); }
  }
  class MockPaymentOrder {
    constructor(data) {
      Object.assign(this, data, { _id: `64b0000000000000000000${String(orders.length + 1).padStart(2, '0')}` });
    }
    async save() {
      if (!orders.some((order) => order._id === this._id)) orders.push(this);
    }
    static findOne(filter) {
      return {
        lean: async () => orders.find((order) =>
          order._id === filter._id &&
          order.parentUserId === filter.parentUserId &&
          order.studentId === filter.studentId
        ) ?? null,
        session: async () => orders.find((order) =>
          order._id === filter._id &&
          order.parentUserId === filter.parentUserId &&
          order.studentId === filter.studentId
        ) ?? null
      };
    }
  }
  const connection = {
    readyState: 1,
    startSession: async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {}
    })
  };
  const models = { User, Student, FeePlan, Payment, MockPaymentOrder, OtpChallenge: {}, connection };
  const app = createApp({
    config: runtimeConfig,
    models,
    deliverOtp: async () => {},
    logOtp: () => {}
  });
  const tokenFor = (id) => signAccessToken({ id, role: 'parent' }, config.JWT_SECRET, '2h');
  return { app, tokenFor, installment, payments, orders, models, parent };
}

test('parent creates a server-priced order and successful mock payment updates balance once', async () => {
  const { app, tokenFor, installment, payments } = createHarness();
  const authorization = `Bearer ${tokenFor(parentId)}`;

  const forgedOrder = await request(app)
    .post('/api/parent-payments/orders')
    .set('Authorization', authorization)
    .send({ installmentNumber: 1, studentId: 'STU-2', amountPaise: 1, transactionId: 'FORGED' });
  assert.equal(forgedOrder.status, 400);

  const created = await request(app)
    .post('/api/parent-payments/orders')
    .set('Authorization', authorization)
    .send({ installmentNumber: 1 });
  assert.equal(created.status, 201);
  assert.equal(created.body.order.amountPaise, 7500);
  assert.match(created.body.order.transactionId, /^MOCK-/);
  const orderId = created.body.order.id;

  const settled = await request(app)
    .post(`/api/parent-payments/orders/${orderId}/complete`)
    .set('Authorization', authorization)
    .send({ outcome: 'success' });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.status, 'completed');
  assert.equal(settled.body.payment.amountPaise, 7500);
  assert.equal(installment.paidAmountPaise, 10000);
  assert.equal(payments.length, 1);

  const detail = await request(app)
    .get('/api/fees/student/STU-1')
    .set('Authorization', authorization);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.student.remainingBalancePaise, 0);

  const duplicate = await request(app)
    .post(`/api/parent-payments/orders/${orderId}/complete`)
    .set('Authorization', authorization)
    .send({ outcome: 'success' });
  assert.equal(duplicate.status, 409);
  assert.equal(payments.length, 1);
});

test('failed mock payment does not change the ledger and a parent cannot use another account order', async () => {
  const { app, tokenFor, installment, payments } = createHarness();
  const parentAuthorization = `Bearer ${tokenFor(parentId)}`;
  const otherAuthorization = `Bearer ${tokenFor(otherParentId)}`;
  const created = await request(app)
    .post('/api/parent-payments/orders')
    .set('Authorization', parentAuthorization)
    .send({ installmentNumber: 1 });
  const orderId = created.body.order.id;

  const unauthorized = await request(app)
    .post(`/api/parent-payments/orders/${orderId}/complete`)
    .set('Authorization', otherAuthorization)
    .send({ outcome: 'success' });
  assert.equal(unauthorized.status, 404);

  const failed = await request(app)
    .post(`/api/parent-payments/orders/${orderId}/complete`)
    .set('Authorization', parentAuthorization)
    .send({ outcome: 'failure' });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.status, 'failed');
  assert.equal(installment.paidAmountPaise, 2500);
  assert.equal(payments.length, 0);
});

test('settlement rejects unsigned or modified gateway confirmations', async () => {
  const { app, tokenFor, orders, models, parent, installment, payments } = createHarness();
  const authorization = `Bearer ${tokenFor(parentId)}`;
  const created = await request(app)
    .post('/api/parent-payments/orders')
    .set('Authorization', authorization)
    .send({ installmentNumber: 1 });
  assert.equal(created.status, 201);

  const forged = createMockGatewayCallback(orders[0], 'success', config.JWT_SECRET);
  forged.amountPaise += 1;
  await assert.rejects(
    completeParentMockPayment(models, parent, forged, config.JWT_SECRET),
    (error) => error.status === 400
  );
  const wronglySigned = createMockGatewayCallback(orders[0], 'success', 'unrelated-secret');
  await assert.rejects(
    completeParentMockPayment(models, parent, wronglySigned, config.JWT_SECRET),
    (error) => error.status === 400
  );
  assert.equal(installment.paidAmountPaise, 2500);
  assert.equal(payments.length, 0);
});

test('mock orders reject settlement after expiry and when the balance has changed', async () => {
  const expiredHarness = createHarness();
  const authorization = `Bearer ${expiredHarness.tokenFor(parentId)}`;
  const expiredOrder = await request(expiredHarness.app)
    .post('/api/parent-payments/orders')
    .set('Authorization', authorization)
    .send({ installmentNumber: 1 });
  expiredHarness.orders[0].expiresAt = new Date(Date.now() - 1);
  const expiredResult = await request(expiredHarness.app)
    .post(`/api/parent-payments/orders/${expiredOrder.body.order.id}/complete`)
    .set('Authorization', authorization)
    .send({ outcome: 'success' });
  assert.equal(expiredResult.status, 409);
  assert.equal(expiredHarness.payments.length, 0);

  const changedHarness = createHarness();
  const changedAuthorization = `Bearer ${changedHarness.tokenFor(parentId)}`;
  const changedOrder = await request(changedHarness.app)
    .post('/api/parent-payments/orders')
    .set('Authorization', changedAuthorization)
    .send({ installmentNumber: 1 });
  changedHarness.installment.paidAmountPaise = 3000;
  const changedResult = await request(changedHarness.app)
    .post(`/api/parent-payments/orders/${changedOrder.body.order.id}/complete`)
    .set('Authorization', changedAuthorization)
    .send({ outcome: 'success' });
  assert.equal(changedResult.status, 409);
  assert.equal(changedHarness.payments.length, 0);
});

test('parent cannot read another student fee URL and can download a GST-labelled receipt', async () => {
  const { app, tokenFor, payments } = createHarness();
  const authorization = `Bearer ${tokenFor(parentId)}`;
  const otherAuthorization = `Bearer ${tokenFor(otherParentId)}`;
  const forbidden = await request(app)
    .get('/api/fees/student/STU-2')
    .set('Authorization', authorization);
  assert.equal(forbidden.status, 403);

  const created = await request(app)
    .post('/api/parent-payments/orders')
    .set('Authorization', authorization)
    .send({ installmentNumber: 1 });
  const settled = await request(app)
    .post(`/api/parent-payments/orders/${created.body.order.id}/complete`)
    .set('Authorization', authorization)
    .send({ outcome: 'success' });

  const receipt = await request(app)
    .get(`/api/parent-payments/receipts/${settled.body.payment.id}`)
    .set('Authorization', authorization);
  assert.equal(receipt.status, 200);
  assert.match(receipt.headers['content-type'], /text\/html/);
  assert.match(receipt.headers['content-disposition'], /attachment/);
  assert.match(receipt.text, /Receipt number/);
  assert.match(receipt.text, /Transaction ID/);
  assert.match(receipt.text, /GST information \/ project assumption/);
  assert.match(receipt.text, /no tax calculated or collected/i);
  assert.equal(payments.length, 1);

  const otherReceipt = await request(app)
    .get(`/api/parent-payments/receipts/${settled.body.payment.id}`)
    .set('Authorization', otherAuthorization);
  assert.equal(otherReceipt.status, 404);
});

test('mock settlement is disabled in production', async () => {
  const { app, tokenFor, installment, payments } = createHarness({ ...config, NODE_ENV: 'production' });
  const authorization = `Bearer ${tokenFor(parentId)}`;
  const created = await request(app)
    .post('/api/parent-payments/orders')
    .set('Authorization', authorization)
    .send({ installmentNumber: 1 });
  assert.equal(created.status, 201);

  const completion = await request(app)
    .post(`/api/parent-payments/orders/${created.body.order.id}/complete`)
    .set('Authorization', authorization)
    .send({ outcome: 'success' });
  assert.equal(completion.status, 404);
  assert.equal(installment.paidAmountPaise, 2500);
  assert.equal(payments.length, 0);
});
