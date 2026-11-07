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
  REFUND_POLICY_VERSION: 'demo-policy-test-v1'
};

function authorization(token) {
  return ['Be', 'arer '].join('') + token;
}

function createHarness() {
  const users = [
    { _id: 'accounts-id', id: 'accounts-id', role: 'accounts', isActive: true },
    { _id: 'parent-id', id: 'parent-id', role: 'parent', studentId: 'STU-1', isActive: true }
  ];
  const student = { studentId: 'STU-1', name: 'Student One', isActive: true };
  const plan = {
    studentId: 'STU-1',
    totalFeePaise: 10_000_000,
    netFeePaise: 9_000_000,
    installments: [3_000_000, 3_000_000, 3_000_000].map((amountPaise) => ({ paidAmountPaise: amountPaise / 3 }))
  };
  const refunds = [];
  let nextId = 1;
  const User = {
    findById: async (id) => users.find((user) => user._id === id) ?? null
  };
  const Student = {
    findOne: (filter) => ({ lean: async () => filter.studentId === student.studentId ? student : null })
  };
  const FeePlan = {
    findOne: (filter) => ({ lean: async () => filter.studentId === plan.studentId ? plan : null })
  };
  class Refund {
    constructor(data) {
      Object.assign(this, data, { _id: String(nextId++).padStart(24, '0'), createdAt: new Date() });
    }
    async save() { refunds.push(this); }
    static find() {
      return {
        sort() { return this; },
        limit() { return this; },
        lean: async () => refunds
      };
    }
    static async exists(filter) {
      return refunds.some(({ _id }) => _id === filter._id);
    }
    static async findOneAndUpdate(filter, update) {
      const refund = refunds.find(({ _id, status }) => _id === filter._id && status === filter.status);
      if (!refund) return null;
      Object.assign(refund, update.$set);
      return refund;
    }
  }
  const app = createApp({
    config,
    models: { User, Student, FeePlan, Refund, Payment: {}, Reminder: {}, OtpChallenge: {}, connection: { readyState: 1 } },
    deliverOtp: async () => {},
    logOtp: () => {}
  });
  const tokenFor = (id) => signAccessToken(users.find(({ _id }) => _id === id), config.JWT_SECRET, '2h');
  return { app, tokenFor, refunds };
}

test('accounts can create a ledger-backed refund report and approve it without disbursing', async () => {
  const { app, tokenFor, refunds } = createHarness();
  const accountToken = tokenFor('accounts-id');
  const created = await request(app)
    .post('/api/refunds/calculate')
    .set('Authorization', authorization(accountToken))
    .send({
      studentId: 'STU-1',
      courseStartDate: '2026-01-01',
      withdrawalDate: '2026-02-20',
      totalCourseDurationDays: 100,
      nonRefundableChargesPaise: 500_000
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.refund.studentId, 'STU-1');
  assert.equal(created.body.refund.policyInputs.netCourseFeePaise, 9_000_000);
  assert.equal(created.body.refund.policyInputs.amountPaidPaise, 3_000_000);
  assert.equal(created.body.refund.policyInputs.policyVersion, 'demo-policy-test-v1');
  assert.equal(created.body.refund.calculationDetails.daysCompleted, 50);
  assert.equal(created.body.refund.calculationDetails.feeEarnedPaise, 4_500_000);
  assert.equal(created.body.refund.refundAmountPaise, 0);
  assert.equal(created.body.refund.status, 'pending_review');

  const approval = await request(app)
    .post(`/api/refunds/${created.body.refund._id}/approve`)
    .set('Authorization', authorization(accountToken))
    .send({ reviewNote: 'Reviewed for demonstration' });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.refund.status, 'approved');
  assert.equal(approval.body.refund.approvedBy, 'accounts-id');
  assert.equal(approval.body.refund.reviewedBy, 'accounts-id');
  assert.equal(approval.body.disbursement, 'not_issued');
  assert.equal(refunds.length, 1);

  const duplicateApproval = await request(app)
    .post(`/api/refunds/${created.body.refund._id}/approve`)
    .set('Authorization', authorization(accountToken))
    .send({});
  assert.equal(duplicateApproval.status, 409);
});

test('parents cannot calculate, list, or approve refund records', async () => {
  const { app, tokenFor } = createHarness();
  const parentToken = tokenFor('parent-id');
  assert.equal((await request(app).get('/api/refunds').set('Authorization', authorization(parentToken))).status, 403);
  assert.equal((await request(app).post('/api/refunds/calculate')
    .set('Authorization', authorization(parentToken)).send({})).status, 403);
  assert.equal((await request(app).post(`/api/refunds/${'a'.repeat(24)}/approve`)
    .set('Authorization', authorization(parentToken)).send({})).status, 403);
});

test('refund calculation rejects invalid dates and does not trust client fee or paid amounts', async () => {
  const { app, tokenFor } = createHarness();
  const accountAuthorization = authorization(tokenFor('accounts-id'));
  const invalidDate = await request(app)
    .post('/api/refunds/calculate')
    .set('Authorization', accountAuthorization)
    .send({
      studentId: 'STU-1',
      courseStartDate: '2026-02-30',
      withdrawalDate: '2026-02-20',
      totalCourseDurationDays: 100,
      nonRefundableChargesPaise: 0
    });
  assert.equal(invalidDate.status, 400);
  const forgedMoney = await request(app)
    .post('/api/refunds/calculate')
    .set('Authorization', accountAuthorization)
    .send({
      studentId: 'STU-1',
      courseStartDate: '2026-01-01',
      withdrawalDate: '2026-02-20',
      totalCourseDurationDays: 100,
      nonRefundableChargesPaise: 0,
      amountPaidPaise: 9_000_000
    });
  assert.equal(forgedMoney.status, 400);
  const documentedOverride = await request(app)
    .post('/api/refunds/calculate')
    .set('Authorization', accountAuthorization)
    .send({
      studentId: 'STU-1',
      courseStartDate: '2026-01-01',
      withdrawalDate: '2026-02-20',
      totalCourseDurationDays: 100,
      netCourseFeePaise: 8_000_000,
      amountPaidPaise: 5_000_000,
      nonRefundableChargesPaise: 0,
      overrideReason: 'Approved contract adjustment'
    });
  assert.equal(documentedOverride.status, 201);
  assert.equal(documentedOverride.body.refund.policyInputs.financialInputsSource, 'accounts_override');
  assert.equal(documentedOverride.body.refund.policyInputs.overrideReason, 'Approved contract adjustment');
});
