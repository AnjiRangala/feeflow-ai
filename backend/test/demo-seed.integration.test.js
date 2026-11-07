import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import test from 'node:test';
import { config } from '../src/config/env.js';
import {
  DEMO_SEED_KEY,
  demoAccountsUser,
  demoCounsellorUser,
  demoParents,
  demoStudents
} from '../src/demo-seed-data.js';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/auth.js';

const enabled = process.env.RUN_CONFIGURED_MONGO_SEED_TESTS === 'true';
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function snapshotExistingRecords(models) {
  const studentIds = demoStudents.map(({ studentId }) => studentId);
  const userEmails = [
    ...demoParents.map(({ email }) => email),
    demoAccountsUser.email,
    ...(process.env.DEMO_COUNSELLOR_PASSWORD ? [demoCounsellorUser.email] : [])
  ];
  const transactionIds = demoStudents.flatMap((student) => student.installments.flatMap((installment, index) =>
    installment.paidAmountPaise ? [`DEMO-${student.studentId}-${index + 1}`] : []
  ));
  const records = await Promise.all([
    models.User.find({ email: { $in: userEmails } }).select('-passwordHash').sort({ _id: 1 }).lean(),
    models.Student.find({ studentId: { $in: studentIds } }).sort({ _id: 1 }).lean(),
    models.FeePlan.find({ studentId: { $in: studentIds } }).sort({ _id: 1 }).lean(),
    models.Payment.find({ transactionId: { $in: transactionIds } }).sort({ _id: 1 }).lean()
  ]);
  return records.map((collection) => ({
    ids: collection.map(({ _id }) => _id),
    digest: digest(collection)
  }));
}

async function assertExistingRecordsUnchanged(models, snapshot) {
  const filters = [
    { _id: { $in: snapshot[0].ids } },
    { _id: { $in: snapshot[1].ids } },
    { _id: { $in: snapshot[2].ids } },
    { _id: { $in: snapshot[3].ids } }
  ];
  const collections = [models.User, models.Student, models.FeePlan, models.Payment];
  const records = await Promise.all(collections.map((Model, index) =>
    Model.find(filters[index])
      .select(index === 0 ? '-passwordHash' : undefined)
      .sort({ _id: 1 })
      .lean()
  ));
  for (let index = 0; index < records.length; index += 1) {
    assert.equal(records[index].length, snapshot[index].ids.length, 'A pre-existing record was removed');
    assert.equal(digest(records[index]), snapshot[index].digest, 'A pre-existing record was modified');
  }
}

function runSeed() {
  const result = spawnSync(process.execPath, ['src/seed.js'], {
    cwd: backendDirectory,
    env: process.env,
    encoding: 'utf8',
    timeout: 120_000
  });
  assert.equal(result.error, undefined, 'The seed process could not be started');
  assert.equal(result.status, 0, 'The demo seed process failed; inspect its sanitized diagnostic');
  return result.stdout;
}

