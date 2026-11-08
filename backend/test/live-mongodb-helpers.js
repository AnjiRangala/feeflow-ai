import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { hashPassword } from '../src/lib/auth.js';
import {
  CounsellorTask,
  FeePlan,
  MockPaymentOrder,
  OtpChallenge,
  Payment,
  Refund,
  Reminder,
  RiskAssessment,
  Student,
  User
} from '../src/models/index.js';
import { createApp } from '../src/app.js';

export const models = {
  CounsellorTask,
  FeePlan,
  MockPaymentOrder,
  OtpChallenge,
  Payment,
  Refund,
  Reminder,
  RiskAssessment,
  Student,
  User
};

const modelList = Object.values(models);

export async function startLiveMongoApp() {
  if (!process.env.DEMO_PARENT_PASSWORD || !process.env.DEMO_ACCOUNTS_PASSWORD) {
    throw new Error('Configured demo passwords are unavailable');
  }
  let connectionError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
      connectionError = null;
      break;
    } catch (error) {
      connectionError = error;
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (connectionError) throw connectionError;
  if (mongoose.connection.name !== 'feeflow_ai') {
    await mongoose.disconnect();
    throw new Error('Connected database does not match feeflow_ai');
  }
  await Promise.all(modelList.map((Model) => Model.init()));

  const otpByEmail = new Map();
  const app = createApp({
    config: {
      ...config,
      NODE_ENV: 'development',
      MOCK_PAYMENTS_ENABLED: true,
      AI_SERVICE_URL: 'http://127.0.0.1:8000'
    },
    models: { ...models, connection: mongoose.connection },
    deliverOtp: async () => { throw new Error('External OTP delivery is disabled in this verification'); },
    logOtp: (message) => {
      const match = message.match(/for ([^:]+): (\d{6})$/);
      if (match) otpByEmail.set(match[1].toLowerCase(), match[2]);
    },
    messageProvider: { send: async () => ({ accepted: true, provider: 'mock' }) },
    auditLog: () => {}
  });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const fixtureIds = new Set();
  const fixtureEmails = new Set();

  async function call(path, { method = 'GET', token, body } = {}) {
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
  }

  async function login(email, password) {
    const challenge = await call('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    if (challenge.status !== 202) throw new Error(`Login challenge failed with HTTP ${challenge.status}`);
    const code = otpByEmail.get(email.toLowerCase());
    if (!/^\d{6}$/.test(code ?? '')) throw new Error('Development OTP was not captured in test memory');
    const verification = await call('/auth/verify-otp', {
      method: 'POST',
      body: { challengeId: challenge.payload.challengeId, code }
    });
    if (verification.status !== 200 || typeof verification.payload.accessToken !== 'string') {
      throw new Error(`OTP verification failed with HTTP ${verification.status}`);
    }
    return verification.payload;
  }

  async function createFixture({
    hasCounsellor = false,
    dueDates,
    attendancePercentage = 60,
    testPerformance = [
      { subject: 'Mathematics', score: 76, testDate: new Date('2026-09-10T00:00:00.000Z') },
      { subject: 'Mathematics', score: 66, testDate: new Date('2026-10-10T00:00:00.000Z') }
    ],
    paymentPromises = [
      { status: 'broken', promisedAt: new Date('2026-10-20T00:00:00.000Z'), resolvedAt: new Date('2026-10-25T00:00:00.000Z') }
    ]
  } = {}) {
    const suffix = randomUUID().replaceAll('-', '');
    const studentId = `QA${suffix}`;
    const parentEmail = `qa-parent-${suffix}@invalid.example`;
    const accountsEmail = `qa-accounts-${suffix}@invalid.example`;
    const counsellorEmail = `qa-counsellor-${suffix}@invalid.example`;
    const phone = `+919${suffix.slice(0, 10)}`;
    fixtureIds.add(studentId);
    fixtureEmails.add(parentEmail);
    const passwordHash = await hashPassword(process.env.DEMO_PARENT_PASSWORD);
    const parent = await User.create({
      name: 'QA Parent',
      email: parentEmail,
      phone,
      passwordHash,
      role: 'parent',
      studentId,
      preferredLanguage: 'hi',
      isActive: true
    });
    const accounts = await User.create({
      name: 'QA Accounts Executive',
      email: accountsEmail,
      phone: `+918${suffix.slice(0, 10)}`,
      passwordHash,
      role: 'accounts',
      studentId: null,
      isActive: true
    });
    fixtureEmails.add(accountsEmail);
    let counsellor = null;
    if (hasCounsellor) {
      counsellor = await User.create({
        name: 'QA Counsellor',
        email: counsellorEmail,
        phone: `+917${suffix.slice(0, 10)}`,
        passwordHash,
        role: 'counsellor',
        studentId: null,
        isActive: true
      });
      fixtureEmails.add(counsellorEmail);
    }

    await Student.create({
      studentId,
      name: 'QA Demo Student',
      batch: 'QA Integration',
      centre: 'QA Centre',
      parentPhone: phone,
      parentEmail,
      attendancePercentage,
      testPerformance,
      paymentPromises,
      isActive: true
    });
    const dates = dueDates ?? ['2027-01-10', '2027-02-10', '2027-03-10'];
    const installments = dates.map((date, index) => ({
      installmentNumber: index + 1,
      dueDate: new Date(`${date}T00:00:00.000Z`),
      amountPaise: 100_000,
      paidAmountPaise: 0,
      status: 'upcoming',
      payments: []
    }));
    await FeePlan.create({
      studentId,
      totalFeePaise: 300_000,
      discountPaise: 0,
      netFeePaise: 300_000,
      numberOfInstallments: 3,
      installments
    });
    return { studentId, parentEmail, accountsEmail, counsellorEmail, parent, accounts, counsellor };
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    const emails = [...fixtureEmails];
    const studentIds = [...fixtureIds];
    let cleaned = {};
    try {
      const users = await User.find({ email: { $in: emails } }).select('_id').lean();
      const userIds = users.map(({ _id }) => _id);
      const results = await Promise.all([
        userIds.length
          ? OtpChallenge.deleteMany({ userId: { $in: userIds } })
          : Promise.resolve({ deletedCount: 0 }),
        Student.deleteMany({ studentId: { $in: studentIds } }),
        FeePlan.deleteMany({ studentId: { $in: studentIds } }),
        Payment.deleteMany({ studentId: { $in: studentIds } }),
        MockPaymentOrder.deleteMany({
          studentId: { $in: studentIds },
          ...(userIds.length ? { parentUserId: { $in: userIds.map(String) } } : {})
        }),
        Reminder.deleteMany({ studentId: { $in: studentIds } }),
        Refund.deleteMany({ studentId: { $in: studentIds } }),
        CounsellorTask.deleteMany({ studentId: { $in: studentIds } }),
        RiskAssessment.deleteMany({ studentId: { $in: studentIds } }),
        User.deleteMany({ email: { $in: emails } })
      ]);
      cleaned = {
        otpChallenges: results[0].deletedCount,
        students: results[1].deletedCount,
        feePlans: results[2].deletedCount,
        payments: results[3].deletedCount,
        paymentOrders: results[4].deletedCount,
        reminders: results[5].deletedCount,
        refunds: results[6].deletedCount,
        counsellorTasks: results[7].deletedCount,
        riskAssessments: results[8].deletedCount,
        users: results[9].deletedCount
      };
    } finally {
      await mongoose.disconnect();
    }
    return cleaned;
  }

  return { call, close, createFixture, login };
}
