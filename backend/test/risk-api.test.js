import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/auth.js';
import { CounsellorTask } from '../src/models/counsellor-task.js';
import { RiskAssessment } from '../src/models/risk-assessment.js';
import { User } from '../src/models/user.js';
import { getRiskFeatures } from '../src/services/student-risk.js';

const config = {
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
  AI_SERVICE_URL: 'http://127.0.0.1:8000',
  AI_SERVICE_TIMEOUT_MS: 1000
};
const taskId = '64b000000000000000000099';

test('Mongo models accept counsellor roles and validated risk feedback records', async () => {
  assert.ok(User.schema.path('role').enumValues.includes('counsellor'));
  const task = new CounsellorTask({
    studentId: 'STU-1',
    studentName: 'Student One',
    riskLevel: 'HIGH',
    riskScore: 82,
    reasons: ['Attendance below 70%'],
    scoreBreakdown: { attendancePercentage: 20 },
    features: { attendancePercentage: 65 },
    missingFeatures: [],
    recommendedAction: 'Create counsellor follow-up task',
    assessmentMethod: 'explainable_rules_baseline',
    modelVersion: 'rules-baseline-v1',
    status: 'in_progress',
    createdBy: '64b000000000000000000002',
    feedback: 'valid',
    feedbackBy: '64b000000000000000000003',
    reviewedAt: new Date()
  });
  await task.validate();
  assert.equal(task.riskScore, 82);
  assert.equal(task.feedback, 'valid');
  assert.ok(CounsellorTask.schema.indexes().some(([fields, options]) =>
    fields.openTaskStudentId === 1 && options.unique === true && options.sparse === true
  ));
  await assert.rejects(new CounsellorTask({
    studentId: 'STU-1',
    riskLevel: 'HIGH',
    riskScore: 101,
    status: 'open'
  }).validate());
  const assessment = new RiskAssessment({
    studentId: 'STU-1',
    riskLevel: 'LOW',
    riskScore: 0,
    reasons: [],
    scoreBreakdown: {},
    features: {},
    missingFeatures: [],
    recommendedAction: 'Continue routine monitoring',
    assessmentMethod: 'explainable_rules_baseline',
    modelVersion: 'rules-baseline-v1',
    assessedBy: '64b000000000000000000002'
  });
  await assessment.validate();
  assert.ok(RiskAssessment.schema.indexes().some(([fields]) =>
    fields.studentId === 1 && fields.assessedAt === -1
  ));
});

