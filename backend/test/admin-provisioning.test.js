import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/auth.js';

const config = {
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
  JWT_EXPIRES_IN: '2h',
  OTP_HMAC_SECRET: 'test-otp-secret-that-is-long-enough-123456',
  OTP_EXPIRES_MINUTES: 5
};

function query(value) {
  return {
    sort() { return this; },
    limit() { return this; },
    lean: async () => value,
    select: async () => value
  };
}

function createHarness() {
  const users = [
    { _id: 'accounts-id', id: 'accounts-id', name: 'Accounts', email: 'accounts@example.test', phone: '9000000000', role: 'accounts', studentId: null, isActive: true },
    { _id: 'parent-id', id: 'parent-id', name: 'Existing Parent', email: 'parent@example.test', phone: '9000000001', role: 'parent', studentId: 'STU-1', isActive: true }
  ];
  const students = [];
  const invitations = [];
  let nextId = 1;
  const User = {
    find: () => query(users),
    findOne: async (filter) => users.find((user) => user.email === filter.email) ?? null,
    findById: async (id) => users.find((user) => user._id === id) ?? null,
    create: async (user) => {
      const id = `user-${nextId++}`;
      const created = { ...user, _id: id, id };
      users.push(created);
      return created;
    },
    updateOne: async (filter, update) => {
      const user = users.find((entry) => entry._id === filter._id);
      if (user) Object.assign(user, update.$set);
      return { modifiedCount: user ? 1 : 0 };
    },
    findByIdAndUpdate: async (id, update) => {
      const user = users.find((entry) => entry._id === id);
      if (!user) return null;
      Object.assign(user, update.$set);
      return user;
    }
  };
  const Student = {
    findOne: async (filter) => students.find((student) => student.studentId === filter.studentId) ?? null,
    create: async (student) => {
      const created = { ...student, _id: `student-${nextId++}` };
      students.push(created);
      return created;
    }
  };
  const Invitation = {
    create: async (invitation) => {
      const created = { usedAt: null, ...invitation, _id: `invitation-${nextId++}` };
      invitations.push(created);
      return created;
    },
    findOne: (filter) => query(invitations.find((entry) =>
      entry.tokenHash === filter.tokenHash && entry.usedAt === filter.usedAt
    ) ?? null),
    updateOne: async () => ({ modifiedCount: 1 })
  };
  const app = createApp({
    config,
    models: { User, Student, Invitation, OtpChallenge: {}, connection: { readyState: 1 } },
    deliverOtp: async () => {},
    deliverInvitation: async (email, token) => invitations.push({ deliveredTo: email, token }),
    logOtp: () => {}
  });
  return {
    app,
    users,
    students,
    invitations,
    tokenFor: (user) => signAccessToken(user, config.JWT_SECRET, config.JWT_EXPIRES_IN)
  };
}

test('accounts can register a student, create a linked parent invitation, and list safe users', async () => {
  const harness = createHarness();
  const authorization = `Bearer ${harness.tokenFor(harness.users[0])}`;
  const response = await request(harness.app)
    .post('/api/admin/students')
    .set('Authorization', authorization)
    .send({
      studentId: 'STU-NEW',
      name: 'New Student',
      batch: 'JEE 2028',
      centre: 'Jaipur',
      parent: { name: 'New Parent', email: 'new-parent@example.test', phone: '9000000002' }
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.parent.role, 'parent');
  assert.equal(response.body.parent.studentId, 'STU-NEW');
  assert.equal('passwordHash' in response.body.parent, false);
  assert.equal(harness.students.length, 1);
  assert.equal(harness.invitations.some((entry) => entry.deliveredTo === 'new-parent@example.test'), true);

  const users = await request(harness.app).get('/api/admin/users').set('Authorization', authorization);
  assert.equal(users.status, 200);
  assert.equal(users.body.users.some((user) => user.email === 'new-parent@example.test'), true);
  assert.equal(users.body.users.some((user) => 'passwordHash' in user), false);
});

test('duplicate student and parent records are rejected', async () => {
  const harness = createHarness();
  const authorization = `Bearer ${harness.tokenFor(harness.users[0])}`;
  const input = {
    studentId: 'STU-DUP',
    name: 'Duplicate Student',
    batch: 'JEE 2028',
    centre: 'Jaipur',
    parent: { name: 'Duplicate Parent', email: 'duplicate@example.test', phone: '9000000003' }
  };
  assert.equal((await request(harness.app).post('/api/admin/students').set('Authorization', authorization).send(input)).status, 201);
  assert.equal((await request(harness.app).post('/api/admin/students').set('Authorization', authorization).send(input)).status, 409);
  assert.equal((await request(harness.app).post('/api/admin/counsellors/invite').set('Authorization', authorization).send({
    name: 'Existing', email: 'duplicate@example.test', phone: '9000000004'
  })).status, 409);
});

test('accounts can invite counsellors and invited users can activate without token disclosure', async () => {
  const harness = createHarness();
  const authorization = `Bearer ${harness.tokenFor(harness.users[0])}`;
  const response = await request(harness.app)
    .post('/api/admin/counsellors/invite')
    .set('Authorization', authorization)
    .send({ name: 'New Counsellor', email: 'new-counsellor@example.test', phone: '9000000006' });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'counsellor');
  assert.equal('token' in response.body, false);
  const delivered = harness.invitations.find((entry) => entry.deliveredTo === 'new-counsellor@example.test');
  assert.ok(delivered?.token);

  const activation = await request(harness.app)
    .post('/api/auth/activate')
    .send({ token: delivered.token, password: 'new-counsellor-password-2026' });
  assert.equal(activation.status, 200);
  assert.equal(activation.body.user.isActive, true);
  assert.equal('passwordHash' in activation.body.user, false);
});

test('parents cannot provision users or access admin routes', async () => {
  const harness = createHarness();
  const authorization = `Bearer ${harness.tokenFor(harness.users[1])}`;
  const response = await request(harness.app)
    .post('/api/admin/counsellors/invite')
    .set('Authorization', authorization)
    .send({ name: 'Blocked', email: 'blocked@example.test', phone: '9000000005' });
  assert.equal(response.status, 403);
});
