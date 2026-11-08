import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { getInstallmentStatus, requirePaise } from '../lib/fee-ledger.js';
import { createMockGatewayCallback, verifyMockGatewayCallback } from './mock-payment-gateway.js';
import { syncInstallmentReminders } from './reminders.js';
import { createRazorpayOrder } from './payment-provider.js';
import { verifyRazorpayPaymentSignature } from './payment-provider.js';

const ORDER_LIFETIME_MS = 15 * 60 * 1000;

function assertParentAccess(parent, studentId) {
  if (parent.role !== 'parent' || !parent.studentId || parent.studentId !== studentId) {
    throw new AppError(404, 'Payment order not found');
  }
}

function publicOrder(order) {
  return {
    id: order._id,
    studentId: order.studentId,
    installmentNumber: order.installmentNumber,
    amountPaise: order.amountPaise,
    currency: 'INR',
    status: order.status,
    expiresAt: order.expiresAt,
    transactionId: order.transactionId,
    provider: order.provider,
    providerOrderId: order.providerOrderId,
    razorpayKeyId: order.razorpayKeyId ?? null
  };
}

export async function createParentPaymentOrder(models, parent, installmentNumber, now = new Date(), config = {}) {
  if (parent.role !== 'parent' || !parent.studentId) {
    throw new AppError(403, 'Only a parent account can create a parent payment order');
  }
  const student = await models.Student.findOne({ studentId: parent.studentId, isActive: true }).lean();
  if (!student) throw new AppError(404, 'Student not found');
  const plan = await models.FeePlan.findOne({ studentId: student.studentId }).lean();
  if (!plan) throw new AppError(404, 'Fee plan not found');
  const installment = plan.installments.find((entry) => entry.installmentNumber === installmentNumber);
  if (!installment) throw new AppError(404, 'Instalment not found');
  requirePaise(installment.amountPaise, 'Instalment amount');
  requirePaise(installment.paidAmountPaise, 'Amount already paid', { allowZero: true });
  if (installment.paidAmountPaise > installment.amountPaise) {
    throw new AppError(503, 'Fee ledger instalment is inconsistent');
  }
  const amountPaise = installment.amountPaise - installment.paidAmountPaise;
  if (amountPaise < 1) throw new AppError(409, 'This instalment is already paid');

  const provider = config.PAYMENT_PROVIDER === 'razorpay' ? 'razorpay' : 'mock';
  const providerOrder = provider === 'razorpay'
    ? await createRazorpayOrder({
      amountPaise,
      receipt: `fee-${student.studentId}-${installmentNumber}-${now.getTime()}`,
      config
    })
    : null;
  const order = new models.MockPaymentOrder({
    studentId: student.studentId,
    parentUserId: parent.id,
    installmentNumber,
    installmentId: installment._id,
    amountPaise,
    transactionId: `MOCK-${randomUUID()}`,
    provider,
    providerOrderId: providerOrder?.id ?? null,
    razorpayKeyId: provider === 'razorpay' ? config.RAZORPAY_KEY_ID : null,
    status: 'pending',
    expiresAt: new Date(now.getTime() + ORDER_LIFETIME_MS)
  });
  await order.save();
  return publicOrder(order);
}

export async function simulateParentMockPayment(models, parent, orderId, outcome, gatewaySecret, now = new Date()) {
  if (parent.role !== 'parent' || !parent.studentId) {
    throw new AppError(403, 'Only a parent account can complete a parent payment order');
  }
  if (!['success', 'failure'].includes(outcome)) throw new AppError(400, 'Invalid mock payment outcome');
  const order = await models.MockPaymentOrder.findOne({
    _id: orderId,
    parentUserId: parent.id,
    studentId: parent.studentId
  }).lean();
  if (!order) throw new AppError(404, 'Payment order not found');
  if (order.status !== 'pending') throw new AppError(409, 'Payment order has already been processed');
  if (order.expiresAt <= now) throw new AppError(409, 'Payment order has expired; create a new order');

  const callback = createMockGatewayCallback(order, outcome, gatewaySecret, now);
  return completeParentMockPayment(models, parent, callback, gatewaySecret, now);
}