function createRiskHarness(fetchImpl = async () => ({
  ok: true,
  json: async () => ({
    studentId: 'STU-1',
    riskLevel: 'HIGH',
    riskScore: 82,
    reasons: ['Instalment overdue', 'Attendance below 70%', 'Test performance declining'],
    recommendedAction: 'Create counsellor follow-up task',
    scoreBreakdown: {
      missedInstallments: 15,
      overdueDays: 20,
      attendancePercentage: 20,
      testPerformanceTrend: 15,
      brokenPaymentPromises: 12
    },
    missingFeatures: [],
    assessmentMethod: 'explainable_rules_baseline',
    modelVersion: 'rules-baseline-v1'
  })
})) {
  const users = [
    { _id: 'accounts-id', id: 'accounts-id', role: 'accounts', isActive: true },
    { _id: 'parent-id', id: 'parent-id', role: 'parent', studentId: 'STU-1', isActive: true },
    { _id: 'counsellor-id', id: 'counsellor-id', role: 'counsellor', isActive: true }
  ];
  const students = [
    {
      studentId: 'STU-1',
      name: 'Student One',
      attendancePercentage: 65,
      testPerformance: [
        { score: 90, testDate: new Date('2027-01-01') },
        { score: 80, testDate: new Date('2027-02-01') }
      ],
      paymentPromises: [{ status: 'broken' }],
      isActive: true
    },
    {
      studentId: 'STU-2',
      name: 'Student Two',
      attendancePercentage: 92,
      testPerformance: [],
      isActive: true
    }
  ];
  const feePlans = [{
    studentId: 'STU-1',
    installments: [{
      dueDate: new Date('2027-01-01'),
      amountPaise: 10000,
      paidAmountPaise: 0
    }]
  }];
  const tasks = new Map();
  const closedTasks = new Map();
  const assessments = [];
  let taskWrites = 0;
  const User = { findById: async (id) => users.find((user) => user._id === id) ?? null };
  const Student = {
    findOne: (filter) => ({ lean: async () => students.find((student) =>
      student.studentId === filter.studentId && student.isActive) ?? null })
  };
  const FeePlan = {
    findOne: (filter) => ({ lean: async () => feePlans.find((plan) => plan.studentId === filter.studentId) ?? null })
  };
  const CounsellorTask = {
    find: () => ({
      sort() { return this; },
      limit() { return this; },
      lean: async () => [...tasks.values()]
    }),
    findOneAndUpdate: async (filter, update, options = {}) => {
      const taskKey = filter.openTaskStudentId ?? filter.studentId;
      const existing = filter._id
        ? [...tasks.values()].find((task) => task._id === filter._id)
        : tasks.get(taskKey);
      if (filter.feedback && existing?.feedback) return null;
      if (filter.feedback && !existing) return null;
      if (!existing && !options.upsert) return null;
      taskWrites += 1;
      const task = existing ?? { _id: taskId, status: 'open', createdAt: new Date() };
      Object.assign(task, update.$set);
      if (update.$setOnInsert) Object.assign(task, update.$setOnInsert);
      if (update.$unset) delete task.openTaskStudentId;
      if (task.openTaskStudentId) tasks.set(task.openTaskStudentId, task);
      else if (existing) {
        tasks.delete(existing.openTaskStudentId ?? taskKey);
        closedTasks.set(task._id, task);
      }
      return task;
    },
    exists: async ({ _id }) => [...tasks.values(), ...closedTasks.values()].some((task) => task._id === _id)
  };
  const RiskAssessment = {
    create: async (record) => {
      const saved = { _id: `assessment-${assessments.length + 1}`, ...record };
      assessments.push(saved);
      return saved;
    }
  };
  const Reminder = { updateOne: async () => { throw new Error('Risk assessment must not mutate reminders'); } };
  const app = createApp({
    config,
    models: {
      User,
      Student,
      FeePlan,
      CounsellorTask,
      RiskAssessment,
      Reminder,
      Payment: {},
      OtpChallenge: {},
      connection: { readyState: 1 }
    },
    deliverOtp: async () => {},
    logOtp: () => {},
    riskFetchImpl: fetchImpl
  });
  return {
    app,
    tasks,
    feePlans,
    assessments,
    taskWrites: () => taskWrites,
    tokenFor: (userId) => signAccessToken(users.find((user) => user._id === userId), config.JWT_SECRET, '2h')
  };
}

test('risk feature extraction uses unpaid overdue instalments, latest test delta, and recorded broken promises', () => {
  const features = getRiskFeatures({
    studentId: 'STU-1',
    attendancePercentage: 65,
    testPerformance: [
      { score: 90, testDate: new Date('2027-01-01') },
      { score: 80, testDate: new Date('2027-02-01') }
    ],
    paymentPromises: [{ status: 'broken' }, { status: 'kept' }]
  }, {
    installments: [
      { dueDate: new Date('2027-01-01'), amountPaise: 10000, paidAmountPaise: 0 },
      { dueDate: new Date('2027-01-01'), amountPaise: 10000, paidAmountPaise: 10000 }
    ]
  }, new Date('2027-02-01T12:00:00Z'));
  assert.deepEqual(features, {
    studentId: 'STU-1',
    missedInstallments: 1,
    overdueDays: 31,
    attendancePercentage: 65,
    testPerformanceTrend: -10,
    brokenPaymentPromises: 1
  });
});

