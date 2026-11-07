import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/auth.js';

const config = {
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
  JWT_EXPIRES_IN: '2h',
  OTP_HMAC_SECRET: 'test-otp-secret-that-is-long-enough-123456',
  OTP_EXPIRES_MINUTES: 5,
  MOCK_PAYMENTS_ENABLED: true,
  RECEIPT_GST_NOTE: 'GST not configured; no tax calculated or collected.'
};

function createHarness() {
  const nextId = (() => {
    let value = 1;
    return () => (value++).toString(16).padStart(24, '0');
  })();
  const users = [
    { _id: 'accounts-id', id: 'accounts-id', role: 'accounts', isActive: true },
    { _id: 'parent-id', id: 'parent-id', role: 'parent', studentId: 'STU-1', isActive: true }
  ];
  const students = [
    { studentId: 'STU-1', name: 'Student One', centre: 'Jaipur', batch: 'JEE 2027', isActive: true },
    { studentId: 'STU-2', name: 'Student Two', centre: 'Ajmer', batch: 'NEET 2027', isActive: true }
  ];
  const plans = [];
  const payments = [];
  const query = (resolve) => ({
    lean: async () => resolve(),
    session: async () => resolve(),
    sort() { return this; }
  });
  const User = {
    findById: async (id) => users.find((user) => user._id === id) ?? null
  };
  const Student = {
    find: (filter) => ({
      sort() { return this; },
      lean: async () => students.filter((student) =>
        student.isActive && (!filter.studentId || student.studentId === filter.studentId)
      )
    }),
    findOne: (filter) => query(() =>
      students.find((student) => student.studentId === filter.studentId && student.isActive) ?? null
    )
  };
  class FeePlan {
    constructor(data) {
      Object.assign(this, data, { _id: nextId() });
      this.installments = data.installments.map((installment) => ({
        ...installment,
        _id: nextId()
      }));
    }

    async save() {
      if (!plans.some((plan) => plan.studentId === this.studentId)) plans.push(this);
    }

    static find(filter) {
      return query(() => plans.filter((plan) => filter.studentId.$in.includes(plan.studentId)));
    }

    static findOne(filter) {
      return query(() => plans.find((plan) => plan.studentId === filter.studentId) ?? null);
    }

    static async exists(filter) {
      return plans.some((plan) => plan.studentId === filter.studentId);
    }
  }
  class Payment {
    constructor(data) {
      Object.assign(this, data, { _id: nextId() });
    }

    async save() {
      payments.push(this);
    }

    static findOne(filter) {
      return query(() => payments.find((payment) => payment.transactionId === filter.transactionId) ?? null);
    }

    static find(filter) {
      return query(() => payments
        .filter((payment) => payment.status === filter.status &&
          filter.installmentId.$in.some((id) => id.toString() === payment.installmentId.toString()))
        .sort((left, right) => right.paidAt - left.paidAt));
    }

    static findById(id) {
      return query(() => payments.find((payment) => payment._id === id) ?? null);
    }
  }
  const connection = {
    readyState: 1,
    startSession: async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {}
    })
  };
  const app = createApp({
    config,
    models: { User, Student, FeePlan, Payment, OtpChallenge: {}, connection },
    deliverOtp: async () => {},
    logOtp: () => {}
  });
  const tokenFor = (id) => signAccessToken(users.find((user) => user._id === id), config.JWT_SECRET, '2h');
  return { app, tokenFor, plans, payments };
}

const dates3 = ['2099-01-01', '2099-02-01', '2099-03-01'];
const dates4 = [...dates3, '2099-04-01'];

