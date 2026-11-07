import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { demoParents, demoAccountsUser } from '../src/demo-seed-data.js';
import { models, startLiveMongoApp } from './live-mongodb-helpers.js';
import { processReminderCycle, retryFailedReminder, scheduleInstallmentReminders } from '../src/services/reminders.js';

function scopedModel(Model, studentId) {
  return new Proxy(Model, {
    get(target, property) {
      if (property === 'findById') {
        return (id, projection, options) =>
          target.findOne({ _id: id, studentId }, projection, options);
      }
      const original = Reflect.get(target, property, target);
      if (['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany'].includes(property)) {
        return (filter = {}, ...args) =>
          original.call(target, { ...filter, studentId }, ...args);
      }
      return typeof original === 'function' ? original.bind(target) : original;
    }
  });
}

function snapshot(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

test('real MongoDB reminder, AI risk, counsellor, and dashboard verification', async () => {
  const runtime = await startLiveMongoApp();
  try {
    const fixture = await runtime.createFixture({ hasCounsellor: true });
    const parent = await runtime.login(fixture.parentEmail, process.env.DEMO_PARENT_PASSWORD);
    const accounts = await runtime.login(demoAccountsUser.email, process.env.DEMO_ACCOUNTS_PASSWORD);
    const counsellor = await runtime.login(fixture.counsellorEmail, process.env.DEMO_PARENT_PASSWORD);
    assert.equal(counsellor.user.role, 'counsellor');

    const reminderModels = {
      ...models,
      Reminder: scopedModel(models.Reminder, fixture.studentId),
      Student: scopedModel(models.Student, fixture.studentId),
      FeePlan: scopedModel(models.FeePlan, fixture.studentId),
      User: scopedModel(models.User, fixture.studentId)
    };
    const auditEvents = [];
    const now = new Date('2027-01-07T00:00:00.000Z');
    let deliveryFails = true;
    const provider = {
      async send() {
        if (deliveryFails) throw new Error('QA-only mock delivery failure');
        return { accepted: true, provider: 'mock' };
      }
    };
    const reminderOptions = {
      now,
      offsetsDays: [3, 0, -3],
      catchUpWindowMs: 86_400_000,
      staleSendingTimeoutMs: 300_000,
      retryDelaysMs: [1_000, 5_000],
      provider,
      auditLog: (event) => auditEvents.push(event)
    };
    const scheduled = await processReminderCycle(reminderModels, reminderOptions);
    assert.equal(scheduled.scheduled, 9);
    assert.equal(scheduled.failed, 1);
    let reminderRecords = await models.Reminder.find({ studentId: fixture.studentId }).lean();
    assert.equal(reminderRecords.length, 9);
    const failedReminder = reminderRecords.find(({ status }) => status === 'failed');
    assert.ok(failedReminder);
    assert.equal(failedReminder.language, 'hi');
    assert.match(failedReminder.message, /प्रिय अभिभावक/);
    const reminderList = await runtime.call('/reminders', { token: accounts.accessToken });
    assert.equal(reminderList.status, 200);
    assert.ok(reminderList.payload.reminders.some(({ _id }) => _id.toString() === failedReminder._id.toString()));
    assert.equal((await models.Reminder.findById(failedReminder._id).lean())._id.toString(),
      failedReminder._id.toString());

    const duplicateSchedule = await scheduleInstallmentReminders(reminderModels, reminderOptions);
    assert.equal(duplicateSchedule.scheduled, 0);
    assert.equal(await models.Reminder.countDocuments({ studentId: fixture.studentId }), 9);
    const changedPreference = await runtime.call('/reminders/preferences', {
      method: 'POST',
      token: parent.accessToken,
      body: { preferredLanguage: 'en' }
    });
    assert.equal(changedPreference.status, 200);
    assert.equal((await models.User.findById(parent.user.id).lean()).preferredLanguage, 'en');
    await scheduleInstallmentReminders(reminderModels, reminderOptions);
    const englishReminder = await models.Reminder.findOne({
      studentId: fixture.studentId,
      status: 'scheduled'
    }).lean();
    assert.ok(englishReminder);
    assert.equal(englishReminder.language, 'en');
    assert.match(englishReminder.message, /Dear Parent/);

    deliveryFails = false;
    const retry = await retryFailedReminder(reminderModels, failedReminder._id, {
      ...reminderOptions,
      now: new Date(now.getTime() + 1_000)
    });
    assert.equal(retry.sent, 1);
    assert.equal((await models.Reminder.findById(failedReminder._id).lean()).status, 'sent');

    const staleReminder = await models.Reminder.findOne({
      studentId: fixture.studentId,
      status: 'scheduled',
      scheduledAt: new Date('2027-03-07T00:00:00.000Z')
    }).lean();
    assert.ok(staleReminder);
    await models.Reminder.updateOne({ _id: staleReminder._id, studentId: fixture.studentId }, {
      $set: {
        status: 'sending',
        attempts: 1,
        lastAttemptAt: new Date('2027-03-06T23:50:00.000Z')
      }
    });
    const staleCycle = await processReminderCycle(reminderModels, {
      ...reminderOptions,
      now: new Date('2027-03-07T00:00:00.000Z')
    });
    assert.equal(staleCycle.recovered, 1);
    assert.equal((await models.Reminder.findById(staleReminder._id).lean()).status, 'sent');
    assert.ok(auditEvents.some(({ event }) => event === 'reminder.stale_attempt_recovered'));
    assert.ok(auditEvents.some(({ event }) => event === 'reminder.retry_requested'));

    const health = await fetch('http://127.0.0.1:8000/health');
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.predictionMethod, 'explainable_rules_baseline');
    const prediction = await fetch('http://127.0.0.1:8000/predict-risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: 'QA-API-PROBE',
        missedInstallments: 2,
        overdueDays: 20,
        attendancePercentage: 60,
        testPerformanceTrend: -10,
        brokenPaymentPromises: 1
      })
    });
    assert.equal(prediction.status, 200);
    const directAssessment = await prediction.json();
    assert.equal(directAssessment.assessmentMethod, 'explainable_rules_baseline');
    assert.ok(directAssessment.reasons.length > 0);
    assert.equal(directAssessment.riskScore, Object.values(directAssessment.scoreBreakdown)
      .reduce((sum, points) => sum + points, 0));

    const financeBeforeRisk = await Promise.all([
      models.FeePlan.find({ studentId: fixture.studentId }).lean(),
      models.Payment.find({ studentId: fixture.studentId }).lean(),
      models.Reminder.find({ studentId: fixture.studentId }).lean(),
      models.Refund.find({ studentId: fixture.studentId }).lean()
    ]);
    const financeDigestBeforeRisk = snapshot(financeBeforeRisk);
    const assessmentResponse = await runtime.call('/risks/assess', {
      method: 'POST',
      token: accounts.accessToken,
      body: { studentId: fixture.studentId }
    });
    assert.equal(assessmentResponse.status, 201);
    assert.equal(assessmentResponse.payload.assessment.studentId, fixture.studentId);
    assert.ok(assessmentResponse.payload.assessment.reasons.length > 0);
    const taskId = assessmentResponse.payload.task?._id;
    assert.ok(taskId);
    let task = await models.CounsellorTask.findById(taskId).lean();
    assert.ok(task);
    assert.equal(task.assessmentMethod, 'explainable_rules_baseline');
    assert.equal(task.studentId, fixture.studentId);
    assert.ok(task.riskScore >= 30);
    assert.deepEqual(task.reasons, assessmentResponse.payload.assessment.reasons);
    assert.deepEqual(task.scoreBreakdown, assessmentResponse.payload.assessment.scoreBreakdown);
    assert.equal(await models.CounsellorTask.countDocuments({ studentId: fixture.studentId }), 1);
    const firstAssessmentRecord = await models.RiskAssessment.findOne({ studentId: fixture.studentId }).lean();
    assert.ok(firstAssessmentRecord);
    assert.equal(firstAssessmentRecord.riskLevel, assessmentResponse.payload.assessment.riskLevel);
    assert.deepEqual(firstAssessmentRecord.reasons, assessmentResponse.payload.assessment.reasons);
    const originalCreatedAt = task.createdAt;

    const repeatedAssessment = await runtime.call('/risks/assess', {
      method: 'POST',
      token: accounts.accessToken,
      body: { studentId: fixture.studentId }
    });
    assert.equal(repeatedAssessment.status, 201);
    assert.equal(repeatedAssessment.payload.task._id.toString(), taskId.toString());
    task = await models.CounsellorTask.findById(taskId).lean();
    assert.equal(task.createdAt.getTime(), originalCreatedAt.getTime());
    assert.equal(await models.CounsellorTask.countDocuments({ studentId: fixture.studentId }), 1);
    assert.equal(await models.RiskAssessment.countDocuments({ studentId: fixture.studentId }), 2);
    const counsellorTasks = await runtime.call('/risks/tasks', { token: counsellor.accessToken });
    assert.equal(counsellorTasks.status, 200);
    assert.ok(counsellorTasks.payload.tasks.some(({ _id }) => _id.toString() === taskId.toString()));

    assert.equal((await runtime.call('/risks/tasks', { token: parent.accessToken })).status, 403);
    assert.equal((await runtime.call(`/risks/tasks/${taskId}/feedback`, {
      method: 'POST',
      token: accounts.accessToken,
      body: { feedback: 'valid', note: 'QA supportive follow-up' }
    })).status, 403);
    const feedback = await runtime.call(`/risks/tasks/${taskId}/feedback`, {
      method: 'POST',
      token: counsellor.accessToken,
      body: { feedback: 'valid', note: 'QA supportive follow-up' }
    });
    assert.equal(feedback.status, 200);
    task = await models.CounsellorTask.findById(taskId).lean();
    assert.equal(task.feedback, 'valid');
    assert.equal(task.feedbackBy.toString(), counsellor.user.id);
    assert.ok(task.reviewedAt);
    const feedbackAt = task.reviewedAt.getTime();
    const reassessedAfterFeedback = await runtime.call('/risks/assess', {
      method: 'POST',
      token: accounts.accessToken,
      body: { studentId: fixture.studentId }
    });
    assert.equal(reassessedAfterFeedback.status, 201);
    assert.equal(reassessedAfterFeedback.payload.task._id.toString(), taskId.toString());
    task = await models.CounsellorTask.findById(taskId).lean();
    assert.equal(task.feedback, 'valid');
    assert.equal(task.feedbackBy.toString(), counsellor.user.id);
    assert.equal(task.reviewedAt.getTime(), feedbackAt);
    assert.equal(await models.CounsellorTask.countDocuments({ studentId: fixture.studentId }), 1);
    assert.equal(await models.RiskAssessment.countDocuments({ studentId: fixture.studentId }), 3);

    const falseFlagFixture = await runtime.createFixture();
    const secondAccounts = await runtime.login(
      falseFlagFixture.accountsEmail,
      process.env.DEMO_PARENT_PASSWORD
    );
    const falseFlagAssessment = await runtime.call('/risks/assess', {
      method: 'POST',
      token: secondAccounts.accessToken,
      body: { studentId: falseFlagFixture.studentId }
    });
    assert.equal(falseFlagAssessment.status, 201);
    const falseFlagTaskId = falseFlagAssessment.payload.task._id;
    const falseFlagFeedback = await runtime.call(`/risks/tasks/${falseFlagTaskId}/feedback`, {
      method: 'POST',
      token: counsellor.accessToken,
      body: { feedback: 'false_flag', note: 'QA-only false-flag review' }
    });
    assert.equal(falseFlagFeedback.status, 200);
    assert.equal(falseFlagFeedback.payload.task.feedback, 'false_flag');
    assert.equal(falseFlagFeedback.payload.task.status, 'dismissed');
    assert.equal((await models.CounsellorTask.findById(falseFlagTaskId).lean()).feedback, 'false_flag');

    const lowRiskFixture = await runtime.createFixture({
      attendancePercentage: 95,
      testPerformance: [
        { subject: 'Mathematics', score: 75, testDate: new Date('2026-09-10T00:00:00.000Z') },
        { subject: 'Mathematics', score: 77, testDate: new Date('2026-10-10T00:00:00.000Z') }
      ],
      paymentPromises: []
    });
    const lowRiskResponse = await runtime.call('/risks/assess', {
      method: 'POST',
      token: accounts.accessToken,
      body: { studentId: lowRiskFixture.studentId }
    });
    assert.equal(lowRiskResponse.status, 201);
    assert.equal(lowRiskResponse.payload.assessment.riskLevel, 'LOW');
    assert.equal(lowRiskResponse.payload.task, null);
    const lowRiskRecord = await models.RiskAssessment.findOne({ studentId: lowRiskFixture.studentId }).lean();
    assert.equal(lowRiskRecord.riskLevel, 'LOW');
    assert.equal(await models.CounsellorTask.countDocuments({ studentId: lowRiskFixture.studentId }), 0);

    const mediumRiskFixture = await runtime.createFixture({
      attendancePercentage: 75,
      dueDates: ['2026-10-01', '2027-02-10', '2027-03-10'],
      testPerformance: [
        { subject: 'Mathematics', score: 76, testDate: new Date('2026-09-10T00:00:00.000Z') },
        { subject: 'Mathematics', score: 78, testDate: new Date('2026-10-10T00:00:00.000Z') }
      ],
      paymentPromises: []
    });
    const mediumRiskResponse = await runtime.call('/risks/assess', {
      method: 'POST',
      token: accounts.accessToken,
      body: { studentId: mediumRiskFixture.studentId }
    });
    assert.equal(mediumRiskResponse.status, 201);
    assert.equal(mediumRiskResponse.payload.assessment.riskLevel, 'MEDIUM');
    assert.ok(mediumRiskResponse.payload.task?._id);
    const mediumRiskRecord = await models.RiskAssessment.findOne({ studentId: mediumRiskFixture.studentId }).lean();
    assert.equal(mediumRiskRecord.riskLevel, 'MEDIUM');
    assert.equal(await models.CounsellorTask.countDocuments({ studentId: mediumRiskFixture.studentId }), 1);

    const financeAfterRisk = await Promise.all([
      models.FeePlan.find({ studentId: fixture.studentId }).lean(),
      models.Payment.find({ studentId: fixture.studentId }).lean(),
      models.Reminder.find({ studentId: fixture.studentId }).lean(),
      models.Refund.find({ studentId: fixture.studentId }).lean()
    ]);
    assert.equal(snapshot(financeAfterRisk), financeDigestBeforeRisk);

    const dashboardResponse = await runtime.call('/fees/dashboard', { token: accounts.accessToken });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = dashboardResponse.payload.dashboard;
    const activeStudents = await models.Student.find({ isActive: true }).lean();
    const activeIds = activeStudents.map(({ studentId }) => studentId);
    const plans = await models.FeePlan.find({ studentId: { $in: activeIds } }).lean();
    const expected = {
      activeStudents: activeStudents.length,
      billed: plans.reduce((sum, plan) => sum + plan.totalFeePaise, 0),
      net: plans.reduce((sum, plan) => sum + plan.netFeePaise, 0),
      collected: plans.reduce((sum, plan) =>
        sum + plan.installments.reduce((paid, item) => paid + item.paidAmountPaise, 0), 0),
      outstanding: plans.reduce((sum, plan) => sum + plan.netFeePaise -
        plan.installments.reduce((paid, item) => paid + item.paidAmountPaise, 0), 0)
    };
    assert.equal(dashboard.summary.totalFeesBilledPaise, expected.billed);
    assert.equal(dashboard.summary.totalNetFeesPaise, expected.net);
    assert.equal(dashboard.summary.totalFeesCollectedPaise, expected.collected);
    assert.equal(dashboard.summary.totalOutstandingPaise, expected.outstanding);
    const expectedOverdue = dashboard.rows
      .filter(({ status, outstandingPaise }) => status === 'overdue' && outstandingPaise > 0)
      .reduce((sum, row) => sum + row.outstandingPaise, 0);
    assert.equal(dashboard.summary.overdueAmountPaise, expectedOverdue);
    assert.equal(new Set(dashboard.rows.map(({ studentId }) => studentId)).size, expected.activeStudents);
    const [refundStats, reminderStats, assessmentRecords, taskRecords] = await Promise.all([
      models.Refund.aggregate([
        { $match: { studentId: { $in: activeIds }, status: { $in: ['pending_review', 'approved', 'rejected'] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      models.Reminder.aggregate([
        { $match: { studentId: { $in: activeIds }, status: { $in: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      models.RiskAssessment.aggregate([
        { $match: { studentId: { $in: activeIds }, riskLevel: { $in: ['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high'] } } },
        { $sort: { assessedAt: -1, _id: -1 } },
        { $group: { _id: '$studentId', riskLevel: { $first: '$riskLevel' } } }
      ]),
      models.CounsellorTask.aggregate([
        { $match: { studentId: { $in: activeIds }, riskLevel: { $in: ['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high'] } } },
        { $sort: { createdAt: -1, _id: -1 } },
        { $group: { _id: '$studentId', riskLevel: { $first: '$riskLevel' } } }
      ])
    ]);
    const riskByStudent = new Map(taskRecords.map(({ _id, riskLevel }) => [_id, riskLevel]));
    for (const { _id, riskLevel } of assessmentRecords) riskByStudent.set(_id, riskLevel);
    const riskDistribution = { low: 0, medium: 0, high: 0 };
    for (const riskLevel of riskByStudent.values()) riskDistribution[riskLevel.toLowerCase()] += 1;
    const refundCounts = Object.fromEntries(refundStats.map(({ _id, count }) => [_id, count]));
    const reminderCounts = Object.fromEntries(reminderStats.map(({ _id, count }) => [_id, count]));
    const expectedPendingReminders = (reminderCounts.scheduled ?? 0) + (reminderCounts.sending ?? 0);
    assert.deepEqual(dashboard.metrics.students, {
      totalActive: activeIds.length,
      assessedForRisk: riskByStudent.size
    });
    assert.deepEqual(dashboard.metrics.refunds, {
      total: ['pending_review', 'approved', 'rejected'].reduce((sum, status) => sum + (refundCounts[status] ?? 0), 0),
      pending: refundCounts.pending_review ?? 0,
      approved: refundCounts.approved ?? 0,
      rejected: refundCounts.rejected ?? 0
    });
    assert.deepEqual(dashboard.metrics.reminders, {
      total: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'].reduce((sum, status) => sum + (reminderCounts[status] ?? 0), 0),
      scheduled: reminderCounts.scheduled ?? 0,
      pending: expectedPendingReminders,
      sent: reminderCounts.sent ?? 0,
      failed: reminderCounts.failed ?? 0,
      cancelled: reminderCounts.cancelled ?? 0
    });
    assert.deepEqual(dashboard.metrics.riskDistribution, riskDistribution);
    assert.ok(reminderStats.every(({ count }) => Number.isSafeInteger(count)));
    assert.ok(Object.values(riskDistribution).every(Number.isSafeInteger));

    console.info(JSON.stringify({
      workflow: 'reminder-risk-dashboard',
      result: 'PASS',
      reminders: { persisted: 9, duplicatePrevention: true, retry: true, staleRecovery: true },
      mockDeliveryOnly: true,
      reminderAuditCallbackEvents: auditEvents.length,
      auditEventsPersistedInMongo: false,
      aiHealthAndPrediction: 'passed',
      expressRiskAssessmentCreation: 'passed',
      repeatedAssessmentDuplicatePrevention: true,
      counsellorFeedbackPersistence: { valid: true, falseFlag: true },
      riskAssessmentPersistence: true,
      riskFinancialNonMutation: true,
      dashboardMongoMetricsMatch: true,
      underlyingCounts: {
        activeStudents: expected.activeStudents,
        feePlans: plans.length,
        totalFeesBilledPaise: expected.billed,
        totalNetFeesPaise: expected.net,
        totalCollectedPaise: expected.collected,
        totalOutstandingPaise: expected.outstanding,
        overdueAmountPaise: expectedOverdue,
        refundStatusGroups: refundCounts,
        reminderStatusGroups: Object.fromEntries(reminderStats.map(({ _id, count }) => [_id, count])),
        riskDistribution
      }
    }));
  } finally {
    const cleaned = await runtime.close();
    console.info(JSON.stringify({ cleanup: 'reminder-risk-dashboard', records: cleaned }));
  }
});