test('accounts can create an explainable counsellor task and duplicate assessments reuse it', async () => {
  const harness = createRiskHarness();
  const accounts = `Bearer ${harness.tokenFor('accounts-id')}`;
  const first = await request(harness.app).post('/api/risks/assess')
    .set('Authorization', accounts)
    .send({ studentId: 'STU-1' });
  assert.equal(first.status, 201);
  assert.equal(first.body.assessment.riskScore, 82);
  assert.equal(first.body.task.studentId, 'STU-1');
  assert.equal(first.body.task.status, 'open');
  assert.equal(first.body.task.studentName, 'Student One');
  assert.equal(first.body.task.riskLevel, 'HIGH');
  assert.deepEqual(first.body.task.reasons, [
    'Instalment overdue',
    'Attendance below 70%',
    'Test performance declining'
  ]);
  assert.deepEqual(first.body.task.scoreBreakdown, {
    missedInstallments: 15,
    overdueDays: 20,
    attendancePercentage: 20,
    testPerformanceTrend: 15,
    brokenPaymentPromises: 12
  });
  assert.equal(first.body.task.assessmentMethod, 'explainable_rules_baseline');
  const taskId = first.body.task._id;
  const createdAt = first.body.task.createdAt;

  const second = await request(harness.app).post('/api/risks/assess')
    .set('Authorization', accounts)
    .send({ studentId: 'STU-1' });
  assert.equal(second.status, 201);
  assert.equal(second.body.task._id, taskId);
  assert.equal(second.body.task.createdAt, createdAt);
  assert.equal(harness.taskWrites(), 2);
  assert.equal(harness.tasks.size, 1);
  assert.equal(harness.assessments.length, 2);
  assert.equal(harness.assessments[0].studentId, 'STU-1');
  assert.equal(harness.assessments[0].riskScore, 82);
  assert.deepEqual(harness.assessments[0].reasons, first.body.assessment.reasons);
  assert.equal(harness.assessments[0].assessedBy, 'accounts-id');
  assert.equal(harness.assessments[0].counsellorTaskId, taskId);
});

test('low risk assessment does not create a counsellor task', async () => {
  const harness = createRiskHarness(async () => ({
    ok: true,
    json: async () => ({
      studentId: 'STU-2',
      riskLevel: 'LOW',
      riskScore: 0,
      reasons: [],
      recommendedAction: 'Continue routine monitoring',
      scoreBreakdown: {},
      missingFeatures: [],
      assessmentMethod: 'explainable_rules_baseline',
      modelVersion: 'rules-baseline-v1'
    })
  }));
  const response = await request(harness.app).post('/api/risks/assess')
    .set('Authorization', `Bearer ${harness.tokenFor('accounts-id')}`)
    .send({ studentId: 'STU-2' });
  assert.equal(response.status, 201);
  assert.equal(response.body.task, null);
  assert.equal(harness.tasks.size, 0);
  assert.equal(harness.assessments.length, 1);
  assert.equal(harness.assessments[0].riskLevel, 'LOW');
});

test('low, medium, and high assessments are all persisted with no low-risk task', async () => {
  const cases = [
    { riskLevel: 'LOW', riskScore: 0, scoreBreakdown: {}, reasons: [] },
    {
      riskLevel: 'MEDIUM',
      riskScore: 45,
      scoreBreakdown: { missedInstallments: 15, overdueDays: 20, attendancePercentage: 10 },
      reasons: ['Overdue balance and attendance indicators']
    },
    {
      riskLevel: 'HIGH',
      riskScore: 82,
      scoreBreakdown: {
        missedInstallments: 15,
        overdueDays: 20,
        attendancePercentage: 20,
        testPerformanceTrend: 15,
        brokenPaymentPromises: 12
      },
      reasons: ['High-risk indicators']
    }
  ];
  for (const result of cases) {
    const harness = createRiskHarness(async () => ({
      ok: true,
      json: async () => ({
        studentId: 'STU-1',
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
        scoreBreakdown: result.scoreBreakdown,
        reasons: result.reasons,
        missingFeatures: [],
        recommendedAction: result.riskScore >= 30
          ? 'Create counsellor follow-up task'
          : 'Continue routine monitoring',
        assessmentMethod: 'explainable_rules_baseline',
        modelVersion: 'rules-baseline-v1'
      })
    }));
    const response = await request(harness.app).post('/api/risks/assess')
      .set('Authorization', `Bearer ${harness.tokenFor('accounts-id')}`)
      .send({ studentId: 'STU-1' });
    assert.equal(response.status, 201);
    assert.equal(harness.assessments.length, 1);
    assert.equal(harness.assessments[0].riskLevel, result.riskLevel);
    assert.equal(harness.assessments[0].riskScore, result.riskScore);
    assert.equal(harness.tasks.size, result.riskScore >= 30 ? 1 : 0);
  }
});

