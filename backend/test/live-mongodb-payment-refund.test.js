import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { demoParents, demoAccountsUser } from '../src/demo-seed-data.js';
import { formatReminderMessage } from '../src/services/reminders.js';
import { completeParentMockPayment } from '../src/services/parent-payments.js';
import { createMockGatewayCallback } from '../src/services/mock-payment-gateway.js';
import { startLiveMongoApp, models } from './live-mongodb-helpers.js';

test('real MongoDB mock payment, refund review, and transaction verification use isolated records', async () => {
  const runtime = await startLiveMongoApp();
  let cleaned = {};
  try {
    const fixture = await runtime.createFixture();
    const parent = await runtime.login(fixture.parentEmail, process.env.DEMO_PARENT_PASSWORD);
    const accounts = await runtime.login(demoAccountsUser.email, process.env.DEMO_ACCOUNTS_PASSWORD);
    const otherParent = await runtime.login(demoParents[0].email, process.env.DEMO_PARENT_PASSWORD);
    const before = await runtime.call(`/fees/student/${fixture.studentId}`, { token: parent.accessToken });
    assert.equal(before.status, 200);
    const beforeBalance = before.payload.student.remainingBalancePaise;

    const failedOrderResponse = await runtime.call('/parent-payments/orders', {
      method: 'POST',
      token: parent.accessToken,
      body: { installmentNumber: 1 }
    });
    assert.equal(failedOrderResponse.status, 201);
    const failedOrderId = failedOrderResponse.payload.order.id;
    const failedOrderRecord = await models.MockPaymentOrder.findById(failedOrderId).lean();
    assert.ok(failedOrderRecord);
    assert.equal(failedOrderRecord.status, 'pending');
    const failed = await runtime.call(`/parent-payments/orders/${failedOrderId}/complete`, {
      method: 'POST',
      token: parent.accessToken,
      body: { outcome: 'failure' }
    });
    assert.equal(failed.status, 200);
    assert.equal(failed.payload.status, 'failed');
    assert.equal(await models.Payment.countDocuments({ studentId: fixture.studentId }), 0);
    assert.equal((await runtime.call(`/fees/student/${fixture.studentId}`, {
      token: parent.accessToken
    })).payload.student.remainingBalancePaise, beforeBalance);

    const successOrderResponse = await runtime.call('/parent-payments/orders', {
      method: 'POST',
      token: parent.accessToken,
      body: { installmentNumber: 2 }
    });
    assert.equal(successOrderResponse.status, 201);
    const orderId = successOrderResponse.payload.order.id;
    const order = await models.MockPaymentOrder.findById(orderId).lean();
    assert.ok(order);
    const invalidCallback = createMockGatewayCallback(order, 'success', config.JWT_SECRET);
    invalidCallback.signature = '0'.repeat(64);
    await assert.rejects(
      completeParentMockPayment(models, parent.user, invalidCallback, config.JWT_SECRET),
      (error) => error.status === 400
    );
    assert.equal((await models.MockPaymentOrder.findById(orderId).lean()).status, 'pending');
    const preSettlementPlan = await models.FeePlan.findOne({ studentId: fixture.studentId }).lean();
    const targetInstallment = preSettlementPlan.installments.find(({ installmentNumber }) => installmentNumber === 2);
    await models.Reminder.create({
      studentId: fixture.studentId,
      studentName: 'QA Demo Student',
      recipient: fixture.parent.phone,
      installmentId: targetInstallment._id,
      installmentNumber: targetInstallment.installmentNumber,
      scheduleOffsetDays: 3,
      idempotencyKey: `${targetInstallment._id}:${targetInstallment.dueDate.getTime()}:3`,
      scheduledAt: new Date(targetInstallment.dueDate.getTime() - 3 * 86_400_000),
      language: 'en',
      message: formatReminderMessage({
        language: 'en',
        remainingAmountPaise: targetInstallment.amountPaise,
        dueDate: targetInstallment.dueDate
      }),
      outstandingAmountPaise: targetInstallment.amountPaise,
      status: 'scheduled',
      provider: 'mock'
    });

    const completed = await runtime.call(`/parent-payments/orders/${orderId}/complete`, {
      method: 'POST',
      token: parent.accessToken,
      body: { outcome: 'success' }
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.payload.status, 'completed');
    const payment = await models.Payment.findById(completed.payload.payment.id).lean();
    assert.ok(payment);
    assert.equal(payment.status, 'completed');
    assert.equal(payment.mockOrderId.toString(), orderId);
    assert.equal((await models.Reminder.findOne({
      studentId: fixture.studentId,
      installmentId: targetInstallment._id
    }).lean()).status, 'cancelled');
    const ledgerAfter = await runtime.call(`/fees/student/${fixture.studentId}`, { token: parent.accessToken });
    assert.equal(ledgerAfter.status, 200);
    assert.equal(ledgerAfter.payload.student.remainingBalancePaise, beforeBalance - payment.amountPaise);
    const paidInstallment = ledgerAfter.payload.student.feePlan.installments.find(
      ({ installmentNumber }) => installmentNumber === 2
    );
    assert.ok(paidInstallment.payments.some(({ _id }) => _id.toString() === payment._id.toString()));
    assert.equal((await runtime.call(`/parent-payments/orders/${orderId}/complete`, {
      method: 'POST',
      token: parent.accessToken,
      body: { outcome: 'success' }
    })).status, 409);
    const receipt = await runtime.call(`/parent-payments/receipts/${payment._id}`, {
      token: parent.accessToken
    });
    assert.equal(receipt.status, 200);
    assert.match(receipt.payload, /FeeFlow AI payment receipt/);
    assert.equal((await runtime.call(`/parent-payments/receipts/${payment._id}`, {
      token: otherParent.accessToken
    })).status, 404);

    const refundInput = {
      studentId: fixture.studentId,
      courseStartDate: '2026-07-01',
      withdrawalDate: '2026-08-01',
      totalCourseDurationDays: 180,
      nonRefundableChargesPaise: 100
    };
    const created = await runtime.call('/refunds/calculate', {
      method: 'POST',
      token: accounts.accessToken,
      body: refundInput
    });
    assert.equal(created.status, 201);
    const refundId = created.payload.refund._id;
    const refundRecord = await models.Refund.findById(refundId).lean();
    assert.ok(refundRecord);
    assert.equal(refundRecord.policyInputs.policyVersion, config.REFUND_POLICY_VERSION);
    assert.equal(refundRecord.policyInputs.financialInputsSource, 'fee_ledger');
    assert.equal(refundRecord.policyInputs.netCourseFeePaise, 300_000);
    assert.equal(refundRecord.policyInputs.amountPaidPaise, 100_000);
    assert.equal(refundRecord.refundAmountPaise, refundRecord.calculationDetails.refundableAmountPaise);
    assert.equal((await runtime.call('/refunds', { token: parent.accessToken })).status, 403);
    assert.equal((await runtime.call(`/refunds/${refundId}/approve`, {
      method: 'POST',
      token: parent.accessToken,
      body: {}
    })).status, 403);

    const approved = await runtime.call(`/refunds/${refundId}/approve`, {
      method: 'POST',
      token: accounts.accessToken,
      body: { reviewNote: 'QA approval; no disbursement' }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.refund.status, 'approved');
    assert.equal(approved.payload.disbursement, 'not_issued');
    const approvedRecord = await models.Refund.findById(refundId).lean();
    assert.equal(approvedRecord.reviewedBy.toString(), accounts.user.id);
    assert.ok(approvedRecord.reviewedAt);
    const rejectedCreate = await runtime.call('/refunds/calculate', {
      method: 'POST',
      token: accounts.accessToken,
      body: refundInput
    });
    assert.equal(rejectedCreate.status, 201);
    const rejectedId = rejectedCreate.payload.refund._id;
    const rejected = await runtime.call(`/refunds/${rejectedId}/reject`, {
      method: 'POST',
      token: accounts.accessToken,
      body: { reviewNote: 'QA rejection; no disbursement' }
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.payload.refund.status, 'rejected');
    const rejectedRecord = await models.Refund.findById(rejectedId).lean();
    assert.equal(rejectedRecord.reviewedBy.toString(), accounts.user.id);
    assert.ok(rejectedRecord.reviewedAt);
    assert.equal((await runtime.call(`/refunds/${rejectedId}/reject`, {
      method: 'POST',
      token: parent.accessToken,
      body: {}
    })).status, 403);

    let transactionSupport = 'PASS';
    const transactionEmail = `qa-transaction-${fixture.studentId}@invalid.example`;
    const session = await mongoose.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const probe = await new models.User({
          name: 'QA Transaction Probe',
          email: transactionEmail,
          phone: '+910000000000',
          passwordHash: 'transaction-probe-only',
          role: 'accounts',
          isActive: true
        }).save({ session });
        await models.User.deleteOne({ _id: probe._id }, { session });
      });
      assert.equal(await models.User.countDocuments({ email: transactionEmail }), 0);
    } catch (error) {
      if ([20, 263].includes(error.code) || /transactions are not supported|replica set/i.test(error.message ?? '')) {
        transactionSupport = 'FAIL';
      } else {
        throw error;
      }
    } finally {
      await session.endSession();
    }

    console.info(JSON.stringify({
      workflow: 'mock-payment-refund-and-transaction',
      result: 'PASS',
      isolatedStudentCount: 1,
      mockOrders: 2,
      failedPaymentLedgerUnchanged: true,
      successfulPaymentAndReceipt: true,
      duplicateSettlementPrevented: true,
      invalidSignatureRejected: true,
      refundsCreatedAndReviewed: 2,
      actualRefundsIssued: 0,
      transactionSupport
    }));
  } finally {
    cleaned = await runtime.close();
    console.info(JSON.stringify({ cleanup: 'payment-refund', records: cleaned }));
  }
});
