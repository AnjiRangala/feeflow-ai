import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { sumSafeIntegers } from '../lib/fee-ledger.js';
import { createRazorpayRefund } from './payment-provider.js';

const DAY_MS = 86_400_000;
const REFUND_ASSUMPTION = 'Demonstration assumption only: completed days are whole UTC calendar-day differences from course start to withdrawal, clamped to 0..course duration; the withdrawal date itself is not counted as an additional day.';

function parseCalendarDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, `${field} must be a valid YYYY-MM-DD date`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, `${field} must be a valid YYYY-MM-DD date`);
  }
  return date;
}

function requireMoney(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(400, `${field} must be a non-negative safe integer amount in paise`);
  }
}

export function calculateProRataRefund({
  courseStartDate,
  withdrawalDate,
  totalCourseDurationDays,
  netCourseFeePaise,
  amountPaidPaise,
  nonRefundableChargesPaise,
  policyVersion
}) {
  const start = parseCalendarDate(courseStartDate, 'Course start date');
  const withdrawal = parseCalendarDate(withdrawalDate, 'Withdrawal date');
  if (!Number.isSafeInteger(totalCourseDurationDays) || totalCourseDurationDays < 1 ||
      totalCourseDurationDays > 36_500) {
    throw new AppError(400, 'Total course duration must be an integer from 1 to 36500 days');
  }
  requireMoney(netCourseFeePaise, 'Net course fee');
  requireMoney(amountPaidPaise, 'Amount paid');
  requireMoney(nonRefundableChargesPaise, 'Non-refundable charges');
  if (typeof policyVersion !== 'string' || !policyVersion.trim() || policyVersion.trim().length > 80) {
    throw new AppError(400, 'Policy version must contain 1 to 80 characters');
  }
  const rawDays = Math.floor((withdrawal.getTime() - start.getTime()) / DAY_MS);
  const daysCompleted = Math.min(totalCourseDurationDays, Math.max(0, rawDays));
  const numerator = BigInt(netCourseFeePaise) * BigInt(daysCompleted);
  const duration = BigInt(totalCourseDurationDays);
  const feeEarnedPaise = Number((numerator + duration / 2n) / duration);
  if (!Number.isSafeInteger(feeEarnedPaise)) {
    throw new AppError(400, 'Calculated fee earned exceeds the safe monetary range');
  }
  const rawRefund = BigInt(amountPaidPaise) - BigInt(feeEarnedPaise) - BigInt(nonRefundableChargesPaise);
  const refundableAmountPaise = rawRefund > 0n ? Number(rawRefund) : 0;

  return {
    daysCompleted,
    feeEarnedPaise,
    refundableAmountPaise,
    formula: 'Amount paid - fee earned - non-refundable charges',
    assumption: REFUND_ASSUMPTION,
    rounding: 'Fee earned is rounded to the nearest paise, half up.'
  };
}

export async function createRefundCalculation(models, {
  studentId,
  courseStartDate,
  withdrawalDate,
  totalCourseDurationDays,
  netCourseFeePaise: requestedNetCourseFeePaise,
  amountPaidPaise: requestedAmountPaidPaise,
  nonRefundableChargesPaise,
  overrideReason,
  policyVersion,
  createdBy
}) {
  const student = await models.Student.findOne({ studentId, isActive: true }).lean();
  if (!student) throw new AppError(404, 'Student not found');
  const plan = await models.FeePlan.findOne({ studentId }).lean();
  if (!plan) throw new AppError(409, 'A fee plan is required before calculating a refund');
  const ledgerAmountPaidPaise = sumSafeIntegers(
    plan.installments.map(({ paidAmountPaise }) => paidAmountPaise),
    'Amount paid'
  );
  const netCourseFeePaise = requestedNetCourseFeePaise ?? plan.netFeePaise;
  const amountPaidPaise = requestedAmountPaidPaise ?? ledgerAmountPaidPaise;
  const hasFinancialOverride = netCourseFeePaise !== plan.netFeePaise ||
    amountPaidPaise !== ledgerAmountPaidPaise;
  if (hasFinancialOverride && (typeof overrideReason !== 'string' || overrideReason.trim().length < 10)) {
    throw new AppError(400, 'A reason of at least 10 characters is required when overriding ledger amounts');
  }
  const calculationDetails = calculateProRataRefund({
    courseStartDate,
    withdrawalDate,
    totalCourseDurationDays,
    netCourseFeePaise: plan.netFeePaise,
    amountPaidPaise,
    nonRefundableChargesPaise,
    policyVersion
  });
  const refund = new models.Refund({
    studentId,
    studentName: student.name,
    policyInputs: {
      courseStartDate: parseCalendarDate(courseStartDate, 'Course start date'),
      withdrawalDate: parseCalendarDate(withdrawalDate, 'Withdrawal date'),
      totalCourseDurationDays,
      totalCourseFeePaise: plan.totalFeePaise,
      netCourseFeePaise,
      amountPaidPaise,
      nonRefundableChargesPaise,
      policyVersion,
      financialInputsSource: hasFinancialOverride ? 'accounts_override' : 'fee_ledger',
      overrideReason: hasFinancialOverride ? overrideReason.trim() : null
    },
    calculationDetails,
    refundAmountPaise: calculationDetails.refundableAmountPaise,
    status: 'pending_review',
    createdBy
  });
  await refund.save();
  return refund;
}

