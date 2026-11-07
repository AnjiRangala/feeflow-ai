import { AppError } from '../lib/errors.js';
import {
  getDaysOverdue,
  getInstallmentStatus,
  sumSafeIntegers,
  updateFeePlanTotals
} from '../lib/fee-ledger.js';
import { syncInstallmentReminders } from './reminders.js';

export async function getStudentLedgers({ Student, FeePlan, Payment }, students, now = new Date()) {
  if (!students.length) return [];
  const studentIds = students.map((student) => student.studentId);
  const plans = await FeePlan.find({ studentId: { $in: studentIds } }).lean();
  for (const plan of plans) {
    if (!Number.isSafeInteger(plan.totalFeePaise) ||
        !Number.isSafeInteger(plan.discountPaise) ||
        !Number.isSafeInteger(plan.netFeePaise)) {
      throw new AppError(503, 'Legacy fee data must be migrated before the ledger can be used');
    }
  }
  const planByStudent = new Map(plans.map((plan) => [plan.studentId, plan]));
  const installmentIds = plans.flatMap((plan) => plan.installments.map(({ _id }) => _id));
  const payments = installmentIds.length
    ? await Payment.find({ installmentId: { $in: installmentIds }, status: 'completed' }).sort({ paidAt: -1 }).lean()
    : [];
  if (payments.some(({ amountPaise }) => !Number.isSafeInteger(amountPaise))) {
    throw new AppError(503, 'Legacy payment data must be migrated before the ledger can be used');
  }
  const paymentsByInstallment = new Map();
  const paymentHistoryByStudent = new Map();
  for (const payment of payments) {
    const key = payment.installmentId.toString();
    paymentsByInstallment.set(key, [...(paymentsByInstallment.get(key) ?? []), payment]);
    paymentHistoryByStudent.set(payment.studentId, [...(paymentHistoryByStudent.get(payment.studentId) ?? []), payment]);
  }

  return students.map((student) => {
    const plan = planByStudent.get(student.studentId);
    if (!plan) return { student, feePlan: null, paymentHistory: [], amountPaidPaise: 0, remainingBalancePaise: 0 };
    const totals = updateFeePlanTotals(plan);
    const installments = plan.installments.map((installment) => {
      if (!Number.isSafeInteger(installment.amountPaise) ||
          !Number.isSafeInteger(installment.paidAmountPaise) ||
          installment.paidAmountPaise < 0 || installment.paidAmountPaise > installment.amountPaise) {
        throw new AppError(500, 'Fee ledger instalment is inconsistent');
      }
      return {
        ...installment,
        status: getInstallmentStatus(installment, now),
        daysOverdue: getDaysOverdue(installment, now),
        outstandingPaise: installment.amountPaise - installment.paidAmountPaise,
        payments: paymentsByInstallment.get(installment._id.toString()) ?? []
      };
    });
    return {
      student,
      feePlan: {
        id: plan._id,
        totalFeePaise: plan.totalFeePaise,
        discountPaise: plan.discountPaise,
        netFeePaise: plan.netFeePaise,
        numberOfInstallments: plan.numberOfInstallments,
        installments
      },
      paymentHistory: paymentHistoryByStudent.get(student.studentId) ?? [],
      ...totals
    };
  });
}

export async function createFeePlan({ Student, FeePlan }, studentId, planData) {
  const student = await Student.findOne({ studentId, isActive: true }).lean();
  if (!student) throw new AppError(404, 'Student not found');
  if (await FeePlan.exists({ studentId })) throw new AppError(409, 'A fee plan already exists for this student');
  const plan = new FeePlan({ studentId, ...planData });
  try {
    await plan.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError(409, 'A fee plan already exists for this student');
    throw error;
  }
  return plan;
}

