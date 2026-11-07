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
  OTP_EXPIRES_MINUTES: 5
};

function createFeeApp({
  studentRecords,
  refundGroups = [
    { _id: 'pending_review', count: 1 },
    { _id: 'approved', count: 1 },
    { _id: 'rejected', count: 1 }
  ],
  reminderGroups = [
    { _id: 'scheduled', count: 2 },
    { _id: 'sending', count: 1 },
    { _id: 'sent', count: 3 },
    { _id: 'failed', count: 4 },
    { _id: 'cancelled', count: 5 }
  ],
  riskGroups = [{ _id: 'STU-1', riskLevel: 'LOW' }, { _id: 'STU-2', riskLevel: 'high' }],
  taskGroups = [{ _id: 'STU-1', riskLevel: 'HIGH' }, { _id: 'STU-2', riskLevel: 'MEDIUM' }]
} = {}) {
  const users = [
    { _id: 'accounts-id', id: 'accounts-id', role: 'accounts', isActive: true },
    { _id: 'parent-id', id: 'parent-id', role: 'parent', studentId: 'STU-1', isActive: true }
  ];
  const students = studentRecords ?? [
    { studentId: 'STU-1', name: 'Student One', centre: 'Jaipur', batch: 'JEE 2027', isActive: true },
    { studentId: 'STU-2', name: 'Student Two', centre: 'Ajmer', batch: 'NEET 2027', isActive: true }
  ];
  const plans = [{
    _id: 'plan-id',
    studentId: 'STU-1',
    totalFeePaise: 10000,
    discountPaise: 1000,
    netFeePaise: 9000,
    numberOfInstallments: 3,
    installments: [1, 2, 3].map((installmentNumber) => ({
      _id: `inst-${installmentNumber}`,
      installmentNumber,
      dueDate: new Date(`2027-0${installmentNumber}-01T00:00:00.000Z`),
      amountPaise: 3000,
      paidAmountPaise: installmentNumber === 1 ? 3000 : 0,
      status: installmentNumber === 1 ? 'paid' : 'upcoming'
    }))
  }];
  const User = { findById: async (id) => users.find((user) => user._id === id) ?? null };
  const Student = {
    find: (filter) => ({
      sort() { return this; },
      lean: async () => students.filter((student) =>
        (filter.isActive !== true || student.isActive === true) &&
        (!filter.studentId || student.studentId === filter.studentId))
    }),
    findOne: (filter) => ({ lean: async () => students.find((student) => student.studentId === filter.studentId) ?? null })
  };
  const FeePlan = {
    find: () => ({ lean: async () => plans }),
    exists: async () => false
  };
  const Payment = {
    find: () => ({ sort() { return this; }, lean: async () => [] })
  };
  const aggregateCalls = [];
  const Refund = { aggregate: async (pipeline) => { aggregateCalls.push(['refund', pipeline]); return refundGroups; } };
  const Reminder = { aggregate: async (pipeline) => { aggregateCalls.push(['reminder', pipeline]); return reminderGroups; } };
  const CounsellorTask = { aggregate: async (pipeline) => { aggregateCalls.push(['task', pipeline]); return taskGroups; } };
  const RiskAssessment = { aggregate: async (pipeline) => { aggregateCalls.push(['risk', pipeline]); return riskGroups; } };
  const app = createApp({
    config,
    models: { User, Student, FeePlan, Payment, Refund, Reminder, CounsellorTask, RiskAssessment, OtpChallenge: {}, connection: { readyState: 1 } },
    deliverOtp: async () => {},
    logOtp: () => {}
  });
  return {
    app,
    aggregateCalls,
    tokenFor: (userId) => signAccessToken(users.find((user) => user._id === userId), config.JWT_SECRET, '2h')
  };
}