test('configured MongoDB demo seed is safe and idempotent and demo roles are isolated', {
  skip: !enabled && 'Set RUN_CONFIGURED_MONGO_SEED_TESTS=true to seed and verify the configured MongoDB database'
}, async (t) => {
  if (!process.env.DEMO_PARENT_PASSWORD || !process.env.DEMO_ACCOUNTS_PASSWORD) {
    t.skip('Demo password variables are unavailable');
    return;
  }

  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  const models = await import('../src/models/index.js');
  const previousRecords = await snapshotExistingRecords(models);
  let server;
  const challengeIds = [];
  const capturedOtp = new Map();
  try {
    runSeed();
    const firstSeedRecords = await snapshotExistingRecords(models);
    await assertExistingRecordsUnchanged(models, previousRecords);
    runSeed();
    const secondSeedRecords = await snapshotExistingRecords(models);
    await assertExistingRecordsUnchanged(models, previousRecords);
    assert.deepEqual(
      secondSeedRecords.map(({ digest: value }) => value),
      firstSeedRecords.map(({ digest: value }) => value),
      'A second seed run changed the seeded records'
    );
    const workflowFixtureCounts = async () => ({
      reminders: await models.Reminder.countDocuments({
        demoSeedKey: `${DEMO_SEED_KEY}:reminder:STU-0773:2`
      }),
      refunds: await models.Refund.countDocuments({
        demoSeedKey: `${DEMO_SEED_KEY}:refund:STU-0412`
      }),
      riskTasks: await models.CounsellorTask.countDocuments({
        demoSeedKey: `${DEMO_SEED_KEY}:risk:STU-0773`
      })
    });
    const fixtureCounts = await workflowFixtureCounts();
    assert.equal(fixtureCounts.reminders, 1);
    assert.equal(fixtureCounts.refunds, 1);
    assert.ok(fixtureCounts.riskTasks <= 1, 'The seed created duplicate demo risk tasks');

    const userEmails = [
      ...demoParents.map(({ email }) => email),
      demoAccountsUser.email,
      ...(process.env.DEMO_COUNSELLOR_PASSWORD ? [demoCounsellorUser.email] : [])
    ];
    const studentIds = demoStudents.map(({ studentId }) => studentId);
    const expectedPaymentIds = demoStudents.flatMap((student) => student.installments.flatMap((installment, index) =>
      installment.paidAmountPaise ? [`DEMO-${student.studentId}-${index + 1}`] : []
    ));
    assert.equal(await models.User.countDocuments({ email: { $in: userEmails } }), userEmails.length);
    assert.equal(await models.Student.countDocuments({ studentId: { $in: studentIds } }), studentIds.length);
    assert.equal(await models.FeePlan.countDocuments({ studentId: { $in: studentIds } }), studentIds.length);
    assert.equal(await models.Payment.countDocuments({ transactionId: { $in: expectedPaymentIds } }), 2);
    for (const email of userEmails) {
      assert.equal(await models.User.countDocuments({ email }), 1);
    }
    for (const studentId of studentIds) {
      assert.equal(await models.Student.countDocuments({ studentId }), 1);
      assert.equal(await models.FeePlan.countDocuments({ studentId }), 1);
    }
    for (const transactionId of expectedPaymentIds) {
      assert.equal(await models.Payment.countDocuments({ transactionId }), 1);
    }

    const app = createApp({
      config: { ...config, NODE_ENV: 'development' },
      models: { ...models, connection: mongoose.connection },
      deliverOtp: async () => { throw new Error('OTP delivery is disabled during this local verification'); },
      logOtp: (message) => {
        const match = message.match(/FeeFlow AI development OTP for ([^:]+): (\d{6})$/);
        if (match) capturedOtp.set(match[1].toLowerCase(), match[2]);
      }
    });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, { method = 'GET', token, body } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : await response.text();
      return { status: response.status, payload };
    };
    const login = async (email, password) => {
      const challenge = await request('/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      assert.equal(challenge.status, 202, 'Demo role login did not issue an OTP');
      challengeIds.push(challenge.payload.challengeId);
      const code = capturedOtp.get(email);
      assert.match(code ?? '', /^\d{6}$/, 'Development OTP was not captured in test memory');
      const verification = await request('/auth/verify-otp', {
        method: 'POST',
        body: { challengeId: challenge.payload.challengeId, code }
      });
      assert.equal(verification.status, 200, 'Demo role OTP verification failed');
      assert.equal(typeof verification.payload.accessToken, 'string', 'Authentication did not return a JWT');
      return verification.payload;
    };

    const parentA = await login(demoParents[0].email, process.env.DEMO_PARENT_PASSWORD);
    const parentB = await login(demoParents[1].email, process.env.DEMO_PARENT_PASSWORD);
    const accounts = await login(demoAccountsUser.email, process.env.DEMO_ACCOUNTS_PASSWORD);
    const counsellor = process.env.DEMO_COUNSELLOR_PASSWORD
      ? await login(demoCounsellorUser.email, process.env.DEMO_COUNSELLOR_PASSWORD)
      : null;
    assert.equal(parentA.user.role, 'parent');
    assert.equal(parentA.user.studentId, demoParents[0].studentId);
    assert.equal('demoSeedKey' in parentA.user, false);
    assert.equal(parentB.user.role, 'parent');
    assert.equal(parentB.user.studentId, demoParents[1].studentId);
    assert.equal(accounts.user.role, 'accounts');
    if (counsellor) assert.equal(counsellor.user.role, 'counsellor');
    assert.equal('demoSeedKey' in accounts.user, false);

    const parentAStudentId = demoParents[0].studentId;
    const parentBStudentId = demoParents[1].studentId;
    const parentAStudents = await request('/fees/students', { token: parentA.accessToken });
    const parentBStudents = await request('/fees/students', { token: parentB.accessToken });
    assert.equal(parentAStudents.status, 200);
    assert.deepEqual(parentAStudents.payload.students.map(({ student }) => student.studentId), [parentAStudentId]);
    assert.deepEqual(parentBStudents.payload.students.map(({ student }) => student.studentId), [parentBStudentId]);

    const ownLedger = await request(`/fees/student/${parentAStudentId}`, { token: parentA.accessToken });
    assert.equal(ownLedger.status, 200);
    assert.equal(ownLedger.payload.student.student.studentId, parentAStudentId);
    assert.equal('demoSeedKey' in ownLedger.payload.student.student, false);
    assert.equal('demoSeedKey' in ownLedger.payload.student.feePlan, false);
    const otherLedger = await request(`/fees/student/${parentBStudentId}`, { token: parentA.accessToken });
    assert.equal(otherLedger.status, 403);
    assert.equal((await request('/auth/me', { token: parentA.accessToken })).payload.user.role, 'parent');
    assert.equal((await request('/auth/me')).status, 401);

    const parentBPayment = await models.Payment.findOne({
      studentId: parentBStudentId,
      status: 'completed'
    }).select('_id').lean();
    assert.ok(parentBPayment, 'The second parent demo student has no payment record');
    const otherReceipt = await request(`/parent-payments/receipts/${parentBPayment._id}`, {
      token: parentA.accessToken
    });
    assert.equal(otherReceipt.status, 404);
    const ownPayment = await models.Payment.findOne({
      studentId: parentAStudentId,
      status: 'completed'
    }).select('_id').lean();
    assert.ok(ownPayment, 'The first parent demo student has no payment record');
    assert.equal((await request(`/parent-payments/receipts/${ownPayment._id}`, {
      token: parentA.accessToken
    })).status, 200);

    assert.equal((await request('/parent-payments/orders', {
      method: 'POST',
      token: parentA.accessToken,
      body: { installmentNumber: 1, studentId: parentBStudentId }
    })).status, 400);
    assert.equal((await request('/payments/record', {
      method: 'POST',
      token: parentA.accessToken,
      body: {
        studentId: parentBStudentId,
        installmentNumber: 1,
        amountPaise: 1,
        transactionId: 'DEMO-PARENT-ISOLATION-TEST',
        paymentMethod: 'upi'
      }
    })).status, 403);

    const accountsStudents = await request('/fees/students', { token: accounts.accessToken });
    assert.equal(accountsStudents.status, 200);
    assert.equal(accountsStudents.payload.students.length, demoStudents.length);
    const summary = await request('/fees/summary', { token: accounts.accessToken });
    assert.equal(summary.status, 200);
    assert.ok(summary.payload.summary.totalFeesBilledPaise > 0);

    for (const ledgerResponse of [ownLedger]) {
      const ledger = ledgerResponse.payload.student;
      const installmentPaid = ledger.feePlan.installments.reduce((total, item) => total + item.paidAmountPaise, 0);
      const installmentOutstanding = ledger.feePlan.installments
        .reduce((total, item) => total + item.outstandingPaise, 0);
      assert.equal(ledger.amountPaidPaise, installmentPaid);
      assert.equal(ledger.remainingBalancePaise, installmentOutstanding);
      assert.equal(ledger.amountPaidPaise + ledger.remainingBalancePaise, ledger.feePlan.netFeePaise);
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (challengeIds.length) {
      await models.OtpChallenge.deleteMany({
        _id: { $in: challengeIds.map((id) => new mongoose.Types.ObjectId(id)) }
      });
    }
    await mongoose.disconnect();
  }
});
