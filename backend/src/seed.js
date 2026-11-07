import mongoose from 'mongoose';
import { connectDatabase } from './config/database.js';
import { config } from './config/env.js';
import {
  createDemoFeePlanData,
  demoAccountsUser,
  demoCounsellorUser,
  demoParents,
  demoStudents,
  DEMO_SEED_KEY
} from './demo-seed-data.js';
import { comparePassword, hashPassword } from './lib/auth.js';
import {
  CounsellorTask,
  FeePlan,
  Payment,
  Refund,
  Reminder,
  Student,
  User
} from './models/index.js';
import { calculateProRataRefund } from './services/refunds.js';
import { formatReminderMessage } from './services/reminders.js';
import { getRiskFeatures } from './services/student-risk.js';

function assertDemoPassword(name, value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new Error(`${name} must be set in .env and contain 12 to 128 characters`);
  }
}

function assertSeedOwned(record, label) {
  if (record.demoSeedKey !== DEMO_SEED_KEY &&
      !record.demoSeedKey?.startsWith(`${DEMO_SEED_KEY}:`)) {
    throw new Error(`An unmarked ${label} already uses a demo identifier; it was left unchanged`);
  }
}

function assertStudentIdentity(record, student) {
  assertSeedOwned(record, 'student');
  if (record.studentId !== student.studentId ||
      record.parentEmail !== student.parentEmail ||
      record.parentPhone !== student.parentPhone ||
      record.batch !== student.batch) {
    throw new Error('A seed-managed student no longer matches the demo identity; it was left unchanged');
  }
}

function assertUserIdentity(record, expected) {
  assertSeedOwned(record, 'user');
  if (record.email !== expected.email ||
      record.role !== expected.role ||
      (record.studentId ?? null) !== expected.studentId ||
      record.isActive !== true) {
    throw new Error('A seed-managed user no longer matches the demo identity; it was left unchanged');
  }
}

function assertFeePlanIdentity(record, expected) {
  assertSeedOwned(record, 'fee plan');
  const expectedInstallments = expected.installments;
  const sameInstallments = record.installments.length === expectedInstallments.length &&
    expectedInstallments.every((expectedInstallment) => {
      const actual = record.installments.find(
        ({ installmentNumber }) => installmentNumber === expectedInstallment.installmentNumber
      );
      return actual &&
        new Date(actual.dueDate).getTime() === expectedInstallment.dueDate.getTime() &&
        actual.amountPaise === expectedInstallment.amountPaise;
    });
  if (record.studentId !== expected.studentId ||
      record.totalFeePaise !== expected.totalFeePaise ||
      record.discountPaise !== expected.discountPaise ||
      record.netFeePaise !== expected.netFeePaise ||
      record.numberOfInstallments !== expected.numberOfInstallments ||
      !sameInstallments) {
    throw new Error('A seed-managed fee plan no longer matches the demo plan; it was left unchanged');
  }
}

function assertPaymentIdentity(record, expected) {
  assertSeedOwned(record, 'payment transaction');
  if (record.studentId !== expected.studentId ||
      record.installmentId.toString() !== expected.installmentId.toString() ||
      record.amountPaise !== expected.amountPaise ||
      record.transactionId !== expected.transactionId ||
      record.paymentMethod !== expected.paymentMethod ||
      record.status !== expected.status ||
      new Date(record.paidAt).getTime() !== expected.paidAt.getTime()) {
    throw new Error('A seed payment identifier is already in use by a different transaction; it was left unchanged');
  }
}

function assertReminderIdentity(record, expected) {
  assertSeedOwned(record, 'reminder');
  if (record.studentId !== expected.studentId ||
      record.installmentId.toString() !== expected.installmentId.toString() ||
      record.idempotencyKey !== expected.idempotencyKey ||
      record.scheduleOffsetDays !== expected.scheduleOffsetDays ||
      !['scheduled', 'sending', 'sent', 'failed', 'cancelled'].includes(record.status)) {
    throw new Error('The seed-managed reminder no longer matches the demo schedule; it was left unchanged');
  }
}

