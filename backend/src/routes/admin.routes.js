import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate, requireRole } from '../middleware/authenticate.js';
import {
  listManagedUsers,
  provisionCounsellor,
  registerStudentWithParent,
  updateManagedUserStatus
} from '../services/user-provisioning.js';

const name = z.string().trim().min(2).max(120);
const phone = z.string().trim().min(7).max(30);
const counsellorSchema = z.object({ name, email: z.string().trim().email().max(254), phone }).strict();
const studentSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  name,
  batch: z.string().trim().min(1).max(120),
  centre: z.string().trim().min(1).max(120),
  parent: z.object({ name, email: z.string().trim().email().max(254), phone }).strict()
}).strict();
const statusSchema = z.object({ active: z.boolean() }).strict();

export function createAdminRouter(models, config, { deliverInvitation }) {
  const router = Router();
  router.use(
    createAuthenticate({ User: models.User, jwtSecret: config.JWT_SECRET }),
    requireRole('accounts')
  );

  router.get('/users', asyncHandler(async (req, res) => {
    res.json({ users: await listManagedUsers(models.User) });
  }));

  router.post('/students', validate(studentSchema), asyncHandler(async (req, res) => {
    const result = await registerStudentWithParent(models, req.body, req.user.id, deliverInvitation);
    res.status(201).json({
      student: result.student,
      parent: result.parent,
      invitationCreated: result.invitationCreated,
      invitationExpiresInMinutes: result.invitationExpiresInMinutes
    });
  }));

  router.post('/counsellors/invite', validate(counsellorSchema), asyncHandler(async (req, res) => {
    const result = await provisionCounsellor(models, req.body, req.user.id, deliverInvitation);
    res.status(201).json(result);
  }));

  router.patch('/users/:userId/status', validate(statusSchema), asyncHandler(async (req, res) => {
    const user = await updateManagedUserStatus(models, req.params.userId, req.body.active, req.user.id);
    res.json({ user });
  }));

  return router;
}