test('unavailable AI service returns 503 without creating a task or changing the fee ledger', async () => {
  const harness = createRiskHarness(async () => { throw new Error('connection refused'); });
  const originalPlan = structuredClone(harness.feePlans[0]);
  const response = await request(harness.app).post('/api/risks/assess')
    .set('Authorization', `Bearer ${harness.tokenFor('accounts-id')}`)
    .send({ studentId: 'STU-1' });
  assert.equal(response.status, 503);
  assert.deepEqual(harness.feePlans[0], originalPlan);
  assert.equal(harness.tasks.size, 0);
  assert.equal(harness.assessments.length, 0);
});

test('parents cannot access risk records and counsellors cannot access fee-management routes', async () => {
  const harness = createRiskHarness();
  assert.equal((await request(harness.app).get('/api/risks/tasks')
    .set('Authorization', `Bearer ${harness.tokenFor('parent-id')}`)).status, 403);
  assert.equal((await request(harness.app).post('/api/risks/assess')
    .set('Authorization', `Bearer ${harness.tokenFor('parent-id')}`)
    .send({ studentId: 'STU-2' })).status, 403);
  assert.equal((await request(harness.app).get('/api/fees/students')
    .set('Authorization', `Bearer ${harness.tokenFor('counsellor-id')}`)).status, 403);
});

test('only counsellors can record valid or false-flag feedback', async () => {
  const harness = createRiskHarness();
  const accountsToken = `Bearer ${harness.tokenFor('accounts-id')}`;
  const counsellorToken = `Bearer ${harness.tokenFor('counsellor-id')}`;
  const assessed = await request(harness.app).post('/api/risks/assess')
    .set('Authorization', accountsToken)
    .send({ studentId: 'STU-1' });
  const taskList = await request(harness.app).get('/api/risks/tasks')
    .set('Authorization', counsellorToken);
  assert.equal(taskList.status, 200);
  assert.equal(taskList.body.tasks[0].studentId, 'STU-1');
  const denied = await request(harness.app).post(`/api/risks/tasks/${taskId}/feedback`)
    .set('Authorization', accountsToken)
    .send({ feedback: 'valid' });
  assert.equal(denied.status, 403);

  const reviewed = await request(harness.app).post(`/api/risks/tasks/${taskId}/feedback`)
    .set('Authorization', counsellorToken)
    .send({ feedback: 'false_flag', note: 'Reviewed with the student; flag was not supported.' });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.task.feedback, 'false_flag');
  assert.equal(reviewed.body.task.status, 'dismissed');
  assert.equal(reviewed.body.task.feedbackBy, 'counsellor-id');
  assert.equal(assessed.status, 201);

  const duplicateReview = await request(harness.app).post(`/api/risks/tasks/${taskId}/feedback`)
    .set('Authorization', counsellorToken)
    .send({ feedback: 'valid' });
  assert.equal(duplicateReview.status, 409);
});

test('invalid assessments and unknown students are rejected', async () => {
  const harness = createRiskHarness(async () => ({
    ok: true,
    json: async () => ({ studentId: 'OTHER-STUDENT', riskScore: 101 })
  }));
  const accounts = `Bearer ${harness.tokenFor('accounts-id')}`;
  assert.equal((await request(harness.app).post('/api/risks/assess')
    .set('Authorization', accounts).send({ studentId: 'STU-UNKNOWN' })).status, 404);
  assert.equal((await request(harness.app).post('/api/risks/assess')
    .set('Authorization', accounts).send({ studentId: 'STU-1', riskScore: 100 })).status, 400);
  assert.equal((await request(harness.app).post('/api/risks/assess')
    .set('Authorization', accounts).send({ studentId: 'STU-1' })).status, 502);
  assert.equal((await request(harness.app).post('/api/risks/assess')
    .set('Authorization', accounts).send({ studentId: '' })).status, 400);
});