function assertRefundIdentity(record, expected) {
  assertSeedOwned(record, 'refund');
  if (record.studentId !== expected.studentId ||
      record.refundAmountPaise !== expected.refundAmountPaise ||
      record.policyInputs.policyVersion !== expected.policyInputs.policyVersion ||
      !['pending_review', 'approved', 'rejected'].includes(record.status)) {
    throw new Error('The seed-managed refund no longer matches the demo calculation; it was left unchanged');
  }
}

function assertCounsellorTaskIdentity(record, expected) {
  assertSeedOwned(record, 'counsellor task');
  if (record.studentId !== expected.studentId ||
      record.riskScore !== expected.riskScore ||
      record.assessmentMethod !== expected.assessmentMethod ||
      record.modelVersion !== expected.modelVersion) {
    throw new Error('The seed-managed risk task no longer matches the demo assessment; it was left unchanged');
  }
}

async function insertOnly(Model, identity, data, select, assertCompatible, label) {
  await new Model(data).validate();
  const existing = await Model.findOne(identity).select(select).lean();
  if (existing) {
    assertCompatible(existing);
    return { record: existing, created: false };
  }

  let result;
  try {
    result = await Model.updateOne(
      identity,
      { $setOnInsert: data },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    result = { upsertedCount: 0 };
  }

  const record = await Model.findOne(identity).select(select).lean();
  if (!record) throw new Error(`Unable to create the demo ${label}`);
  assertCompatible(record);
  return { record, created: result.upsertedCount === 1 };
}

async function seedDemoWorkflowExamples(accountsUser, created) {
  const riskStudent = demoStudents.find(({ studentId }) => studentId === 'STU-0773');
  const reminderPlan = await FeePlan.findOne({ studentId: riskStudent.studentId }).lean();
  const reminderInstallment = reminderPlan.installments.find(({ installmentNumber }) => installmentNumber === 2);
  const reminderDueDate = new Date(reminderInstallment.dueDate);
  const reminderScheduledAt = new Date(reminderDueDate.getTime() - 3 * 24 * 60 * 60 * 1000);
  const outstandingAmountPaise = reminderInstallment.amountPaise - reminderInstallment.paidAmountPaise;
  const reminder = {
    demoSeedKey: `${DEMO_SEED_KEY}:reminder:${riskStudent.studentId}:2`,
    studentId: riskStudent.studentId,
    studentName: riskStudent.name,
    recipient: riskStudent.parentPhone,
    installmentId: reminderInstallment._id,
    installmentNumber: reminderInstallment.installmentNumber,
    scheduleOffsetDays: 3,
    idempotencyKey: `${reminderInstallment._id.toString()}:${reminderDueDate.getTime()}:3`,
    scheduledAt: reminderScheduledAt,
    language: 'en',
    message: formatReminderMessage({
      language: 'en',
      remainingAmountPaise: outstandingAmountPaise,
      dueDate: reminderDueDate
    }),
    outstandingAmountPaise,
    status: 'scheduled',
    provider: 'mock'
  };
  const reminderResult = await insertOnly(
    Reminder,
    { demoSeedKey: reminder.demoSeedKey },
    reminder,
    '+demoSeedKey',
    (record) => assertReminderIdentity(record, reminder),
    'reminder'
  );
  if (reminderResult.created) created.reminders += 1;

  const refundStudent = demoStudents.find(({ studentId }) => studentId === 'STU-0412');
  const refundPlan = await FeePlan.findOne({ studentId: refundStudent.studentId }).lean();
  const amountPaidPaise = refundPlan.installments.reduce((total, item) => total + item.paidAmountPaise, 0);
  const policyInputs = {
    courseStartDate: new Date('2026-07-01T00:00:00.000Z'),
    withdrawalDate: new Date('2026-08-01T00:00:00.000Z'),
    totalCourseDurationDays: 180,
    totalCourseFeePaise: refundPlan.totalFeePaise,
    netCourseFeePaise: refundPlan.netFeePaise,
    amountPaidPaise,
    nonRefundableChargesPaise: 25_000,
    policyVersion: config.REFUND_POLICY_VERSION,
    financialInputsSource: 'fee_ledger'
  };
  const calculationDetails = calculateProRataRefund({
    courseStartDate: '2026-07-01',
    withdrawalDate: '2026-08-01',
    totalCourseDurationDays: policyInputs.totalCourseDurationDays,
    netCourseFeePaise: policyInputs.netCourseFeePaise,
    amountPaidPaise,
    nonRefundableChargesPaise: policyInputs.nonRefundableChargesPaise,
    policyVersion: policyInputs.policyVersion
  });
  const refund = {
    demoSeedKey: `${DEMO_SEED_KEY}:refund:${refundStudent.studentId}`,
    studentId: refundStudent.studentId,
    studentName: refundStudent.name,
    policyInputs,
    calculationDetails,
    refundAmountPaise: calculationDetails.refundableAmountPaise,
    status: 'pending_review',
    createdBy: accountsUser._id
  };
  const refundResult = await insertOnly(
    Refund,
    { demoSeedKey: refund.demoSeedKey },
    refund,
    '+demoSeedKey',
    (record) => assertRefundIdentity(record, refund),
    'refund'
  );
  if (refundResult.created) created.refunds += 1;

  const existingRiskTask = await CounsellorTask.findOne({
    studentId: riskStudent.studentId,
    status: { $in: ['open', 'in_progress'] }
  }).lean();
  if (existingRiskTask) {
    created.riskTasksSkippedExisting += 1;
    return;
  }

  let health;
  try {
    health = await fetch(`${config.AI_SERVICE_URL.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(config.AI_SERVICE_TIMEOUT_MS)
    });
  } catch {
    created.riskTasksSkippedUnavailable += 1;
    return;
  }
  if (!health.ok) {
    created.riskTasksSkippedUnavailable += 1;
    return;
  }
  const healthBody = await health.json();
  if (healthBody.predictionMethod !== 'explainable_rules_baseline') {
    throw new Error('Configured local risk service did not identify the expected explainable rules baseline');
  }

  const features = getRiskFeatures(
    await Student.findOne({ studentId: riskStudent.studentId }).lean(),
    reminderPlan,
    new Date()
  );
  const response = await fetch(`${config.AI_SERVICE_URL.replace(/\/+$/, '')}/predict-risk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(features),
    signal: AbortSignal.timeout(config.AI_SERVICE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Local risk service rejected the demo assessment (HTTP ${response.status})`);
  const assessment = await response.json();
  if (assessment.studentId !== riskStudent.studentId ||
      assessment.assessmentMethod !== 'explainable_rules_baseline' ||
      !Number.isSafeInteger(assessment.riskScore) || assessment.riskScore < 30) {
    throw new Error('Demo risk student did not produce the expected human-review assessment');
  }

  const task = {
    demoSeedKey: `${DEMO_SEED_KEY}:risk:${riskStudent.studentId}`,
    studentId: riskStudent.studentId,
    studentName: riskStudent.name,
    riskLevel: assessment.riskLevel,
    riskScore: assessment.riskScore,
    reasons: assessment.reasons,
    scoreBreakdown: assessment.scoreBreakdown,
    features,
    missingFeatures: assessment.missingFeatures,
    recommendedAction: assessment.recommendedAction,
    assessmentMethod: assessment.assessmentMethod,
    modelVersion: assessment.modelVersion,
    status: 'open',
    createdBy: accountsUser._id,
    openTaskStudentId: riskStudent.studentId
  };
  const taskResult = await insertOnly(
    CounsellorTask,
    { demoSeedKey: task.demoSeedKey },
    task,
    '+demoSeedKey',
    (record) => assertCounsellorTaskIdentity(record, task),
    'counsellor task'
  );
  if (taskResult.created) created.riskTasks += 1;
}

function sanitizedErrorMessage(error) {
  return String(error.message ?? 'Unknown error')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB URI redacted]')
    .replace(/\b(password|passwd|secret|token)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]');
}

async function seed() {
  assertDemoPassword('DEMO_PARENT_PASSWORD', process.env.DEMO_PARENT_PASSWORD);
  assertDemoPassword('DEMO_ACCOUNTS_PASSWORD', process.env.DEMO_ACCOUNTS_PASSWORD);
  await connectDatabase(config.MONGO_URI);
  await Promise.all([
    User.init(), Student.init(), FeePlan.init(), Payment.init(),
    Reminder.init(), Refund.init(), CounsellorTask.init()
  ]);

  const created = {
    users: 0,
    students: 0,
    feePlans: 0,
    payments: 0,
    reminders: 0,
    refunds: 0,
    riskTasks: 0,
    riskTasksSkippedExisting: 0,
    riskTasksSkippedUnavailable: 0
  };
  const parentPasswordHash = await hashPassword(process.env.DEMO_PARENT_PASSWORD);
  const accountsPasswordHash = await hashPassword(process.env.DEMO_ACCOUNTS_PASSWORD);

  for (const student of demoStudents) {
    const {
      installments: _installments,
      totalFeePaise: _totalFeePaise,
      discountPaise: _discountPaise,
      ...studentData
    } = student;
    studentData.demoSeedKey = DEMO_SEED_KEY;
    const result = await insertOnly(
      Student,
      { studentId: student.studentId },
      studentData,
      '+demoSeedKey',
      (record) => assertStudentIdentity(record, student),
      'student'
    );
    if (result.created) created.students += 1;
  }

  for (const parent of demoParents) {
    const student = demoStudents.find(({ studentId }) => studentId === parent.studentId);
    const user = {
      name: `${student.name} Parent`,
      email: parent.email,
      phone: student.parentPhone,
      passwordHash: parentPasswordHash,
      role: 'parent',
      studentId: parent.studentId,
      demoSeedKey: DEMO_SEED_KEY,
      isActive: true
    };
    const result = await insertOnly(
      User,
      { email: user.email },
      user,
      '+passwordHash +demoSeedKey',
      (record) => assertUserIdentity(record, user),
      'user'
    );
    if (!(await comparePassword(process.env.DEMO_PARENT_PASSWORD, result.record.passwordHash))) {
      throw new Error('The seed-managed parent account password differs from DEMO_PARENT_PASSWORD; account left unchanged');
    }
    if (result.created) created.users += 1;
  }

  const accountsUser = {
    name: 'FeeFlow Accounts Executive',
    email: demoAccountsUser.email,
    phone: '+919000000140',
    passwordHash: accountsPasswordHash,
    role: demoAccountsUser.role,
    studentId: demoAccountsUser.studentId,
    demoSeedKey: DEMO_SEED_KEY,
    isActive: true
  };
  const accountsResult = await insertOnly(
    User,
    { email: accountsUser.email },
    accountsUser,
    '+passwordHash +demoSeedKey',
    (record) => assertUserIdentity(record, accountsUser),
    'user'
  );
  if (!(await comparePassword(process.env.DEMO_ACCOUNTS_PASSWORD, accountsResult.record.passwordHash))) {
    throw new Error('The seed-managed accounts password differs from DEMO_ACCOUNTS_PASSWORD; account left unchanged');
  }
  if (accountsResult.created) created.users += 1;

  if (process.env.DEMO_COUNSELLOR_PASSWORD) {
    assertDemoPassword('DEMO_COUNSELLOR_PASSWORD', process.env.DEMO_COUNSELLOR_PASSWORD);
    const counsellorUser = {
      name: 'FeeFlow Counsellor',
      email: demoCounsellorUser.email,
      phone: '+919000000141',
      passwordHash: await hashPassword(process.env.DEMO_COUNSELLOR_PASSWORD),
      role: demoCounsellorUser.role,
      studentId: demoCounsellorUser.studentId,
      demoSeedKey: DEMO_SEED_KEY,
      isActive: true
    };
    const counsellorResult = await insertOnly(
      User,
      { email: counsellorUser.email },
      counsellorUser,
      '+passwordHash +demoSeedKey',
      (record) => assertUserIdentity(record, counsellorUser),
      'user'
    );
    if (!(await comparePassword(process.env.DEMO_COUNSELLOR_PASSWORD, counsellorResult.record.passwordHash))) {
      throw new Error('The seed-managed counsellor password differs from DEMO_COUNSELLOR_PASSWORD; account left unchanged');
    }
    if (counsellorResult.created) created.users += 1;
  }

  for (const student of demoStudents) {
    const expectedPlan = createDemoFeePlanData(student);
    const planResult = await insertOnly(
      FeePlan,
      { studentId: student.studentId },
      expectedPlan,
      '+demoSeedKey',
      (record) => assertFeePlanIdentity(record, expectedPlan),
      'fee plan'
    );
    if (planResult.created) created.feePlans += 1;

    const plan = planResult.record;
    for (const installment of student.installments) {
      if (!installment.paidAmountPaise) continue;
      const planInstallment = plan.installments.find(
        (entry) => entry.installmentNumber === student.installments.indexOf(installment) + 1
      );
      if (!planInstallment) throw new Error('A seeded fee plan is missing an expected instalment');
      const transaction = {
        demoSeedKey: DEMO_SEED_KEY,
        studentId: student.studentId,
        installmentId: planInstallment._id,
        amountPaise: installment.paidAmountPaise,
        transactionId: `DEMO-${student.studentId}-${student.installments.indexOf(installment) + 1}`,
        paymentMethod: 'upi',
        status: 'completed',
        paidAt: new Date('2026-10-05T10:00:00.000Z')
      };
      const paymentResult = await insertOnly(
        Payment,
        { transactionId: transaction.transactionId },
        transaction,
        '+demoSeedKey',
        (record) => assertPaymentIdentity(record, transaction),
        'payment'
      );
      if (paymentResult.created) created.payments += 1;

      const alreadyLinked = planInstallment.payments.some(
        (paymentId) => paymentId.toString() === paymentResult.record._id.toString()
      );
      if (!alreadyLinked) {
        const linked = await FeePlan.updateOne(
          {
            _id: plan._id,
            installments: { $elemMatch: { _id: planInstallment._id } }
          },
          { $addToSet: { 'installments.$.payments': paymentResult.record._id } },
          { runValidators: true }
        );
        if (linked.matchedCount !== 1) throw new Error('Unable to link a demo payment to its fee instalment');
      }
    }
  }

  await seedDemoWorkflowExamples(accountsResult.record, created);
  return created;
}

try {
  const created = await seed();
  console.info(
    `Demo seed complete. Created ${created.users} users, ${created.students} students, ` +
    `${created.feePlans} fee plans, ${created.payments} payments, ${created.reminders} reminders, ` +
    `${created.refunds} refund examples, and ${created.riskTasks} counsellor risk tasks. Existing records were preserved.`
  );
  if (created.riskTasksSkippedUnavailable) {
    console.warn('Demo risk task was not seeded because the local AI service was unavailable; start it and rerun the insert-only seed.');
  } else if (created.riskTasksSkippedExisting) {
    console.info('An existing open counsellor task was preserved; no duplicate demo risk task was created.');
  }
} catch (error) {
  const errorCode = Number.isInteger(error.code) ? ` (code ${error.code})` : '';
  console.error(`Unable to seed FeeFlow AI: ${error.name ?? 'Error'}${errorCode}: ${sanitizedErrorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await mongoose.connection.close();
}
