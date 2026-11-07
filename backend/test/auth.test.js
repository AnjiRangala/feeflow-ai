import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/auth.js';
import { createAuthenticate, requireRole } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createSmtpTransportOptions } from '../src/services/otp-delivery.js';

const config = {
  NODE_ENV: 'development',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
  JWT_EXPIRES_IN: '2h',
  OTP_HMAC_SECRET: 'test-otp-secret-that-is-long-enough-123456',
  OTP_EXPIRES_MINUTES: 5
};

async function createHarness({ runtimeConfig = config, deliverOtp = async () => {} } = {}) {
  const parent = {
    _id: '64b000000000000000000001',
    id: '64b000000000000000000001',
    name: 'Ishita Sharma Parent',
    email: 'parent0587@feeflow.demo',
    phone: '+919000000587',
    role: 'parent',
    studentId: 'STU-0587',
    isActive: true,
    passwordHash: await hashPassword('qa_parent_fixture_only_2026'),
  };
  const accounts = {
    _id: '64b000000000000000000002',
    id: '64b000000000000000000002',
    name: 'Accounts Executive',
    email: 'accounts@feeflow.demo',
    phone: '+919000000140',
    role: 'accounts',
    studentId: null,
    isActive: true,
    passwordHash: await hashPassword('qa_accounts_fixture_only_2026'),
  };
  const counsellor = {
    _id: '64b000000000000000000003',
    id: '64b000000000000000000003',
    name: 'Counsellor',
    email: 'counsellor@feeflow.demo',
    phone: '+919000000141',
    role: 'counsellor',
    studentId: null,
    isActive: true,
    passwordHash: await hashPassword('qa_counsellor_fixture_only_2026')
  };
  const users = [parent, accounts, counsellor];
  const challenges = new Map();
  let nextChallenge = 1;

  const User = {
    findOne: (query) => ({
      select: async () => users.find((user) => user.email === query.email) ?? null
    }),
    findById: async (id) => users.find((user) => user._id === id) ?? null
  };

  const OtpChallenge = {
    create: async (data) => {
      const challenge = { ...data, _id: `64c00000000000000000000${nextChallenge++}` };
      challenges.set(challenge._id, challenge);
      return challenge;
    },
    findOne: (query) => ({
      select: async () => {
        const challenge = challenges.get(query._id);
        if (!challenge || challenge.expiresAt <= query.expiresAt.$gt || challenge.attempts >= query.attempts.$lt) {
          return null;
        }
        return challenge;
      }
    }),
    findOneAndUpdate: async (query) => {
      const challenge = challenges.get(query._id);
      if (!challenge || challenge.attempts >= query.attempts.$lt) return null;
      challenge.attempts += 1;
      return challenge;
    },
    findOneAndDelete: async (query) => {
      const challenge = challenges.get(query._id);
      if (!challenge || challenge.otpHash !== query.otpHash ||
          challenge.expiresAt <= query.expiresAt.$gt || challenge.attempts >= query.attempts.$lt) {
        return null;
      }
      challenges.delete(query._id);
      return challenge;
    },
    deleteOne: async ({ _id }) => ({ deletedCount: Number(challenges.delete(_id)) })
  };
  const loggedOtps = [];
  const app = createApp({
    config: runtimeConfig,
    models: { User, OtpChallenge, connection: { readyState: 1 } },
    deliverOtp,
    logOtp: (message) => loggedOtps.push(message)
  });

  return { app, challenges, loggedOtps, User };
}

function createAccountsOnlyApp(User) {
  const app = express();
  const authenticate = createAuthenticate({ User, jwtSecret: config.JWT_SECRET });
  app.get('/accounts', authenticate, requireRole('accounts'), (req, res) => {
    res.json({ access: 'accounts' });
  });
  app.use(errorHandler);
  return app;
}