test('fee ledger endpoints return student balances and dashboard statistics', async () => {
  const { app, tokenFor, aggregateCalls } = createFeeApp();
  const authorization = `Bearer ${tokenFor('accounts-id')}`;
  const list = await request(app).get('/api/fees/students').set('Authorization', authorization);
  assert.equal(list.status, 200);
  assert.equal(list.body.students.length, 2);
  assert.equal(list.body.students[0].remainingBalancePaise, 6000);
  assert.equal(list.body.students[1].feePlan, null);

  const detail = await request(app).get('/api/fees/student/STU-1').set('Authorization', authorization);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.student.feePlan.installments[0].status, 'paid');

  const summary = await request(app).get('/api/fees/summary').set('Authorization', authorization);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.summary.totalFeesBilledPaise, 10000);
  assert.equal(summary.body.summary.totalOutstandingPaise, 6000);
  assert.equal(summary.body.summary.collectionPercentage, 33.33);
  assert.deepEqual(summary.body.summary.centreWiseOutstanding, [{ name: 'Jaipur', outstandingPaise: 6000 }]);

  const dashboard = await request(app).get('/api/fees/dashboard').set('Authorization', authorization);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.dashboard.summary.totalFeesBilledPaise, 10000);
  assert.equal(dashboard.body.dashboard.centreWiseCollection[0].collectedPaise, 3000);
  assert.equal(dashboard.body.dashboard.rows.length, 3);
  assert.equal(dashboard.body.dashboard.overdueAgeing.length, 5);
  assert.deepEqual(dashboard.body.dashboard.metrics, {
    students: { totalActive: 2, assessedForRisk: 2 },
    refunds: { total: 3, pending: 1, approved: 1, rejected: 1 },
    reminders: { total: 15, scheduled: 2, pending: 3, sent: 3, failed: 4, cancelled: 5 },
    riskDistribution: { low: 1, medium: 0, high: 1 }
  });
  const riskPipeline = aggregateCalls.find(([model]) => model === 'risk')[1];
  assert.deepEqual(riskPipeline[2], {
    $group: { _id: '$studentId', riskLevel: { $first: '$riskLevel' } }
  });
  assert.deepEqual(riskPipeline[1], { $sort: { assessedAt: -1, _id: -1 } });
  assert.deepEqual(riskPipeline[0].$match.studentId.$in, ['STU-1', 'STU-2']);
  assert.deepEqual(aggregateCalls.find(([model]) => model === 'task')[1][2], {
    $group: { _id: '$studentId', riskLevel: { $first: '$riskLevel' } }
  });
  const csv = await request(app).get('/api/fees/export.csv').set('Authorization', authorization);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /"Student ID","Student name"/);
});

test('dashboard metrics return zero for an empty database and missing optional records', async () => {
  const empty = createFeeApp({ studentRecords: [] });
  const emptyDashboard = await request(empty.app)
    .get('/api/fees/dashboard')
    .set('Authorization', `Bearer ${empty.tokenFor('accounts-id')}`);
  assert.equal(emptyDashboard.status, 200);
  assert.deepEqual(emptyDashboard.body.dashboard.metrics, {
    students: { totalActive: 0, assessedForRisk: 0 },
    refunds: { total: 0, pending: 0, approved: 0, rejected: 0 },
    reminders: { total: 0, scheduled: 0, pending: 0, sent: 0, failed: 0, cancelled: 0 },
    riskDistribution: { low: 0, medium: 0, high: 0 }
  });
  assert.equal(empty.aggregateCalls.length, 0);

  const noOptionalRecords = createFeeApp({
    refundGroups: [],
    reminderGroups: [],
    riskGroups: [],
    taskGroups: []
  });
  const dashboard = await request(noOptionalRecords.app)
    .get('/api/fees/dashboard')
    .set('Authorization', `Bearer ${noOptionalRecords.tokenFor('accounts-id')}`);
  assert.equal(dashboard.status, 200);
  assert.deepEqual(dashboard.body.dashboard.metrics.refunds, { total: 0, pending: 0, approved: 0, rejected: 0 });
  assert.deepEqual(dashboard.body.dashboard.metrics.reminders, {
    total: 0, scheduled: 0, pending: 0, sent: 0, failed: 0, cancelled: 0
  });
  assert.deepEqual(dashboard.body.dashboard.metrics.riskDistribution, { low: 0, medium: 0, high: 0 });
});

