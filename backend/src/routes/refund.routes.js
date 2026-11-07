import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate, requireRole } from '../middleware/authenticate.js';
import { createRefundCalculation, reviewRefund } from '../services/refunds.js';

const createSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  courseStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  withdrawalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalCourseDurationDays: z.number().int().safe().min(1).max(36_500),
  netCourseFeePaise: z.number().int().safe().nonnegative().optional(),
  amountPaidPaise: z.number().int().safe().nonnegative().optional(),
  nonRefundableChargesPaise: z.number().int().safe().nonnegative(),
  overrideReason: z.string().trim().max(500).optional()
}).strict();

const reviewSchema = z.object({
  reviewNote: z.string().trim().max(500).optional().default('')
}).strict();

function assertObjectId(value) {
  if (!/^[a-f\d]{24}$/i.test(value)) throw new AppError(404, 'Refund calculation not found');
}

export function createRefundRouter(models, config) {
  const router = Router();
  router.use(
    createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET }),
    requireRole('accounts')
  );

  router.get('/', asyncHandler(async (req, res) => {
    const refunds = await models.Refund.find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ refunds });
  }));

  router.post('/calculate', validate(createSchema), asyncHandler(async (req, res) => {
    const refund = await createRefundCalculation(models, {
      ...req.body,
      policyVersion: config.REFUND_POLICY_VERSION,
      createdBy: req.user.id
    });
    res.status(201).json({ refund });
  }));

  router.post('/:refundId/approve', validate(reviewSchema), asyncHandler(async (req, res) => {
    assertObjectId(req.params.refundId);
    const refund = await reviewRefund(models, req.params.refundId, req.user.id, {
      decision: 'approve',
      reviewNote: req.body.reviewNote
    });
    res.json({ refund, disbursement: 'not_issued' });
  }));

  router.post('/:refundId/reject', validate(reviewSchema), asyncHandler(async (req, res) => {
    assertObjectId(req.params.refundId);
    const refund = await reviewRefund(models, req.params.refundId, req.user.id, {
      decision: 'reject',
      reviewNote: req.body.reviewNote
    });
    res.json({ refund, disbursement: 'not_issued' });
  }));

  return router;
}
