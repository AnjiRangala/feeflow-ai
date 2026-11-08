import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation.js';
import { createAuthenticate, requireRole } from '../middleware/authenticate.js';
import { recordPayment } from '../services/fee-ledger.js';
import { reconcileRazorpayPayments } from '../services/parent-payments.js';

const recordPaymentSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  installmentNumber: z.number().int().positive(),
  amountPaise: z.number().int().safe().positive(),
  transactionId: z.string().trim().min(1).max(120),
  paymentMethod: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'other'])
}).strict();

export function createPaymentRouter(models, config) {
  const router = Router();
  router.use(createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET }));
  router.post('/record', requireRole('accounts'), validate(recordPaymentSchema), async (req, res, next) => {
    try {
      const payment = await recordPayment(models, req.body);
      res.status(201).json({ payment });
    } catch (error) {
      next(error);
    }
  });
  router.get('/reconciliation', requireRole('accounts'), async (req, res, next) => {
    try {
      if (config.PAYMENT_PROVIDER !== 'razorpay') return res.status(404).json({ error: 'Payment gateway is disabled' });
      res.json(await reconcileRazorpayPayments(models));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