test('accounts can create supported plans, record partial and full payments, and retrieve receipts', async () => {
  const { app, tokenFor, plans, payments } = createHarness();
  const authorization = `Bearer ${tokenFor('accounts-id')}`;
  const created = await request(app)
    .post('/api/fees/create-plan')
    .set('Authorization', authorization)
    .send({ studentId: 'STU-1', totalFeePaise: 10001, discountPaise: 1001, dueDates: dates3 });
  assert.equal(created.status, 201);
  assert.equal(created.body.feePlan.netFeePaise, 9000);
  assert.equal(created.body.feePlan.numberOfInstallments, 3);

  const fourPartPlan = await request(app)
    .post('/api/fees/create-plan')
    .set('Authorization', authorization)
    .send({ studentId: 'STU-2', totalFeePaise: 12000, dueDates: dates4 });
  assert.equal(fourPartPlan.status, 201);
  assert.equal(fourPartPlan.body.feePlan.numberOfInstallments, 4);
  assert.deepEqual(fourPartPlan.body.feePlan.installments.map(({ amountPaise }) => amountPaise), [3000, 3000, 3000, 3000]);

  const partial = await request(app)
    .post('/api/payments/record')
    .set('Authorization', authorization)
    .send({
      studentId: 'STU-1',
      installmentNumber: 1,
      amountPaise: 1250,
      transactionId: 'API-TX-1',
      paymentMethod: 'upi'
    });
  assert.equal(partial.status, 201);

  const detail = await request(app)
    .get('/api/fees/student/STU-1')
    .set('Authorization', authorization);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.student.feePlan.installments[0].status, 'partially_paid');
  assert.equal(detail.body.student.feePlan.installments[0].outstandingPaise, 1750);
  assert.equal(detail.body.student.amountPaidPaise, 1250);
  assert.equal(detail.body.student.remainingBalancePaise, 7750);
  assert.equal(detail.body.student.paymentHistory.length, 1);

  const completed = await request(app)
    .post('/api/payments/record')
    .set('Authorization', authorization)
    .send({
      studentId: 'STU-1',
      installmentNumber: 1,
      amountPaise: 1750,
      transactionId: 'API-TX-2',
      paymentMethod: 'cash'
    });
  assert.equal(completed.status, 201);
  assert.equal(payments.length, 2);

  const duplicate = await request(app)
    .post('/api/payments/record')
    .set('Authorization', authorization)
    .send({
      studentId: 'STU-1',
      installmentNumber: 1,
      amountPaise: 1750,
      transactionId: 'API-TX-2',
      paymentMethod: 'cash'
    });
  assert.equal(duplicate.status, 409);

  const overpayment = await request(app)
    .post('/api/payments/record')
    .set('Authorization', authorization)
    .send({
      studentId: 'STU-1',
      installmentNumber: 1,
      amountPaise: 1,
      transactionId: 'API-TX-3',
      paymentMethod: 'cash'
    });
  assert.equal(overpayment.status, 400);
  assert.equal(payments.length, 2);

  const receipt = await request(app)
    .get(`/api/parent-payments/receipts/${completed.body.payment._id}`)
    .set('Authorization', authorization);
  assert.equal(receipt.status, 200);
  assert.match(receipt.headers['content-type'], /text\/html/);
  assert.match(receipt.text, /API-TX-2/);
  assert.equal(plans[0].installments[0].paidAmountPaise, 3000);
});

test('student-specific payment operations enforce authentication and accounts role', async () => {
  const { app, tokenFor } = createHarness();
  const unauthenticated = await request(app).get('/api/fees/student/STU-1');
  assert.equal(unauthenticated.status, 401);

  const parentAuthorization = `Bearer ${tokenFor('parent-id')}`;
  const createPlan = await request(app)
    .post('/api/fees/create-plan')
    .set('Authorization', parentAuthorization)
    .send({ studentId: 'STU-1', totalFeePaise: 9000, dueDates: dates3 });
  assert.equal(createPlan.status, 403);

  const recordPayment = await request(app)
    .post('/api/payments/record')
    .set('Authorization', parentAuthorization)
    .send({
      studentId: 'STU-1',
      installmentNumber: 1,
      amountPaise: 1,
      transactionId: 'PARENT-TX',
      paymentMethod: 'upi'
    });
  assert.equal(recordPayment.status, 403);

  const forbidden = await request(app)
    .get('/api/fees/student/STU-2')
    .set('Authorization', parentAuthorization);
  assert.equal(forbidden.status, 403);
});

test('fee plan API rejects invalid dates, installment counts, and duplicate plans', async () => {
  const { app, tokenFor } = createHarness();
  const authorization = `Bearer ${tokenFor('accounts-id')}`;
  const invalidDate = await request(app)
    .post('/api/fees/create-plan')
    .set('Authorization', authorization)
    .send({ studentId: 'STU-1', totalFeePaise: 9000, dueDates: ['2027-01-01', '2027-02-29', '2027-03-01'] });
  assert.equal(invalidDate.status, 400);

  const unsupportedCount = await request(app)
    .post('/api/fees/create-plan')
    .set('Authorization', authorization)
    .send({ studentId: 'STU-1', totalFeePaise: 9000, dueDates: ['2099-01-01', '2099-02-01'] });
  assert.equal(unsupportedCount.status, 400);

  const validPlan = await request(app)
    .post('/api/fees/create-plan')
    .set('Authorization', authorization)
    .send({ studentId: 'STU-1', totalFeePaise: 9000, dueDates: dates3 });
  assert.equal(validPlan.status, 201);

  const duplicatePlan = await request(app)
    .post('/api/fees/create-plan')
    .set('Authorization', authorization)
    .send({ studentId: 'STU-1', totalFeePaise: 9000, dueDates: dates3 });
  assert.equal(duplicatePlan.status, 409);
});
