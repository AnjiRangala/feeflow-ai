import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import test from 'node:test';
import { signAccessToken } from '../src/lib/auth.js';

const enabled = process.env.RUN_MONGODB_INTEGRATION_TESTS === 'true';
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));

function sanitizedMongoError(error) {
  return String(error.message ?? 'MongoDB operation failed')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB URI redacted]')
    .replace(/\b(password|passwd|secret|token)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/[\r\n]+/g, ' ');
}

test('MongoDB seed, authentication, role access, payment, and parent isolation work against a disposable database', {
  skip: !enabled && 'Set RUN_MONGODB_INTEGRATION_TESTS=true to run against a temporary MongoDB database'
}, async (t) => {
  const { config } = await import('../src/config/env.js');
  if (!process.env.DEMO_PARENT_PASSWORD || !process.env.DEMO_ACCOUNTS_PASSWORD) {
    t.skip('Demo credentials are unavailable in the local environment');
    return;
  }

  const targetDatabase = `feeflow_qa_${randomUUID().replaceAll('-', '')}`;
  const targetUrl = new URL(config.MONGO_URI);
  const originalDatabase = decodeURIComponent(targetUrl.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
  targetUrl.pathname = `/${targetDatabase}`;
  if (originalDatabase && !targetUrl.searchParams.has('authSource')) {
    targetUrl.searchParams.set('authSource', originalDatabase);
  }
  const uri = targetUrl.toString();
  let server;
  let connected = false;
  const challengeIds = [];
  let temporaryOrderId;
  let temporaryOrderParentId;

  try {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
      connected = true;
    } catch (error) {
      if ([13, 18, 8000].includes(error.code)) {
        const codeName = /^[A-Za-z]+$/.test(error.codeName ?? '') ? error.codeName : 'MongoDB authorization error';
        t.skip(
          `MongoDB denied access to the isolated QA database (${codeName}, code ${error.code}): ` +
          `${sanitizedMongoError(error)}; live integration checks were not run`
        );
        return;
      }
      throw error;
    }

    for (let run = 0; run < 2; run += 1) {
      const seed = spawnSync(process.execPath, ['src/seed.js'], {
        cwd: backendDirectory,
        env: { ...process.env, MONGO_URI: uri },
        encoding: 'utf8',
        timeout: 120_000
      });
      assert.equal(seed.status, 0, `Seed run ${run + 1} failed; child output is suppressed to protect environment data`);
    }

    const [{
      User,
      Student,
      FeePlan,
      Payment,
      Reminder,
      Refund,
      CounsellorTask,
      MockPaymentOrder,
      OtpChallenge
    }, { createApp }] = await Promise.all([
      import('../src/models/index.js'),
      import('../src/app.js')
    ]);
    await Reminder.init();
    await Refund.init();

    const counts = {
      users: await User.countDocuments({}),
      students: await Student.countDocuments({}),
      feePlans: await FeePlan.countDocuments({}),
      payments: await Payment.countDocuments({ status: 'completed' })
    };
    assert.deepEqual(counts, {
      users: 4 + Number(Boolean(process.env.DEMO_COUNSELLOR_PASSWORD)),
      students: 4,
      feePlans: 4,
      payments: 2
    });
    assert.equal(await Reminder.countDocuments({
      demoSeedKey: 'feeflow-ai-demo-v1:reminder:STU-0773:2'
    }), 1);
    assert.equal(await Refund.countDocuments({
      demoSeedKey: 'feeflow-ai-demo-v1:refund:STU-0412'
    }), 1);
    assert.ok(await CounsellorTask.countDocuments({
      demoSeedKey: 'feeflow-ai-demo-v1:risk:STU-0773'
    }) <= 1);
    assert.equal(await User.countDocuments({ role: 'parent', studentId: 'STU-0587', isActive: true }), 1);
    assert.equal(await User.countDocuments({ role: 'accounts', isActive: true }), 1);
    assert.equal(await Student.countDocuments({ isActive: true }), 4);

    const capturedOtp = new Map();
    const runtimeConfig = { ...config, NODE_ENV: 'development', MOCK_PAYMENTS_ENABLED: true };
    const app = createApp({
      config: runtimeConfig,
      models: { User, Student, FeePlan, Payment, Reminder, Refund, MockPaymentOrder, OtpChallenge, connection: mongoose.connection },
      deliverOtp: async () => { throw new Error('External OTP delivery is disabled during integration tests'); },
      logOtp: (message) => {
        const match = message.match(/for ([^:]+): (\d{6})$/);
        if (match) capturedOtp.set(match[1].toLowerCase(), match[2]);
      }
    });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (path, { method = 'GET', token, body } = {}) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      let payload = null;
      try {
        payload = response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : await response.text();
      } catch { }
      return { status: response.status, payload };
    };
    const login = async (email, password) => {
      const response = await call('/auth/login', { method: 'POST', body: { email, password } });
      assert.equal(response.status, 202);
      challengeIds.push(response.payload.challengeId);
      const otp = capturedOtp.get(email.toLowerCase());
      assert.match(otp ?? '', /^\d{6}$/);
      const verification = await call('/auth/verify-otp', {
        method: 'POST',
        body: { challengeId: response.payload.challengeId, code: otp }
      });
      assert.equal(verification.status, 200);
      return verification.payload;
    };

    const parentEmail = 'parent0587@feeflow.demo';
    const accountsEmail = 'accounts@feeflow.demo';
    const parent = await login(parentEmail, process.env.DEMO_PARENT_PASSWORD);
    const accounts = await login(accountsEmail, process.env.DEMO_ACCOUNTS_PASSWORD);
    assert.equal(parent.user.role, 'parent');
    assert.equal(parent.user.studentId, 'STU-0587');
    assert.equal(accounts.user.role, 'accounts');
    assert.equal('passwordHash' in parent.user, false);
    assert.equal('passwordHash' in accounts.user, false);

    const dashboard = await call('/fees/dashboard', { token: accounts.accessToken });
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.payload.dashboard.summary.totalFeesBilledPaise > 0);
    assert.equal(dashboard.payload.dashboard.overdueAgeing.length, 5);
    assert.ok(dashboard.payload.dashboard.rows.length > 0);
    const csvExport = await call('/fees/export.csv', { token: accounts.accessToken });
    assert.equal(csvExport.status, 200);
    assert.match(csvExport.payload, /Student ID/);
    assert.equal((await call('/fees/dashboard', { token: parent.accessToken })).status, 403);

    const refundCalculation = await call('/refunds/calculate', {
      method: 'POST',
      token: accounts.accessToken,
      body: {
        studentId: 'STU-0587',
        courseStartDate: '2026-01-01',
        withdrawalDate: '2026-02-20',
        totalCourseDurationDays: 100,
        nonRefundableChargesPaise: 0
      }
    });
    assert.equal(refundCalculation.status, 201);
    assert.equal(refundCalculation.payload.refund.status, 'pending_review');
    assert.ok(refundCalculation.payload.refund.calculationDetails.feeEarnedPaise >= 0);
    assert.equal((await call('/refunds', { token: parent.accessToken })).status, 403);
    const refundApproval = await call(`/refunds/${refundCalculation.payload.refund._id}/approve`, {
      method: 'POST',
      token: accounts.accessToken,
      body: {}
    });
    assert.equal(refundApproval.status, 200);
    assert.equal(refundApproval.payload.refund.status, 'approved');
    assert.equal(refundApproval.payload.disbursement, 'not_issued');

    const parentBadPassword = await call('/auth/login', {
      method: 'POST',
      body: { email: parentEmail, password: `${process.env.DEMO_PARENT_PASSWORD.slice(0, 120)}-invalid` }
    });
    const accountsBadPassword = await call('/auth/login', {
      method: 'POST',
      body: { email: accountsEmail, password: `${process.env.DEMO_ACCOUNTS_PASSWORD.slice(0, 120)}-invalid` }
    });
    const unknownUser = await call('/auth/login', {
      method: 'POST',
      body: { email: `unknown-${randomUUID()}@invalid.example`, password: 'not-a-real-password' }
    });
    assert.equal(parentBadPassword.status, 401);
    assert.equal(accountsBadPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.equal((await call('/auth/me')).status, 401);
    assert.equal((await call('/auth/me', { token: 'not.a.valid.jwt' })).status, 401);
    assert.equal((await call('/auth/me', {
      token: signAccessToken({ id: parent.user.id, role: 'parent' }, config.JWT_SECRET, -1)
    })).status, 401);
    assert.equal((await call('/auth/me', { token: parent.accessToken })).payload.user.role, 'parent');
    assert.equal((await call('/auth/me', { token: accounts.accessToken })).payload.user.role, 'accounts');

    const ownList = await call('/fees/students', { token: parent.accessToken });
    assert.equal(ownList.status, 200);
    assert.equal(ownList.payload.students.length, 1);
    assert.equal(ownList.payload.students[0].student.studentId, parent.user.studentId);
    const ownLedger = await call(`/fees/student/${parent.user.studentId}`, { token: parent.accessToken });
    assert.equal(ownLedger.status, 200);
    assert.ok(ownLedger.payload.student.feePlan.installments.length > 0);
    assert.equal((await call('/fees/summary', { token: parent.accessToken })).status, 403);

    const otherStudent = await Student.findOne({ studentId: { $ne: parent.user.studentId } }).select('studentId').lean();
    assert.ok(otherStudent);
    assert.equal((await call(`/fees/student/${otherStudent.studentId}`, { token: parent.accessToken })).status, 403);
    assert.equal((await call('/payments/record', {
      method: 'POST',
      token: parent.accessToken,
      body: {
        studentId: otherStudent.studentId,
        installmentNumber: 1,
        amountPaise: 1,
        transactionId: `QA-${randomUUID()}`,
        paymentMethod: 'upi'
      }
    })).status, 403);
    const otherPayment = await Payment.findOne({
      studentId: otherStudent.studentId,
      status: 'completed'
    }).select('_id').lean();
    if (otherPayment) {
      assert.equal((await call(`/parent-payments/receipts/${otherPayment._id}`, {
        token: parent.accessToken
      })).status, 404);
    }
    assert.equal((await call('/parent-payments/orders', {
      method: 'POST',
      token: parent.accessToken,
      body: { installmentNumber: 1, studentId: otherStudent.studentId }
    })).status, 400);

    const accountsList = await call('/fees/students', { token: accounts.accessToken });
    assert.equal(accountsList.status, 200);
    assert.equal(accountsList.payload.students.length, 4);
    assert.equal((await call('/fees/summary', { token: accounts.accessToken })).status, 200);
    assert.equal((await call(`/fees/student/${otherStudent.studentId}`, {
      token: accounts.accessToken
    })).status, 200);

    const payable = ownLedger.payload.student.feePlan.installments.find(({ outstandingPaise }) => outstandingPaise > 0);
    assert.ok(payable);
    const orderResponse = await call('/parent-payments/orders', {
      method: 'POST',
      token: parent.accessToken,
      body: { installmentNumber: payable.installmentNumber }
    });
    assert.equal(orderResponse.status, 201);
    const order = orderResponse.payload.order;
    temporaryOrderId = order.id;
    temporaryOrderParentId = parent.user.id;
    assert.equal(order.amountPaise, payable.outstandingPaise);
    assert.equal((await call(`/parent-payments/orders/${new mongoose.Types.ObjectId()}/complete`, {
      method: 'POST',
      token: parent.accessToken,
      body: { outcome: 'success' }
    })).status, 404);
    const completed = await call(`/parent-payments/orders/${order.id}/complete`, {
      method: 'POST',
      token: parent.accessToken,
      body: { outcome: 'success' }
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.payload.payment.amountPaise, payable.outstandingPaise);
    const updatedLedger = await call(`/fees/student/${parent.user.studentId}`, { token: parent.accessToken });
    assert.equal(updatedLedger.payload.student.remainingBalancePaise,
      ownLedger.payload.student.remainingBalancePaise - payable.outstandingPaise);
    assert.equal(updatedLedger.payload.student.feePlan.installments
      .find(({ installmentNumber }) => installmentNumber === payable.installmentNumber).status, 'paid');
    const replay = await call(`/parent-payments/orders/${order.id}/complete`, {
      method: 'POST',
      token: parent.accessToken,
      body: { outcome: 'success' }
    });
    assert.equal(replay.status, 409);

    const receipt = await call(`/parent-payments/receipts/${completed.payload.payment.id}`, {
      token: parent.accessToken
    });
    assert.equal(receipt.status, 200);
    assert.match(receipt.payload, /FeeFlow AI payment receipt/);

    const remaining = updatedLedger.payload.student.feePlan.installments
      .find(({ outstandingPaise }) => outstandingPaise > 0);
    if (remaining) {
      const beforeFailureBalance = updatedLedger.payload.student.remainingBalancePaise;
      const failedOrder = await call('/parent-payments/orders', {
        method: 'POST',
        token: parent.accessToken,
        body: { installmentNumber: remaining.installmentNumber }
      });
      assert.equal(failedOrder.status, 201);
      temporaryOrderId = failedOrder.payload.order.id;
      const failed = await call(`/parent-payments/orders/${temporaryOrderId}/complete`, {
        method: 'POST',
        token: parent.accessToken,
        body: { outcome: 'failure' }
      });
      assert.equal(failed.status, 200);
      assert.equal(failed.payload.status, 'failed');
      const unchanged = await call(`/fees/student/${parent.user.studentId}`, { token: parent.accessToken });
      assert.equal(unchanged.payload.student.remainingBalancePaise, beforeFailureBalance);
    }

    const {
      processReminderCycle,
      retryFailedReminder,
      scheduleInstallmentReminders,
      syncInstallmentReminders
    } = await import('../src/services/reminders.js');
    const reminderStudentId = `IT-${randomUUID()}`;
    const reminderParentEmail = `reminder-parent-${randomUUID()}@invalid.example`;
    await Student.create({
      studentId: reminderStudentId,
      name: 'Reminder Integration Student',
      batch: 'Integration',
      centre: 'Integration',
      parentPhone: '+919876543210',
      parentEmail: reminderParentEmail,
      isActive: true
    });
    await User.create({
      name: 'Reminder Integration Parent',
      email: reminderParentEmail,
      phone: '+919876543210',
      passwordHash: 'integration-test-only',
      role: 'parent',
      studentId: reminderStudentId,
      preferredLanguage: 'hi',
      isActive: true
    });
    const reminderPlan = await FeePlan.create({
      studentId: reminderStudentId,
      totalFeePaise: 3_000_000,
      discountPaise: 0,
      netFeePaise: 3_000_000,
      numberOfInstallments: 3,
      installments: [0, 1, 2].map((index) => ({
        installmentNumber: index + 1,
        dueDate: new Date(Date.UTC(2030, index, 10)),
        amountPaise: 1_000_000,
        paidAmountPaise: 0,
        status: 'upcoming',
        payments: []
      }))
    });
    const reminderModels = { User, Student, FeePlan, Reminder };
    const reminderNow = new Date('2030-01-07T00:00:00.000Z');
    let shouldFailDelivery = true;
    const mockProvider = {
      async send() {
        if (shouldFailDelivery) throw new Error('integration-only provider failure');
        return { accepted: true, provider: 'mock' };
      }
    };
    const reminderOptions = {
      now: reminderNow,
      offsetsDays: [3, 0, -3],
      catchUpWindowMs: 86_400_000,
      retryDelaysMs: [1_000, 5_000],
      provider: mockProvider,
      auditLog: () => {}
    };
    const firstCycle = await processReminderCycle(reminderModels, reminderOptions);
    assert.equal(firstCycle.scheduled, 9);
    assert.equal(firstCycle.failed, 1);
    let reminderRecords = await Reminder.find({ studentId: reminderStudentId }).lean();
    assert.equal(reminderRecords.length, 9);
    const failedReminder = reminderRecords.find(({ status }) => status === 'failed');
    assert.match(failedReminder.message, /प्रिय अभिभावक/);

    const firstInstallment = reminderPlan.installments[0];
    firstInstallment.paidAmountPaise = 250_000;
    firstInstallment.status = 'partially_paid';
    await reminderPlan.save();
    await syncInstallmentReminders(Reminder, reminderStudentId, firstInstallment, reminderNow);
    const refreshedFailed = await Reminder.findById(failedReminder._id).lean();
    assert.equal(refreshedFailed.outstandingAmountPaise, 750_000);
    assert.match(refreshedFailed.message, /₹7,500/);

    shouldFailDelivery = false;
    const retried = await retryFailedReminder(reminderModels, failedReminder._id, {
      ...reminderOptions,
      now: new Date(reminderNow.getTime() + 1_000)
    });
    assert.equal(retried.sent, 1);
    firstInstallment.paidAmountPaise = firstInstallment.amountPaise;
    firstInstallment.status = 'paid';
    await reminderPlan.save();
    await syncInstallmentReminders(Reminder, reminderStudentId, firstInstallment, reminderNow);
    await scheduleInstallmentReminders(reminderModels, {
      ...reminderOptions,
      now: new Date(reminderNow.getTime() + 2_000)
    });
    reminderRecords = await Reminder.find({ studentId: reminderStudentId }).lean();
    assert.equal(reminderRecords.length, 9);
    assert.equal(reminderRecords.filter(({ status }) => status === 'sent').length, 1);
    assert.equal(reminderRecords.filter(({ status }) => status === 'cancelled').length, 2);
    assert.ok(reminderRecords.filter(({ status }) => status === 'cancelled')
      .every(({ cancellationReason }) => cancellationReason === 'Instalment fully paid'));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connected) {
      try {
        if (temporaryOrderId) {
          await mongoose.connection.collection('mockpaymentorders').deleteOne({
            _id: new mongoose.Types.ObjectId(temporaryOrderId),
            parentUserId: temporaryOrderParentId
          });
        }
        if (challengeIds.length) {
          await mongoose.connection.collection('otpchallenges').deleteMany({
            _id: { $in: challengeIds.map((id) => new mongoose.Types.ObjectId(id)) }
          });
        }
        if (targetDatabase.startsWith('feeflow_qa_')) await mongoose.connection.dropDatabase();
      } finally {
        await mongoose.disconnect();
      }
    }
  }
});