export async function recordPayment(models, { studentId, installmentNumber, amountPaise, transactionId, paymentMethod }) {
  const { Student, FeePlan, Payment, connection } = models;
  const session = await connection.startSession();
  let recordedPayment;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ studentId, isActive: true }).session(session);
      if (!student) throw new AppError(404, 'Student not found');

      const duplicate = await Payment.findOne({ transactionId }).session(session);
      if (duplicate) throw new AppError(409, 'Transaction ID has already been processed');

      const plan = await FeePlan.findOne({ studentId }).session(session);
      if (!plan) throw new AppError(404, 'Fee plan not found');
      const installment = plan.installments.find((entry) => entry.installmentNumber === installmentNumber);
      if (!installment) throw new AppError(404, 'Instalment not found');

      const outstandingPaise = installment.amountPaise - installment.paidAmountPaise;
      if (amountPaise > outstandingPaise) {
        throw new AppError(400, 'Payment exceeds the outstanding instalment balance');
      }
      if (amountPaise < 1 || !Number.isSafeInteger(amountPaise)) {
        throw new AppError(400, 'Payment amount must be a positive safe integer in paise');
      }

      const nextPaidAmount = installment.paidAmountPaise + amountPaise;
      if (!Number.isSafeInteger(nextPaidAmount) || nextPaidAmount > installment.amountPaise) {
        throw new AppError(400, 'Payment exceeds the outstanding instalment balance');
      }
      installment.paidAmountPaise = nextPaidAmount;
      installment.status = getInstallmentStatus(installment);

      const payment = new Payment({
        studentId,
        installmentId: installment._id,
        amountPaise,
        transactionId,
        paymentMethod,
        status: 'completed',
        paidAt: new Date()
      });
      installment.payments.push(payment._id);
      await plan.save({ session });
      await payment.save({ session });
      await syncInstallmentReminders(models.Reminder, studentId, installment, new Date(), session);
      recordedPayment = payment;
    });
    return recordedPayment;
  } catch (error) {
    if (error.code === 11000) throw new AppError(409, 'Transaction ID or fee plan already exists');
    if ([20, 263].includes(error.code) || /transactions are not supported|replica set/i.test(error.message ?? '')) {
      throw new AppError(503, 'Payment recording requires MongoDB transaction support');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export function summarizeLedgers(ledgers) {
  const planned = ledgers.filter(({ feePlan }) => feePlan);
  const totalFeesBilledPaise = sumSafeIntegers(planned.map(({ feePlan }) => feePlan.totalFeePaise), 'Fees billed');
  const totalNetFeesPaise = sumSafeIntegers(planned.map(({ feePlan }) => feePlan.netFeePaise), 'Net fees billed');
  const totalFeesCollectedPaise = sumSafeIntegers(planned.map(({ amountPaidPaise }) => amountPaidPaise), 'Fees collected');
  const totalOutstandingPaise = sumSafeIntegers(planned.map(({ remainingBalancePaise }) => remainingBalancePaise), 'Outstanding fees');
  const overdueAmountPaise = sumSafeIntegers(planned.flatMap(({ feePlan }) =>
    feePlan.installments.filter(({ status }) => status === 'overdue').map(({ outstandingPaise }) => outstandingPaise)
  ), 'Overdue fees');
  const groupOutstanding = (key) => {
    const grouped = new Map();
    for (const ledger of planned) {
      const name = ledger.student[key] || 'Unassigned';
      grouped.set(name, (grouped.get(name) ?? 0) + ledger.remainingBalancePaise);
      if (!Number.isSafeInteger(grouped.get(name))) throw new AppError(400, 'Outstanding fees exceed the safe monetary range');
    }
    return [...grouped].map(([name, outstandingPaise]) => ({ name, outstandingPaise }));
  };
  return {
    totalFeesBilledPaise,
    totalNetFeesPaise,
    totalFeesCollectedPaise,
    totalOutstandingPaise,
    overdueAmountPaise,
    collectionPercentage: totalNetFeesPaise
      ? Number((totalFeesCollectedPaise / totalNetFeesPaise * 100).toFixed(2))
      : 0,
    centreWiseOutstanding: groupOutstanding('centre'),
    batchWiseOutstanding: groupOutstanding('batch')
  };
}