export async function reviewRefund(models, refundId, reviewerId, { decision, reviewNote, now = new Date() }) {
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const refund = await models.Refund.findOneAndUpdate(
    { _id: refundId, status: 'pending_review' },
    {
      $set: {
        status,
        approvedBy: decision === 'approve' ? reviewerId : null,
        approvedAt: decision === 'approve' ? now : null,
        reviewedBy: reviewerId,
        reviewedAt: now,
        reviewNote: reviewNote || null
      }

    },
    { new: true, runValidators: true }
  );
  if (refund) return refund;
  if (!await models.Refund.exists({ _id: refundId })) throw new AppError(404, 'Refund calculation not found');
  throw new AppError(409, 'Refund calculation has already been reviewed');
}

export async function processRazorpayRefund(models, refundId, reviewerId, config, now = new Date()) {
  const existingRefund = await models.Refund.findOne({ _id: refundId, status: 'approved' }).lean();
  if (!existingRefund) {
    if (!await models.Refund.exists({ _id: refundId })) {
      throw new AppError(404, 'Refund calculation not found');
    }
    throw new AppError(409, 'Refund is already being processed or has been processed');
  }
  const payment = await models.Payment.findOne({
    studentId: existingRefund.studentId,
    provider: 'razorpay',
    status: 'completed'
  }).sort({ paidAt: -1 }).lean();
  if (!payment?.providerPaymentId) throw new AppError(409, 'No settled Razorpay payment is available for this refund');

  const providerRequestId = randomUUID();
  const refund = await models.Refund.findOneAndUpdate(
    { _id: refundId, status: 'approved', providerRefundId: { $exists: false } },
    {
      $set: {
        status: 'processing',
        providerRequestId,
        processingStartedAt: now,
        processingError: null,
        reviewedBy: reviewerId
      }
    },
    { new: true, runValidators: true }
  ).lean();
  if (!refund) {
    if (!await models.Refund.exists({ _id: refundId })) {
      throw new AppError(404, 'Refund calculation not found');
    }
    throw new AppError(409, 'Refund is already being processed or has been processed');
  }
  try {
    const providerRefund = await createRazorpayRefund({
      paymentId: payment.providerPaymentId,
      amountPaise: refund.refundAmountPaise,
      config,
      idempotencyKey: providerRequestId
    });
    return await models.Refund.findOneAndUpdate(
      { _id: refundId, status: 'processing', providerRequestId },
      {
        $set: {
          status: 'processed',
          provider: 'razorpay',
          providerRefundId: providerRefund.id,
          processedAt: now,
          processingError: null
        }
      },
      { new: true, runValidators: true }
    );
  } catch (error) {
    await models.Refund.updateOne(
      { _id: refundId, status: 'processing', providerRequestId },
      { $set: { processingError: error.message?.slice(0, 500) || 'Provider refund failed' } }
    );
    throw error;
  }
}
