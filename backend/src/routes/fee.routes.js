import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate, requireRole } from '../middleware/authenticate.js';
import { createFeePlan, getStudentLedgers, summarizeLedgers } from '../services/fee-ledger.js';
import { buildInstallments } from '../lib/fee-ledger.js';
import { buildDashboardCsv, getAccountsDashboard } from '../services/accounts-dashboard.js';

const createPlanSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  totalFeePaise: z.number().int().safe().positive(),
  discountPaise: z.number().int().safe().nonnegative().default(0),
  dueDates: z.array(z.string().min(1)).min(3).max(4),
  amountsPaise: z.array(z.number().int().safe().positive()).min(3).max(4).optional()
}).strict();

export function createFeeRouter(models, config) {
  const router = Router();
  const authenticate = createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET });
  router.use(authenticate, requireRole('parent', 'accounts'));

  router.get('/students', asyncHandler(async (req, res) => {
    const filter = { isActive: true };
    if (req.user.role === 'parent') {
      if (!req.user.studentId) return res.json({ students: [] });
      filter.studentId = req.user.studentId;
    }
    const students = await models.Student.find(filter).sort({ name: 1 }).lean();
    const ledgers = await getStudentLedgers(models, students);
    res.json({ students: ledgers });
  }));

  router.get('/student/:studentId', asyncHandler(async (req, res) => {
    if (req.user.role === 'parent' && req.user.studentId !== req.params.studentId) {
      throw new AppError(403, 'You do not have permission to access this student');
    }
    const student = await models.Student.findOne({ studentId: req.params.studentId, isActive: true }).lean();
    if (!student) throw new AppError(404, 'Student not found');
    const [ledger] = await getStudentLedgers(models, [student]);
    res.json({ student: ledger });
  }));

  router.post('/create-plan', requireRole('accounts'), validate(createPlanSchema), asyncHandler(async (req, res) => {
    const { studentId, totalFeePaise, discountPaise, dueDates, amountsPaise } = req.body;
    const { netFeePaise, installments } = buildInstallments({
      totalFeePaise, discountPaise, dueDates, amountsPaise
    });
    const plan = await createFeePlan(models, studentId, {
      totalFeePaise,
      discountPaise,
      netFeePaise,
      numberOfInstallments: installments.length,
      installments
    });
    res.status(201).json({
      feePlan: {
        id: plan._id,
        studentId,
        totalFeePaise,
        discountPaise,
        netFeePaise,
        numberOfInstallments: installments.length,
        installments
      }
    });
  }));

  router.get('/dashboard', requireRole('accounts'), asyncHandler(async (req, res) => {
    const dashboard = await getAccountsDashboard(models);
    res.json({ dashboard });
  }));

  router.get('/export.csv', requireRole('accounts'), asyncHandler(async (req, res) => {
    const dashboard = await getAccountsDashboard(models);
    res.status(200)
      .type('text/csv')
      .attachment(`feeflow-accounts-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(buildDashboardCsv(dashboard.rows));
  }));

  router.get('/summary', requireRole('accounts'), asyncHandler(async (req, res) => {
    const students = await models.Student.find({ isActive: true }).sort({ name: 1 }).lean();
    const ledgers = await getStudentLedgers(models, students);
    res.json({ summary: summarizeLedgers(ledgers) });
  }));
  return router;
}