export async function completeParentMockPayment(models, parent, callback, gatewaySecret, now = new Date()) {
  if (parent.role !== 'parent' || !parent.studentId) {
    throw new AppError(403, 'Only a parent account can complete a parent payment order');
  }

  async function settleRazorpayOrder(models, order, {
    paymentId,
    status = 'completed',
    now = new Date()
  }) {
    const session = await models.connection.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const current = await models.MockPaymentOrder.findOne({
          _id: order._id,
          provider: 'razorpay'
        }).session(session);
        if (!current) throw new AppError(404, 'Payment order not found');
        if (['completed', 'failed', 'cancelled'].includes(current.status)) {
          result = { status: current.status, order: publicOrder(current), duplicate: true };
          return;
        }
        if (status !== 'completed') {
          current.status = status;
          current.providerPaymentId = paymentId || current.providerPaymentId;
          current.completedAt = now;
          await current.save({ session });
          result = { status, order: publicOrder(current) };
          return;
        }
        const plan = await models.FeePlan.findOne({ studentId: current.studentId }).session(session);
        const student = await models.Student.findOne({ studentId: current.studentId, isActive: true }).session(session);
        if (!plan || !student) throw new AppError(404, 'Student or fee plan not found');
        const installment = plan.installments.find((entry) =>
          entry.installmentNumber === current.installmentNumber &&
          entry._id.toString() === current.installmentId.toString()
        );
        if (!installment || installment.amountPaise - installment.paidAmountPaise !== current.amountPaise) {
          throw new AppError(409, 'The instalment balance changed; reconciliation is required');
        }
        installment.paidAmountPaise += current.amountPaise;
        installment.status = getInstallmentStatus(installment, now);
        const payment = new models.Payment({
          studentId: current.studentId,
          installmentId: installment._id,
          amountPaise: current.amountPaise,
          transactionId: paymentId,
          provider: 'razorpay',
          providerOrderId: current.providerOrderId,
          providerPaymentId: paymentId,
          paymentMethod: 'upi',
          status: 'completed',
          paidAt: now
        });
        installment.payments.push(payment._id);
        await plan.save({ session });
        await payment.save({ session });
        current.status = 'completed';
        current.providerPaymentId = paymentId;
        current.paymentId = payment._id;
        current.completedAt = now;
        await current.save({ session });
        result = {
          status: 'completed',
          order: publicOrder(current),
          payment: {
            id: payment._id,
            studentId: payment.studentId,
            installmentNumber: current.installmentNumber,
            amountPaise: payment.amountPaise,
            transactionId: payment.transactionId,
            paidAt: payment.paidAt
          }
        };
      });
      return result;
    } catch (error) {
      if (error.code === 11000) throw new AppError(409, 'Provider payment has already been recorded');
      throw error;
    } finally {
      await session.endSession();
    }
  }

  if (!verifyMockGatewayCallback(callback, gatewaySecret) ||
      callback.parentUserId !== parent.id || callback.studentId !== parent.studentId) {
    throw new AppError(400, 'Invalid mock gateway confirmation');
  }
  const session = await models.connection.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const order = await models.MockPaymentOrder.findOne({
        _id: callback.orderId,
        parentUserId: parent.id,
        studentId: parent.studentId
      }).session(session);
      if (!order) throw new AppError(404, 'Payment order not found');
      if (order.status !== 'pending') throw new AppError(409, 'Payment order has already been processed');
      if (order.expiresAt <= now) throw new AppError(409, 'Payment order has expired; create a new order');
      if (order.studentId !== callback.studentId ||
          order.parentUserId !== callback.parentUserId ||
          order.installmentId.toString() !== callback.installmentId ||
          order.amountPaise !== callback.amountPaise ||
          order.transactionId !== callback.transactionId) {
        throw new AppError(409, 'Mock gateway confirmation does not match the payment order');
      }

      if (callback.status === 'failed') {
        order.status = 'failed';
        order.completedAt = now;
        await order.save({ session });
        result = { status: 'failed', order: publicOrder(order) };
        return;
      }

      const student = await models.Student.findOne({
        studentId: order.studentId,
        isActive: true
      }).session(session);
      if (!student) throw new AppError(404, 'Student not found');
      const plan = await models.FeePlan.findOne({ studentId: order.studentId }).session(session);
      if (!plan) throw new AppError(404, 'Fee plan not found');
      const installment = plan.installments.find((entry) =>
        entry.installmentNumber === order.installmentNumber &&
        entry._id.toString() === order.installmentId.toString()
      );
      if (!installment) throw new AppError(404, 'Instalment not found');
      requirePaise(installment.amountPaise, 'Instalment amount');
      requirePaise(installment.paidAmountPaise, 'Amount already paid', { allowZero: true });
      requirePaise(order.amountPaise, 'Payment amount');
      if (installment.paidAmountPaise > installment.amountPaise) {
        throw new AppError(503, 'Fee ledger instalment is inconsistent');
      }
      const outstandingPaise = installment.amountPaise - installment.paidAmountPaise;
      if (outstandingPaise !== order.amountPaise) {
        throw new AppError(409, 'The instalment balance changed; create a new payment order');
      }

      installment.paidAmountPaise += order.amountPaise;
      installment.status = getInstallmentStatus(installment, now);
      const payment = new models.Payment({
        studentId: order.studentId,
        installmentId: installment._id,
        amountPaise: order.amountPaise,
        transactionId: order.transactionId,
        mockOrderId: order._id,
        paymentMethod: 'upi',
        status: 'completed',
        paidAt: now
      });
      installment.payments.push(payment._id);
      await plan.save({ session });
      await payment.save({ session });
      await syncInstallmentReminders(models.Reminder, order.studentId, installment, now, session);

      order.status = 'completed';
      order.paymentId = payment._id;
      order.completedAt = now;
      await order.save({ session });
      result = {
        status: 'completed',
        order: publicOrder(order),
        payment: {
          id: payment._id,
          studentId: payment.studentId,
          installmentNumber: order.installmentNumber,
          amountPaise: payment.amountPaise,
          transactionId: payment.transactionId,
          paidAt: payment.paidAt
        }
      };
    });
    return result;
  } catch (error) {
    if (error.code === 11000) throw new AppError(409, 'This payment order has already been processed');
    if ([20, 263].includes(error.code) || /transactions are not supported|replica set/i.test(error.message ?? '')) {
      throw new AppError(503, 'Payment recording requires MongoDB transaction support');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function completeRazorpayPayment(models, parent, details, config, now = new Date()) {
  if (parent.role !== 'parent' || !parent.studentId) {
    throw new AppError(403, 'Only a parent account can complete a parent payment order');
  }
  if (!verifyRazorpayPaymentSignature(details, config.RAZORPAY_KEY_SECRET)) {
    throw new AppError(400, 'Invalid Razorpay payment signature');
  }
  const order = await models.MockPaymentOrder.findOne({
    provider: 'razorpay',
    providerOrderId: details.orderId,
    parentUserId: parent.id,
    studentId: parent.studentId
  }).lean();
  if (!order) throw new AppError(404, 'Payment order not found');
  if (order.expiresAt <= now) throw new AppError(409, 'Payment order has expired');
  return settleRazorpayOrder(models, order, { paymentId: details.paymentId, now });
}

export async function processRazorpayWebhook(models, payload, now = new Date()) {
  const entity = payload?.payload?.payment?.entity;
  const orderId = entity?.order_id;
  const paymentId = entity?.id;
  if (!orderId || !paymentId) return { status: 'ignored' };
  const status = payload.event === 'payment.failed' ? 'failed' :
    payload.event === 'payment.pending' ? 'pending' :
      payload.event === 'payment.cancelled' ? 'cancelled' :
    payload.event === 'payment.authorized' ? 'authorized' :
      payload.event === 'payment.captured' ? 'completed' : null;
  if (!status) return { status: 'ignored' };
  const order = await models.MockPaymentOrder.findOne({ provider: 'razorpay', providerOrderId: orderId }).lean();
  if (!order) return { status: 'ignored' };
  return settleRazorpayOrder(models, order, { paymentId, status, now });
}

export async function reconcileRazorpayPayments(models) {
  const [orders, payments] = await Promise.all([
    models.MockPaymentOrder.find({ provider: 'razorpay' }).lean(),
    models.Payment.find({ provider: 'razorpay' }).lean()
  ]);
  const paymentIds = new Set(payments.map((payment) => payment.providerPaymentId).filter(Boolean));
  const exceptions = orders
    .filter((order) => order.status === 'completed' && (!order.providerPaymentId || !paymentIds.has(order.providerPaymentId)))
    .map((order) => ({ orderId: order._id, providerOrderId: order.providerOrderId, reason: 'completed order has no matching payment ledger entry' }));
  return {
    providerOrders: orders.length,
    ledgerPayments: payments.length,
    exceptions,
    reconciled: exceptions.length === 0
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatReceiptRupees(amountPaise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amountPaise / 100);
}

export function buildPaymentReceiptHtml({ payment, student, installmentNumber, gstNote }) {
  const receiptNumber = `FF-${String(payment._id)}`;
  const fields = [
    ['Receipt number', receiptNumber],
    ['Student', student.name],
    ['Student ID', student.studentId],
    ['Batch', student.batch],
    ['Instalment', installmentNumber],
    ['Amount paid', formatReceiptRupees(payment.amountPaise)],
    ['Payment date', new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(payment.paidAt))],
    ['Transaction ID', payment.transactionId]
  ];
  const rows = fields.map(([label, value]) =>
    `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
  ).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FeeFlow receipt ${escapeHtml(receiptNumber)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;color:#172a42;max-width:680px;margin:40px auto;padding:24px}h1{color:#173d67}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #e5eaf0}th{width:38%;color:#52677e}.gst{padding:14px;background:#f5f8fc;border-radius:8px;font-size:14px}button{padding:12px 18px;background:#173d67;color:#fff;border:0;border-radius:6px}@media print{button{display:none}body{margin:0}}</style></head>
<body><h1>FeeFlow AI payment receipt</h1><p>Payment received successfully.</p><table>${rows}</table><section class="gst"><strong>GST information / project assumption</strong><p>${escapeHtml(gstNote)}</p></section><p>This receipt records the mock payment transaction shown above.</p><button onclick="window.print()" type="button">Print or save as PDF</button></body></html>`;
}

export async function getParentPaymentReceipt(models, user, paymentId, gstNote) {
  const payment = await models.Payment.findById(paymentId).lean();
  if (!payment) throw new AppError(404, 'Receipt not found');
  if (user.role === 'parent') assertParentAccess(user, payment.studentId);
  else if (user.role !== 'accounts') throw new AppError(403, 'You do not have permission to access this receipt');

  const student = await models.Student.findOne({ studentId: payment.studentId }).lean();
  const plan = await models.FeePlan.findOne({ studentId: payment.studentId }).lean();
  const installmentNumber = plan?.installments.find(({ _id }) =>
    _id.toString() === payment.installmentId.toString()
  )?.installmentNumber;
  if (!student || !installmentNumber || payment.status !== 'completed') {
    throw new AppError(404, 'Receipt not found');
  }
  return buildPaymentReceiptHtml({ payment, student, installmentNumber, gstNote });
}