test('dashboard excludes inactive and invalid students and deduplicates student identifiers', async () => {
  const app = createFeeApp({
    studentRecords: [
      { studentId: 'STU-A', name: 'Active student', isActive: true },
      { studentId: 'STU-A', name: 'Duplicate identity', isActive: true },
      { studentId: 'STU-DELETED', name: 'Inactive student', isActive: false },
      { studentId: '', name: 'Missing identity', isActive: true },
      { studentId: 'STU-NAMELESS', name: '', isActive: true }
    ],
    riskGroups: [],
    taskGroups: []
  });
  const response = await request(app.app)
    .get('/api/fees/dashboard')
    .set('Authorization', `Bearer ${app.tokenFor('accounts-id')}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.dashboard.metrics.students.totalActive, 1);
  assert.equal(response.body.dashboard.metrics.students.assessedForRisk, 0);
  const activeIds = app.aggregateCalls.find(([model]) => model === 'refund')[1][0].$match.studentId.$in;
  assert.deepEqual(activeIds, ['STU-A']);
});

test('parent ledger access is limited to the linked student and accounts summary', async () => {
  const { app, tokenFor } = createFeeApp();
  const authorization = `Bearer ${tokenFor('parent-id')}`;
  const list = await request(app).get('/api/fees/students').set('Authorization', authorization);
  assert.equal(list.status, 200);
  assert.equal(list.body.students.length, 1);
  assert.equal(list.body.students[0].student.studentId, 'STU-1');

  const forbidden = await request(app).get('/api/fees/student/STU-2').set('Authorization', authorization);
  assert.equal(forbidden.status, 403);
  const summary = await request(app).get('/api/fees/summary').set('Authorization', authorization);
  assert.equal(summary.status, 403);
  assert.equal((await request(app).get('/api/fees/dashboard').set('Authorization', authorization)).status, 403);
  assert.equal((await request(app).get('/api/fees/export.csv').set('Authorization', authorization)).status, 403);
});

test('fee assistant returns ledger-backed answers and restricts access to accounts staff', async () => {
  const { app, tokenFor } = createFeeApp();
  const accountsAuthorization = `Bearer ${tokenFor('accounts-id')}`;
  const parentAuthorization = `Bearer ${tokenFor('parent-id')}`;

  const outstanding = await request(app)
    .post('/api/assistant/ask')
    .set('Authorization', accountsAuthorization)
    .send({ question: 'What is the total outstanding balance?' });
  assert.equal(outstanding.status, 200);
  assert.equal(outstanding.body.type, 'outstanding');
  assert.equal(outstanding.body.results[0].amountPaise, 6000);

  const grouped = await request(app)
    .post('/api/assistant/ask')
    .set('Authorization', accountsAuthorization)
    .send({ question: 'How much has been collected by centre?' });
  assert.equal(grouped.status, 200);
  assert.equal(grouped.body.type, 'collected');
  assert.deepEqual(grouped.body.results.map(({ label, amountPaise }) => [label, amountPaise]), [['Jaipur', 3000]]);

  const collectionRate = await request(app)
    .post('/api/assistant/ask')
    .set('Authorization', accountsAuthorization)
    .send({ question: 'How much has been collected?' });
  assert.equal(collectionRate.status, 200);
  assert.equal(collectionRate.body.results[1].value, 33.33);

  const student = await request(app)
    .post('/api/assistant/ask')
    .set('Authorization', accountsAuthorization)
    .send({ question: 'What is Student One STU-1 balance?' });
  assert.equal(student.status, 200);
  assert.deepEqual(student.body.results.map(({ label, amountPaise }) => [label, amountPaise]), [
    ['Outstanding', 6000],
    ['Paid', 3000],
    ['Net fee', 9000],
    ['Overdue', 0]
  ]);

  const denied = await request(app)
    .post('/api/assistant/ask')
    .set('Authorization', parentAuthorization)
    .send({ question: 'What is the total outstanding balance?' });
  assert.equal(denied.status, 403);

  const unsupported = await request(app)
    .post('/api/assistant/ask')
    .set('Authorization', accountsAuthorization)
    .send({ question: 'What is the weather today?' });
  assert.equal(unsupported.status, 200);
  assert.equal(unsupported.body.type, 'unsupported');
  assert.deepEqual(unsupported.body.results, []);

  const invalid = await request(app)
    .post('/api/assistant/ask')
    .set('Authorization', accountsAuthorization)
    .send({ question: ' ' });
  assert.equal(invalid.status, 400);
});
