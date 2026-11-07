import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate, requireRole } from '../middleware/authenticate.js';
import { createStudentRiskAssessment } from '../services/student-risk.js';

const assessSchema = z.object({
  studentId: z.string().trim().min(1).max(40)
}).strict();

const feedbackSchema = z.object({
  feedback: z.enum(['valid', 'false_flag']),
  note: z.string().trim().max(500).optional().default('')
}).strict();

function assertObjectId(value) {
  if (!/^[a-f\d]{24}$/i.test(value)) throw new AppError(404, 'Counsellor task not found');
}

export function createRiskRouter(models, config, { fetchImpl = globalThis.fetch } = {}) {
  const router = Router();
  router.use(createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET }));

  router.get('/tasks', requireRole('accounts', 'counsellor'), asyncHandler(async (req, res) => {
    const records = await models.CounsellorTask.find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const tasks = records.map((task) => ({
      ...task,
      studentName: task.studentName || task.studentId,
      riskScore: Number.isSafeInteger(task.riskScore) ? task.riskScore : null,
      reasons: task.reasons ?? [],
      assessmentMethod: task.assessmentMethod || 'legacy',
      recommendedAction: task.recommendedAction || 'Review with the student',
      missingFeatures: task.missingFeatures ?? []
    }));
    res.json({ tasks });
  }));

  router.post('/assess', requireRole('accounts'), validate(assessSchema), asyncHandler(async (req, res) => {
    const result = await createStudentRiskAssessment(models, req.body.studentId, {
      fetchImpl,
      serviceUrl: config.AI_SERVICE_URL,
      timeoutMs: config.AI_SERVICE_TIMEOUT_MS,
      actorId: req.user.id
    });
    res.status(201).json(result);
  }));

  router.post('/tasks/:taskId/feedback', requireRole('counsellor'), validate(feedbackSchema), asyncHandler(async (req, res) => {
    assertObjectId(req.params.taskId);
    const { feedback, note } = req.body;
    const task = await models.CounsellorTask.findOneAndUpdate(
      { _id: req.params.taskId, feedback: { $exists: false } },
      {
        $set: {
          feedback,
          feedbackNote: note,
          feedbackBy: req.user.id,
          reviewedAt: new Date(),
          status: feedback === 'valid' ? 'in_progress' : 'dismissed'
        },
        $unset: { openTaskStudentId: '' }
      },
      { new: true, runValidators: true }
    );
    if (!task) {
      if (await models.CounsellorTask.exists({ _id: req.params.taskId })) {
        throw new AppError(409, 'Counsellor feedback has already been recorded');
      }
      throw new AppError(404, 'Counsellor task not found');
    }
    res.json({ task });
  }));

  return router;
}
