import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/lib/errors.js';
import {
  buildInstallments,
  calculateNetFee,
  getDaysOverdue,
  getInstallmentStatus,
  rupeesToPaise
} from '../src/lib/fee-ledger.js';
import { recordPayment, summarizeLedgers } from '../src/services/fee-ledger.js';
import { FeePlan } from '../src/models/fee-plan.js';
import { parsePaise, studentLedgerStatus } from '../../frontend/src/lib/money.js';

const today = new Date('2026-11-03T12:00:00.000Z');

function createPlan({ amountPaise = 10000, paidAmountPaise = 0, dueDate = '2027-01-01' } = {}) {
  return {
    studentId: 'STU-1',
    totalFeePaise: amountPaise,
    discountPaise: 0,
    netFeePaise: amountPaise,
    numberOfInstallments: 3,
    installments: [{
      _id: 'installment-1',
      installmentNumber: 1,
      dueDate: new Date(`${dueDate}T00:00:00.000Z`),
      amountPaise,
      paidAmountPaise,
      status: 'upcoming',
      payments: []
    }],
    save: async () => {}
  };
}

function paymentHarness(plan, existingPayments = []) {
  const payments = [...existingPayments];
  const session = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {}
  };
  class Payment {
    constructor(data) { Object.assign(this, data, { _id: `payment-${payments.length + 1}` }); }
    async save() { payments.push(this); }
    static findOne(query) {
      return { session: async () => payments.find(({ transactionId }) => transactionId === query.transactionId) ?? null };
    }
  }
  const models = {
    Student: {
      findOne: () => ({ session: async () => ({ studentId: 'STU-1' }) })
    },
    FeePlan: {
      findOne: () => ({ session: async () => plan })
    },
    Payment,
    connection: { startSession: async () => session }
  };
  return { models, payments };
}

const paymentInput = (overrides = {}) => ({
  studentId: 'STU-1',
  installmentNumber: 1,
  amountPaise: 10000,
  transactionId: 'TX-1',
  paymentMethod: 'upi',
  ...overrides
});

test('full payment marks an instalment paid and records its transaction', async () => {
  const plan = createPlan();
  const { models, payments } = paymentHarness(plan);
  const payment = await recordPayment(models, paymentInput());
  assert.equal(plan.installments[0].paidAmountPaise, 10000);
  assert.equal(plan.installments[0].status, 'paid');
  assert.equal(payment.amountPaise, 10000);
  assert.equal(payments.length, 1);
});

test('partial payment preserves the balance and marks the instalment partially paid', async () => {
  const plan = createPlan();
  const { models, payments } = paymentHarness(plan);
  await recordPayment(models, paymentInput({ amountPaise: 3500 }));
  assert.equal(plan.installments[0].paidAmountPaise, 3500);
  assert.equal(plan.installments[0].status, 'partially_paid');
  assert.equal(payments.length, 1);
});

test('multiple partial payments accumulate exactly to the instalment amount', async () => {
  const plan = createPlan();
  const { models, payments } = paymentHarness(plan);
  await recordPayment(models, paymentInput({ amountPaise: 2500, transactionId: 'TX-1' }));
  await recordPayment(models, paymentInput({ amountPaise: 7500, transactionId: 'TX-2' }));
  assert.equal(plan.installments[0].paidAmountPaise, 10000);
  assert.equal(plan.installments[0].status, 'paid');
  assert.equal(payments.length, 2);
});

test('overpayment is rejected without changing the instalment or history', async () => {
  const plan = createPlan({ paidAmountPaise: 8000 });
  const { models, payments } = paymentHarness(plan);
  await assert.rejects(recordPayment(models, paymentInput({ amountPaise: 2001 })), (error) => error.status === 400);
  assert.equal(plan.installments[0].paidAmountPaise, 8000);
  assert.equal(payments.length, 0);
});

test('discount calculation uses integer paise and standard plans split remainders exactly', () => {
  assert.equal(rupeesToPaise('1200.05', 'Total fee'), 120005);
  assert.throws(() => rupeesToPaise('1.005', 'Total fee'), AppError);
  assert.equal(calculateNetFee(120001, 10001), 110000);
  const { netFeePaise, installments } = buildInstallments({
    totalFeePaise: 10001,
    discountPaise: 1,
    dueDates: ['2027-01-01', '2027-02-01', '2027-03-01']
  });
  assert.equal(netFeePaise, 10000);
  assert.deepEqual(installments.map(({ amountPaise }) => amountPaise), [3334, 3333, 3333]);
  const fourPartPlan = buildInstallments({
    totalFeePaise: 10000,
    dueDates: ['2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01']
  });
  assert.deepEqual(fourPartPlan.installments.map(({ amountPaise }) => amountPaise), [2500, 2500, 2500, 2500]);
});

test('overdue partial balances report overdue days and paid instalments are never overdue', () => {
  const unpaid = { amountPaise: 5000, paidAmountPaise: 0, dueDate: new Date('2026-10-31T00:00:00.000Z') };
  assert.equal(getInstallmentStatus(unpaid, today), 'overdue');
  assert.equal(getDaysOverdue(unpaid, today), 3);
  const partiallyPaidOverdue = { ...unpaid, paidAmountPaise: 100 };
  assert.equal(getInstallmentStatus(partiallyPaidOverdue, today), 'overdue');
  assert.equal(getDaysOverdue(partiallyPaidOverdue, today), 3);
  assert.equal(getInstallmentStatus({ ...partiallyPaidOverdue, paidAmountPaise: 5000 }, today), 'paid');
  assert.equal(getDaysOverdue({ ...partiallyPaidOverdue, paidAmountPaise: 5000 }, today), 0);
  assert.equal(getInstallmentStatus({
    ...unpaid, dueDate: new Date('2026-11-04T00:00:00.000Z'), paidAmountPaise: 100
  }, today), 'partially_paid');
  assert.equal(getInstallmentStatus({ ...unpaid, dueDate: '2026-11-04', paidAmountPaise: 0 }, today), 'upcoming');
});

