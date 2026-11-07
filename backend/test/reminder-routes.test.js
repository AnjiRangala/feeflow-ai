import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/auth.js';
import { loadConfig } from '../src/config/env.js';

const config = {
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
  JWT_EXPIRES_IN: '2h',
  OTP_HMAC_SECRET: 'test-otp-secret-that-is-long-enough-123456',
  OTP_EXPIRES_MINUTES: 5,
  REMINDER_SCHEDULE_OFFSETS_DAYS: [3, 0, -3, -7, -15],
  REMINDER_CATCH_UP_WINDOW_MS: 86_400_000,
  REMINDER_RETRY_DELAYS_MS: [60_000, 300_000, 900_000],
  REMINDER_POLL_INTERVAL_MS: 60_000
};

function createHarness() {
  const users = [
    { _id: 'accounts-id', id: 'accounts-id', role: 'accounts', isActive: true },
    {
      _id: 'parent-id',
      id: 'parent-id',
      role: 'parent',
      studentId: 'STU-1',
      phone: '+910000000001',
      preferredLanguage: 'en',
      isActive: true
    }
  ];
  const reminders = [{
    _id: '64b000000000000000000001',
    studentId: 'STU-1',
    studentName: 'Student One',
    recipient: '+910000000001',
    installmentId: '64b000000000000000000002',
    scheduledAt: new Date('2026-11-07T00:00:00.000Z'),
    language: 'en',
    message: 'Dear Parent',
    outstandingAmountPaise: 3_000_000,
    status: 'failed',
    attempts: 1,
    failureReason: 'Provider unavailable',
    nextAttemptAt: new Date('2026-11-07T00:01:00.000Z')
  }];
  const findQuery = (resolve) => ({
    sort() { return this; },
    lean: async () => typeof resolve === 'function' ? resolve() : resolve
  });
  const User = {
    findById: async (id) => users.find((user) => user._id === id) ?? null,
    findOneAndUpdate: async (filter, update) => {
      const user = users.find((entry) => entry._id === filter._id && entry.role === filter.role);
      if (!user) return null;
      Object.assign(user, update.$set);
      return user;
    },
    findOne: (filter) => findQuery(users.find((user) =>
      user.role === filter.role && user.studentId === filter.studentId
    ) ?? null)
  };
  const Reminder = {
    find: (filter = {}) => findQuery(reminders.filter((reminder) =>
      !filter.status || reminder.status === filter.status
    )),
    findById: (id) => findQuery(reminders.find((reminder) => reminder._id === id) ?? null),
    findOneAndUpdate: (filter, update) => ({
      exec: async () => {
        const reminder = reminders.find((entry) => entry._id === filter._id && entry.status === filter.status);
        if (!reminder) return null;
        Object.assign(reminder, update.$set);
        for (const [key, increment] of Object.entries(update.$inc ?? {})) {
          reminder[key] = (reminder[key] ?? 0) + increment;
        }
        return reminder;
      }
    }),
    updateOne: (filter, update) => ({
      exec: async () => {
        const reminder = reminders.find((entry) => entry._id === filter._id && entry.status === filter.status);
        if (!reminder) return { matchedCount: 0 };
        Object.assign(reminder, update.$set);
        return { matchedCount: 1 };
      }
    })
  };
  const models = {
    User,
    Reminder,
    Student: {
      find: () => findQuery([]),
      findOne: (filter) => findQuery(filter.studentId === 'STU-1'
        ? { studentId: 'STU-1', name: 'Student One', parentPhone: '+910000000001', isActive: true }
        : null)
    },
    FeePlan: {
      find: () => findQuery([]),
      findOne: (filter) => findQuery(filter.studentId === 'STU-1'
        ? {
          installments: [{
            _id: '64b000000000000000000002',
            dueDate: new Date('2026-11-10T00:00:00.000Z'),
            amountPaise: 3_000_000,
            paidAmountPaise: 0
          }]
        }
        : null)
    },
    Payment: {},
    OtpChallenge: {},
    connection: { readyState: 1 }
  };
  const app = createApp({
    config,
    models,
    deliverOtp: async () => {},
    logOtp: () => {},
    messageProvider: { send: async () => ({ accepted: true, provider: 'mock' }) },
    auditLog: () => {}
  });
  const tokenFor = (id) => signAccessToken(users.find((user) => user._id === id), config.JWT_SECRET, '2h');
  return { app, tokenFor, reminders, users };
}

test('parents can read and update preferred language while accounts-only center remains protected', async () => {
  const { app, tokenFor, users } = createHarness();
  const parentToken = tokenFor('parent-id');
  const accountsToken = tokenFor('accounts-id');

  assert.equal((await request(app).get('/api/reminders').set('Authorization', `Bearer ${parentToken}`)).status, 403);
  assert.equal((await request(app).get('/api/reminders/preferences').set('Authorization', `Bearer ${parentToken}`)).body.preferredLanguage, 'en');
  const updated = await request(app)
    .post('/api/reminders/preferences')
    .set('Authorization', `Bearer ${parentToken}`)
    .send({ preferredLanguage: 'hi' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preferredLanguage, 'hi');
  assert.equal(users.find(({ id }) => id === 'parent-id').preferredLanguage, 'hi');

  const center = await request(app).get('/api/reminders').set('Authorization', `Bearer ${accountsToken}`);
  assert.equal(center.status, 200);
  assert.equal(center.body.reminders.length, 1);
  assert.equal(center.body.reminders[0].studentName, 'Student One');
});

test('accounts can retry a failed reminder and the parent cannot invoke processing', async () => {
  const { app, tokenFor, reminders } = createHarness();
  const accountsToken = tokenFor('accounts-id');
  const parentToken = tokenFor('parent-id');
  assert.equal((await request(app).post('/api/reminders/process')
    .set('Authorization', `Bearer ${parentToken}`)).status, 403);

  const retried = await request(app)
    .post(`/api/reminders/${reminders[0]._id}/retry`)
    .set('Authorization', `Bearer ${accountsToken}`);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.result.sent, 1);
  assert.equal(reminders[0].status, 'sent');
});

test('reminder schedule is configurable and rejects duplicate or out-of-range offsets', () => {
  const base = {
    MONGO_URI: 'mongodb://127.0.0.1:27017/feeflow_test',
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
    OTP_HMAC_SECRET: 'test-otp-secret-that-is-long-enough-123456'
  };
  assert.deepEqual(loadConfig({
    ...base,
    REMINDER_SCHEDULE_OFFSETS_DAYS: '5,0,-2'
  }).REMINDER_SCHEDULE_OFFSETS_DAYS, [5, 0, -2]);
  assert.throws(() => loadConfig({
    ...base,
    REMINDER_SCHEDULE_OFFSETS_DAYS: '3,3'
  }), /Invalid environment configuration/);
  assert.throws(() => loadConfig({
    ...base,
    REMINDER_SCHEDULE_OFFSETS_DAYS: '400'
  }), /Invalid environment configuration/);
});
