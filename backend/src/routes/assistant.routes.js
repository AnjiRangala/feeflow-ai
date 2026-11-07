import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate, requireRole } from '../middleware/authenticate.js';
import { answerFeeQuestion } from '../services/fee-assistant.js';

const questionSchema = z.object({
  question: z.string().trim().min(2).max(240)
}).strict();

export function createAssistantRouter(models, config) {
  const router = Router();
  router.use(createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET }));
  router.use(requireRole('accounts'));

  router.post('/ask', validate(questionSchema), asyncHandler(async (req, res) => {
    res.json(await answerFeeQuestion(models, req.body.question));
  }));
  return router;
}
