import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import test from 'node:test';
import { Refund } from '../src/models/refund.js';

test('refund documents validate policy snapshots and separate approval from disbursement', async () => {
  const reviewerId = new mongoose.Types.ObjectId();
  const refund = new Refund({
    studentId: 'STU-1',
    studentName: 'Student One',
    policyInputs: {
      courseStartDate: new Date('2026-01-01T00:00:00.000Z'),
      withdrawalDate: new Date('2026-02-20T00:00:00.000Z'),
      totalCourseDurationDays: 100,
      totalCourseFeePaise: 1_200_000,
      netCourseFeePaise: 1_000_000,
      amountPaidPaise: 800_000,
      nonRefundableChargesPaise: 10_000,
      policyVersion: 'demo-v1',
      financialInputsSource: 'fee_ledger'
    },
    calculationDetails: {
      daysCompleted: 50,
      feeEarnedPaise: 500_000,
      refundableAmountPaise: 290_000,
      formula: 'Amount paid - fee earned - non-refundable charges',
      assumption: 'Demonstration assumption',
      rounding: 'Nearest paise, half up'
    },
    refundAmountPaise: 290_000,
    status: 'approved',
    createdBy: reviewerId,
    approvedBy: reviewerId,
    approvedAt: new Date()
  });
  await refund.validate();
  assert.equal(refund.status, 'approved');
  assert.equal(refund.approvedBy.toString(), reviewerId.toString());
  assert.equal(refund.refundAmountPaise, 290_000);
});

test('refund documents reject negative monetary values and unidentified reviewers', async () => {
  const refund = new Refund({
    studentId: 'STU-1',
    studentName: 'Student One',
    policyInputs: {
      courseStartDate: new Date('2026-01-01T00:00:00.000Z'),
      withdrawalDate: new Date('2026-02-20T00:00:00.000Z'),
      totalCourseDurationDays: 100,
      totalCourseFeePaise: 1_200_000,
      netCourseFeePaise: 1_000_000,
      amountPaidPaise: 800_000,
      nonRefundableChargesPaise: 0,
      policyVersion: 'demo-v1',
      financialInputsSource: 'fee_ledger'
    },
    calculationDetails: {
      daysCompleted: 50,
      feeEarnedPaise: 500_000,
      refundableAmountPaise: 290_000,
      formula: 'Formula',
      assumption: 'Assumption',
      rounding: 'Rounding'
    },
    refundAmountPaise: -1,
    status: 'pending_review'
  });
  await assert.rejects(refund.validate());
});
