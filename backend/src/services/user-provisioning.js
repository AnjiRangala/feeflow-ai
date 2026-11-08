import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import {
  createInvitationToken,
  hashInvitationToken,
  hashPassword,
  toPublicUser
} from '../lib/auth.js';

const INVITATION_MINUTES = 60 * 24;

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function ensureCreated(value, label) {
  if (!value) throw new AppError(500, `${label} could not be created`);
  return value;
}

async function createInvitation(models, user, createdBy, deliverInvitation) {
  const token = createInvitationToken();
  const invitation = await models.Invitation.create({
    userId: user.id ?? user._id.toString(),
    email: user.email,
    role: user.role,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(Date.now() + INVITATION_MINUTES * 60_000),
    createdBy
  });
  try {
    await deliverInvitation(user.email, token, INVITATION_MINUTES, user.role);
  } catch (error) {
    await models.Invitation.deleteOne({ _id: invitation._id });
    await models.User.deleteOne({ _id: user._id });
    throw error;
  }
}

export async function listManagedUsers(User) {
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  return users.map(toPublicUser);
}

export async function provisionCounsellor(models, input, createdBy, deliverInvitation) {
  const email = normalizeEmail(input.email);
  const existing = await models.User.findOne({ email });
  if (existing) throw new AppError(409, 'An account with that email already exists');

  const user = ensureCreated(await models.User.create({
    name: input.name.trim(),
    email,
    phone: input.phone.trim(),
    passwordHash: await hashPassword(randomBytes(32).toString('hex')),
    role: 'counsellor',
    studentId: null,
    isActive: false
  }), 'Counsellor account');

  await createInvitation(models, user, createdBy, deliverInvitation);
  return { user: toPublicUser(user), invitationExpiresInMinutes: INVITATION_MINUTES };
}

export async function registerStudentWithParent(models, input, createdBy, deliverInvitation) {
  const studentId = input.studentId.trim();
  const parentEmail = normalizeEmail(input.parent.email);
  if (await models.Student.findOne({ studentId })) {
    throw new AppError(409, 'A student with that ID already exists');
  }

  const existingParent = await models.User.findOne({ email: parentEmail });
  if (existingParent && (existingParent.role !== 'parent' || existingParent.studentId)) {
    throw new AppError(409, 'That parent email is already linked to an account');
  }

  const student = ensureCreated(await models.Student.create({
    studentId,
    name: input.name.trim(),
    batch: input.batch.trim(),
    centre: input.centre.trim(),
    parentPhone: input.parent.phone.trim(),
    parentEmail,
    isActive: true
  }), 'Student');

  let parent = existingParent;
  let invitationCreated = false;
  if (parent) {
    parent.studentId = student.studentId;
    parent.phone = input.parent.phone.trim();
    parent.isActive = true;
    await parent.save?.();
    if (!parent.save) {
      await models.User.updateOne({ _id: parent._id }, {
        $set: { studentId: student.studentId, phone: input.parent.phone.trim(), isActive: true }
      });
    }
  } else {
    parent = ensureCreated(await models.User.create({
      name: input.parent.name.trim(),
      email: parentEmail,
      phone: input.parent.phone.trim(),
      passwordHash: await hashPassword(randomBytes(32).toString('hex')),
      role: 'parent',
      studentId: student.studentId,
      isActive: false
    }), 'Parent account');
    await createInvitation(models, parent, createdBy, deliverInvitation);
    invitationCreated = true;
  }

  return {
    student,
    parent: toPublicUser(parent),
    invitationCreated,
    invitationExpiresInMinutes: invitationCreated ? INVITATION_MINUTES : null
  };
}

export async function updateManagedUserStatus(models, userId, active, actorId) {
  if (userId === actorId && !active) throw new AppError(400, 'You cannot deactivate your own account');
  const user = await models.User.findByIdAndUpdate(
    userId,
    { $set: { isActive: active } },
    { new: true, runValidators: true }
  );
  if (!user) throw new AppError(404, 'User account not found');
  return toPublicUser(user);
}

export async function activateInvitedUser(models, token, password) {
  const invitationQuery = models.Invitation.findOne({
    tokenHash: hashInvitationToken(token),
    expiresAt: { $gt: new Date() },
    usedAt: null
  });
  const invitation = typeof invitationQuery?.select === 'function'
    ? await invitationQuery.select('+tokenHash')
    : await invitationQuery;
  if (!invitation) throw new AppError(400, 'This invitation is invalid or expired');
  const user = await models.User.findById(invitation.userId);
  if (!user) throw new AppError(400, 'This invitation is invalid or expired');
  user.passwordHash = await hashPassword(password);
  user.isActive = true;
  await user.save?.();
  if (!user.save) {
    await models.User.updateOne({ _id: user._id }, { $set: { passwordHash: user.passwordHash, isActive: true } });
  }
  await models.Invitation.updateOne({ _id: invitation._id }, { $set: { usedAt: new Date() } });
  return toPublicUser(user);
}
