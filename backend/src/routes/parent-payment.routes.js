import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate } from '../middleware/authenticate.js';
import {
  createParentPaymentOrder,
  completeRazorpayPayment,
  getParentPaymentReceipt,
  simulateParentMockPayment
} from '../services/parent-payments.js';

const createOrderSchema = z.object({
  installmentNumber: z.number().int().positive()
}).strict();
const completeOrderSchema = z.object({
  outcome: z.enum(['success', 'failure'])
}).strict();

export function createParentPaymentRouter(models, config) {
  const router = Router();
  router.use(createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET }));

  router.post('/orders', validate(createOrderSchema), asyncHandler(async (req, res) => {
    const order = await createParentPaymentOrder(models, req.user, req.body.installmentNumber, new Date(), config);
    res.status(201).json({ order });
  }));
  router.post('/orders/:orderId/complete', validate(completeOrderSchema), asyncHandler(async (req, res) => {
    if (config.NODE_ENV === 'production' || config.MOCK_PAYMENTS_ENABLED === false) {
      return res.status(404).json({ error: 'Mock payments are disabled' });
    }
    if (!/^[a-f\d]{24}$/i.test(req.params.orderId)) throw new AppError(404, 'Payment order not found');
    const result = await simulateParentMockPayment(
      models, req.user, req.params.orderId, req.body.outcome, config.JWT_SECRET
    );
    res.json(result);
  }));
  router.post('/razorpay/verify', validate(z.object({
    razorpay_order_id: z.string().trim().min(1).max(80),
    razorpay_payment_id: z.string().trim().min(1).max(80),
    razorpay_signature: z.string().trim().min(1).max(128)
  }).strict()), asyncHandler(async (req, res) => {
    if (config.PAYMENT_PROVIDER !== 'razorpay') return res.status(404).json({ error: 'Payment gateway is disabled' });
    const result = await completeRazorpayPayment(models, req.user, {
      orderId: req.body.razorpay_order_id,
      paymentId: req.body.razorpay_payment_id,
      signature: req.body.razorpay_signature
    }, config);
    res.json(result);
  }));
  router.get('/receipts/:paymentId', asyncHandler(async (req, res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.paymentId)) throw new AppError(404, 'Receipt not found');
    const html = await getParentPaymentReceipt(models, req.user, req.params.paymentId, config.RECEIPT_GST_NOTE);
    res.status(200)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="feeflow-receipt-${req.params.paymentId}.html"`)
      .send(html);
  }));
  return router;
}
