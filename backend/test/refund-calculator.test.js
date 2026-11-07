import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateProRataRefund } from '../src/services/refunds.js';

const policyInput = {
  courseStartDate: '2026-01-01',
  withdrawalDate: '2026-02-20',
  totalCourseDurationDays: 100,
  netCourseFeePaise: 12_000_000,
  amountPaidPaise: 10_000_000,
  nonRefundableChargesPaise: 500_000,
  policyVersion: 'demo-v1'
};

test('calculates the pro-rata fee earned and refundable balance in integer paise', () => {
  const result = calculateProRataRefund(policyInput);
  assert.equal(result.daysCompleted, 50);
  assert.equal(result.feeEarnedPaise, 6_000_000);
  assert.equal(result.refundableAmountPaise, 3_500_000);
  assert.equal(result.formula, 'Amount paid - fee earned - non-refundable charges');
  assert.match(result.assumption, /calendar-day difference/i);
});

test('withdrawal before course start has zero completed days', () => {
  const result = calculateProRataRefund({
    ...policyInput,
    withdrawalDate: '2025-12-31'
  });
  assert.equal(result.daysCompleted, 0);
  assert.equal(result.feeEarnedPaise, 0);
  assert.equal(result.refundableAmountPaise, 9_500_000);
});

test('withdrawal after course completion caps days at duration and yields no refund', () => {
  const result = calculateProRataRefund({
    ...policyInput,
    withdrawalDate: '2026-06-01'
  });
  assert.equal(result.daysCompleted, 100);
  assert.equal(result.feeEarnedPaise, 12_000_000);
  assert.equal(result.refundableAmountPaise, 0);
});

test('refund has a zero floor when fee earned and charges exceed amount paid', () => {
  const result = calculateProRataRefund({
    ...policyInput,
    amountPaidPaise: 20_000,
    nonRefundableChargesPaise: 30_000
  });
  assert.equal(result.refundableAmountPaise, 0);
  assert.ok(result.refundableAmountPaise >= 0);
});

test('rejects invalid calendar dates, zero duration, and invalid money values', () => {
  assert.throws(() => calculateProRataRefund({ ...policyInput, courseStartDate: '2026-02-30' }), /valid YYYY-MM-DD date/i);
  assert.throws(() => calculateProRataRefund({ ...policyInput, withdrawalDate: 'not-a-date' }), /valid YYYY-MM-DD date/i);
  assert.throws(() => calculateProRataRefund({ ...policyInput, totalCourseDurationDays: 0 }), /duration/i);
  assert.throws(() => calculateProRataRefund({ ...policyInput, amountPaidPaise: -1 }), /safe integer/i);
});