test('summary includes the remaining balance of a partially paid overdue instalment', () => {
  const summary = summarizeLedgers([{
    student: { centre: 'Jaipur', batch: 'JEE 2027' },
    feePlan: {
      totalFeePaise: 10000,
      netFeePaise: 10000,
      installments: [{ status: 'overdue', outstandingPaise: 4900 }]
    },
    amountPaidPaise: 5100,
    remainingBalancePaise: 4900
  }]);
  assert.equal(summary.totalOutstandingPaise, 4900);
  assert.equal(summary.overdueAmountPaise, 4900);
});

test('student payment status reflects no-plan, overdue, partial, unpaid, and paid ledgers', () => {
  assert.equal(studentLedgerStatus({ feePlan: null }), 'no_plan');
  assert.equal(studentLedgerStatus({
    feePlan: { installments: [{ status: 'overdue' }] },
    remainingBalancePaise: 100
  }), 'overdue');
  assert.equal(studentLedgerStatus({
    feePlan: { installments: [{ status: 'partially_paid' }] },
    remainingBalancePaise: 100
  }), 'partially_paid');
  assert.equal(studentLedgerStatus({
    feePlan: { installments: [{ status: 'upcoming' }] },
    remainingBalancePaise: 100
  }), 'upcoming');
  assert.equal(studentLedgerStatus({
    feePlan: { installments: [{ status: 'paid' }] },
    remainingBalancePaise: 0
  }), 'paid');
  assert.equal(parsePaise('1200.05'), 120005);
  assert.equal(parsePaise('1.005'), null);
});

test('duplicate transaction IDs are rejected without a second ledger update', async () => {
  const plan = createPlan();
  const existing = [{ transactionId: 'TX-1' }];
  const { models, payments } = paymentHarness(plan, existing);
  await assert.rejects(recordPayment(models, paymentInput()), (error) => error.status === 409);
  assert.equal(plan.installments[0].paidAmountPaise, 0);
  assert.equal(payments.length, 1);
});

test('custom instalment totals that do not equal net fee are rejected', () => {
  assert.throws(() => buildInstallments({
    totalFeePaise: 10000,
    discountPaise: 1000,
    dueDates: ['2027-01-01', '2027-02-01', '2027-03-01'],
    amountsPaise: [3000, 3000, 3001]
  }), AppError);
});

test('instalment dates must be real ISO calendar dates', () => {
  assert.throws(() => buildInstallments({
    totalFeePaise: 9000,
    dueDates: ['2027-01-01', '2027-02-29', '2027-03-01']
  }), AppError);
  assert.throws(() => buildInstallments({
    totalFeePaise: 9000,
    dueDates: ['2027-01-01T00:00:00.000Z', '2027-02-01', '2027-03-01']
  }), AppError);
});

test('fee plan schema rejects unsafe money and instalment total mismatches', async () => {
  const plan = new FeePlan({
    studentId: 'STU-1',
    totalFeePaise: 10000,
    discountPaise: 1000,
    netFeePaise: 9000,
    numberOfInstallments: 3,
    installments: [
      { installmentNumber: 1, dueDate: new Date('2027-01-01'), amountPaise: 3000, paidAmountPaise: 0, status: 'upcoming' },
      { installmentNumber: 2, dueDate: new Date('2027-02-01'), amountPaise: 3000, paidAmountPaise: 0, status: 'upcoming' },
      { installmentNumber: 3, dueDate: new Date('2027-03-01'), amountPaise: 3001, paidAmountPaise: 0, status: 'upcoming' }
    ]
  });
  await assert.rejects(plan.validate(), /Installment amounts must add up/);

  const unsafe = new FeePlan({
    studentId: 'STU-2',
    totalFeePaise: Number.MAX_SAFE_INTEGER + 1,
    discountPaise: 0,
    netFeePaise: Number.MAX_SAFE_INTEGER + 1,
    numberOfInstallments: 3,
    installments: [
      { installmentNumber: 1, dueDate: new Date('2027-01-01'), amountPaise: 1, paidAmountPaise: 0, status: 'upcoming' },
      { installmentNumber: 2, dueDate: new Date('2027-02-01'), amountPaise: 1, paidAmountPaise: 0, status: 'upcoming' },
      { installmentNumber: 3, dueDate: new Date('2027-03-01'), amountPaise: 1, paidAmountPaise: 0, status: 'upcoming' }
    ]
  });
  await assert.rejects(unsafe.validate());

  const unsupportedPlan = new FeePlan({
    studentId: 'STU-3',
    totalFeePaise: 9000,
    discountPaise: 0,
    netFeePaise: 9000,
    numberOfInstallments: 2,
    installments: [
      { installmentNumber: 1, dueDate: new Date('2027-01-01'), amountPaise: 4500, paidAmountPaise: 0, status: 'upcoming' },
      { installmentNumber: 2, dueDate: new Date('2027-02-01'), amountPaise: 4500, paidAmountPaise: 0, status: 'upcoming' }
    ]
  });
  await assert.rejects(unsupportedPlan.validate());
});