test('parent login verifies OTP, exposes safe profile, and is denied accounts access', async () => {
  const { app, challenges, loggedOtps, User } = await createHarness();
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'PARENT0587@FEEFLOW.DEMO', password: 'qa_parent_fixture_only_2026' });

  assert.equal(login.status, 202);
  assert.equal(typeof login.body.challengeId, 'string');
  assert.equal('code' in login.body, false);
  assert.match(loggedOtps[0], /FeeFlow AI development OTP/);

  const challenge = challenges.get(login.body.challengeId);
  assert.ok(challenge.otpHash);
  assert.equal('code' in challenge, false);
  const otp = loggedOtps[0].match(/: (\d{6})$/)[1];
  const wrongCodeValue = otp === '000000' ? '000001' : '000000';

  const wrongCode = await request(app)
    .post('/api/auth/verify-otp')
    .send({ challengeId: login.body.challengeId, code: wrongCodeValue });
  assert.equal(wrongCode.status, 401);

  const verified = await request(app)
    .post('/api/auth/verify-otp')
    .send({ challengeId: login.body.challengeId, code: otp });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.role, 'parent');
  assert.equal(verified.body.user.studentId, 'STU-0587');
  assert.equal('passwordHash' in verified.body.user, false);

  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${verified.body.accessToken}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'parent0587@feeflow.demo');
  assert.equal('passwordHash' in me.body.user, false);

  const restricted = await request(createAccountsOnlyApp(User))
    .get('/accounts')
    .set('Authorization', `Bearer ${verified.body.accessToken}`);
  assert.equal(restricted.status, 403);

  const replay = await request(app)
    .post('/api/auth/verify-otp')
    .send({ challengeId: login.body.challengeId, code: otp });
  assert.equal(replay.status, 401);
});

test('accounts login receives accounts access and invalid credentials are rejected', async () => {
  const { app, loggedOtps, User } = await createHarness();
  const invalid = await request(app)
    .post('/api/auth/login')
    .send({ email: 'accounts@feeflow.demo', password: 'incorrect-password' });
  assert.equal(invalid.status, 401);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'accounts@feeflow.demo', password: 'qa_accounts_fixture_only_2026' });
  assert.equal(login.status, 202);

  const code = loggedOtps[0].match(/: (\d{6})$/)[1];
  const verification = await request(app)
    .post('/api/auth/verify-otp')
    .send({ challengeId: login.body.challengeId, code });
  assert.equal(verification.status, 200);
  assert.equal(verification.body.user.role, 'accounts');

  const access = await request(createAccountsOnlyApp(User))
    .get('/accounts')
    .set('Authorization', `Bearer ${verification.body.accessToken}`);
  assert.equal(access.status, 200);
  assert.equal(access.body.access, 'accounts');
});

test('counsellor login receives a counsellor role for human review workflows', async () => {
  const { app, loggedOtps } = await createHarness();
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'counsellor@feeflow.demo', password: 'qa_counsellor_fixture_only_2026' });
  assert.equal(login.status, 202);

  const code = loggedOtps[0].match(/: (\d{6})$/)[1];
  const verification = await request(app)
    .post('/api/auth/verify-otp')
    .send({ challengeId: login.body.challengeId, code });
  assert.equal(verification.status, 200);
  assert.equal(verification.body.user.role, 'counsellor');
  assert.equal(verification.body.user.studentId, null);
});

test('request validation and authentication guard reject malformed and anonymous requests', async () => {
  const { app } = await createHarness();
  const malformed = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
  assert.equal(malformed.status, 400);

  const malformedJson = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{invalid-json');
  assert.equal(malformedJson.status, 400);
  assert.equal(malformedJson.body.error, 'Invalid JSON body');

  const anonymous = await request(app).get('/api/auth/me');
  assert.equal(anonymous.status, 401);
});

test('invalid and expired JWTs are rejected by protected routes', async () => {
  const { app } = await createHarness();
  const invalid = await request(app)
    .get('/api/auth/me')
    .set('Authorization', 'Bearer not-a-valid-jwt');
  assert.equal(invalid.status, 401);

  const expired = jwt.sign({ sub: '64b000000000000000000002', role: 'accounts' }, config.JWT_SECRET, {
    expiresIn: -1
  });
  const expiredResponse = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${expired}`);
  assert.equal(expiredResponse.status, 401);
});

test('production OTP is delivered but never logged or returned', async () => {
  const deliveries = [];
  const { app, challenges, loggedOtps } = await createHarness({
    runtimeConfig: { ...config, NODE_ENV: 'production' },
    deliverOtp: async (email, code) => deliveries.push({ email, code })
  });

  test('SMTP requires STARTTLS unless implicit TLS is enabled', () => {
    const base = {
      SMTP_HOST: 'mail.example.test',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: '',
      SMTP_PASSWORD: ''
    };
    assert.equal(createSmtpTransportOptions(base).requireTLS, true);
    assert.equal(createSmtpTransportOptions({ ...base, SMTP_SECURE: true }).requireTLS, false);
  });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'accounts@feeflow.demo', password: 'qa_accounts_fixture_only_2026' });

  assert.equal(login.status, 202);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].email, 'accounts@feeflow.demo');
  assert.equal(loggedOtps.length, 0);
  assert.equal('code' in login.body, false);
  assert.notEqual(challenges.get(login.body.challengeId).otpHash, deliveries[0].code);
});
