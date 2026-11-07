import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  comparePassword,
  createOtp,
  digestOtp,
  otpMatches,
  signAccessToken,
  toPublicUser
} from '../lib/auth.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validation.js';
import { createAuthenticate } from '../middleware/authenticate.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();

const verifyOtpSchema = z.object({
  challengeId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid verification challenge'),
  code: z.string().regex(/^\d{6}$/, 'Verification code must contain six digits')
}).strict();

export function createAuthRouter({ User, OtpChallenge, config, deliverOtp, logOtp = console.info }) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' }
  });

  router.post('/login', limiter, validate(loginSchema), asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select('+passwordHash');
    if (!user?.isActive || !(await comparePassword(req.body.password, user.passwordHash))) {
      throw new AppError(401, 'Invalid email or password');
    }

    const code = createOtp();
    const challenge = await OtpChallenge.create({
      userId: user._id,
      otpHash: digestOtp(code, config.OTP_HMAC_SECRET),
      expiresAt: new Date(Date.now() + config.OTP_EXPIRES_MINUTES * 60_000),
      attempts: 0
    });

    try {
      if (config.NODE_ENV === 'development') {
        logOtp(`FeeFlow AI development OTP for ${user.email}: ${code}`);
      } else {
        await deliverOtp(user.email, code, config.OTP_EXPIRES_MINUTES);
      }
    } catch (error) {
      await OtpChallenge.deleteOne({ _id: challenge._id });
      throw error;
    }

    res.status(202).json({
      challengeId: challenge._id.toString(),
      message: 'Verification code sent'
    });
  }));

  router.post('/verify-otp', limiter, validate(verifyOtpSchema), asyncHandler(async (req, res) => {
    const { challengeId, code } = req.body;
    const challenge = await OtpChallenge.findOne({
      _id: challengeId,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 }
    }).select('+otpHash');

    if (!challenge) throw new AppError(401, 'Invalid or expired verification code');

    if (!otpMatches(code, challenge.otpHash, config.OTP_HMAC_SECRET)) {
      const updated = await OtpChallenge.findOneAndUpdate(
        { _id: challengeId, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      if (updated?.attempts >= 5) await OtpChallenge.deleteOne({ _id: challengeId });
      throw new AppError(401, 'Invalid or expired verification code');
    }

    const consumed = await OtpChallenge.findOneAndDelete({
      _id: challengeId,
      otpHash: challenge.otpHash,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 }
    });
    if (!consumed) throw new AppError(401, 'Invalid or expired verification code');

    const user = await User.findById(consumed.userId);
    if (!user?.isActive) throw new AppError(401, 'Account is unavailable');

    res.json({
      accessToken: signAccessToken(user, config.JWT_SECRET, config.JWT_EXPIRES_IN),
      user: toPublicUser(user)
    });
  }));

  const authenticate = createAuthenticate({ User, jwtSecret: config.JWT_SECRET });
  router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

  return router;
}
