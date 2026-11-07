import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate, requireRole } from '../middleware/authenticate.js';
import {
  processReminderCycle,
  retryFailedReminder
} from '../services/reminders.js';

const languageSchema = z.object({
  preferredLanguage: z.enum(['en', 'hi'])
}).strict();

export function createReminderRouter(models, config, {
  provider,
  auditLog = console.info
} = {}) {
  const router = Router();
  router.use(createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET }));

  router.get('/preferences', requireRole('parent'), asyncHandler(async (req, res) => {
    res.json({ preferredLanguage: req.user.preferredLanguage ?? 'en' });
  }));

  router.post('/preferences', requireRole('parent'), validate(languageSchema), asyncHandler(async (req, res) => {
    const user = await models.User.findOneAndUpdate(
      { _id: req.user.id, role: 'parent', isActive: true },
      { $set: { preferredLanguage: req.body.preferredLanguage } },
      { new: true, runValidators: true }
    );
    if (!user) throw new AppError(404, 'Parent account not found');
    res.json({ preferredLanguage: user.preferredLanguage });
  }));

  router.get('/', requireRole('accounts'), asyncHandler(async (req, res) => {
    const statusSchema = z.enum(['scheduled', 'sending', 'sent', 'cancelled', 'failed']);
    const parsedStatus = req.query.status ? statusSchema.safeParse(req.query.status) : null;
    if (parsedStatus && !parsedStatus.success) throw new AppError(400, 'Invalid reminder status filter');
    const filter = parsedStatus ? { status: parsedStatus.data } : {};
    const reminders = await models.Reminder.find(filter).sort({ scheduledAt: 1 }).lean();
    const studentIds = [...new Set(reminders.map(({ studentId }) => studentId))];
    const [students, plans] = studentIds.length
      ? await Promise.all([
        models.Student.find({ studentId: { $in: studentIds } }).lean(),
        models.FeePlan.find({ studentId: { $in: studentIds } }).lean()
      ])
      : [[], []];
    const studentById = new Map(students.map((student) => [student.studentId, student]));
    const planByStudent = new Map(plans.map((plan) => [plan.studentId, plan]));
    res.json({
      reminders: reminders.map((reminder) => {
        const student = studentById.get(reminder.studentId);
        const installment = planByStudent.get(reminder.studentId)?.installments.find(
          (entry) => entry._id.toString() === reminder.installmentId.toString()
        );
        return {
          ...reminder,
          studentName: student?.name ?? reminder.studentName,
          outstandingAmountPaise: installment
            ? Math.max(0, installment.amountPaise - installment.paidAmountPaise)
            : 0
        };
      })
    });
  }));

  router.post('/process', requireRole('accounts'), asyncHandler(async (req, res) => {
    const result = await processReminderCycle(models, {
      offsetsDays: config.REMINDER_SCHEDULE_OFFSETS_DAYS,
      catchUpWindowMs: config.REMINDER_CATCH_UP_WINDOW_MS,
      staleSendingTimeoutMs: config.REMINDER_STALE_SENDING_TIMEOUT_MS,
      retryDelaysMs: config.REMINDER_RETRY_DELAYS_MS,
      provider,
      auditLog
    });
    res.json({ result });
  }));

  router.post('/:reminderId/retry', requireRole('accounts'), asyncHandler(async (req, res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.reminderId)) {
      throw new AppError(404, 'Failed reminder not found');
    }
    const result = await retryFailedReminder(models, req.params.reminderId, {
      retryDelaysMs: config.REMINDER_RETRY_DELAYS_MS,
      provider,
      auditLog
    });
    res.json({ result });
  }));
  return router;
}
