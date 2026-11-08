import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const PASSWORD_ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, PASSWORD_ROUNDS);
}

export function createInvitationToken() {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function comparePassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function createOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function digestOtp(code, secret) {
  return createHmac('sha256', secret).update(code).digest('hex');
}

export function otpMatches(code, expectedDigest, secret) {
  const actual = Buffer.from(digestOtp(code, secret), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signAccessToken(user, secret, expiresIn) {
  return jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn });
}

export function verifyAccessToken(token, secret) {
  return jwt.verify(token, secret);
}

export function toPublicUser(user) {
  return {
    id: user.id ?? user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    studentId: user.studentId ?? null,
    preferredLanguage: user.preferredLanguage === 'hi' ? 'hi' : 'en',
    isActive: user.isActive
  };
}
