import assert from 'node:assert/strict';
import test from 'node:test';
import { demoParents, demoAccountsUser } from '../src/demo-seed-data.js';
import { Payment } from '../src/models/index.js';
import { startLiveMongoApp } from './live-mongodb-helpers.js';

test('real MongoDB demo authentication, JWT, role access, and parent isolation', async () => {
  const runtime = await startLiveMongoApp();
  try {
    const health = await runtime.call('/health');
    assert.equal(health.status, 200);
    assert.equal(health.payload.database, 'connected');

    const parents = [];
    for (const parent of demoParents) {
      const session = await runtime.login(parent.email, process.env.DEMO_PARENT_PASSWORD);
      parents.push({ fixture: parent, session });
      assert.equal(session.user.role, 'parent');
      assert.equal(session.user.studentId, parent.studentId);
      const identity = await runtime.call('/auth/me', { token: session.accessToken });
      assert.equal(identity.status, 200);
      assert.equal(identity.payload.user.role, 'parent');
    }
    const accounts = await runtime.login(demoAccountsUser.email, process.env.DEMO_ACCOUNTS_PASSWORD);
    assert.equal(accounts.user.role, 'accounts');
    assert.equal((await runtime.call('/auth/me', { token: accounts.accessToken })).status, 200);

    const wrongPassword = (password) => `${password[0] === 'x' ? 'y' : 'x'}${password.slice(1)}`;
    assert.equal((await runtime.call('/auth/login', {
      method: 'POST',
      body: { email: demoParents[0].email, password: wrongPassword(process.env.DEMO_PARENT_PASSWORD) }
    })).status, 401);
    assert.equal((await runtime.call('/auth/login', {
      method: 'POST',
      body: { email: demoAccountsUser.email, password: wrongPassword(process.env.DEMO_ACCOUNTS_PASSWORD) }
    })).status, 401);
    assert.equal((await runtime.call('/fees/students')).status, 401);
    assert.equal((await runtime.call('/auth/me', { token: 'not.a.valid.jwt' })).status, 401);

    for (const { fixture, session } of parents) {
      const listing = await runtime.call('/fees/students', { token: session.accessToken });
      assert.equal(listing.status, 200);
      assert.deepEqual(listing.payload.students.map(({ student }) => student.studentId), [fixture.studentId]);
      assert.equal((await runtime.call(`/fees/student/${fixture.studentId}`, {
        token: session.accessToken
      })).status, 200);
      assert.equal((await runtime.call('/fees/dashboard', { token: session.accessToken })).status, 403);
      assert.equal((await runtime.call('/refunds', { token: session.accessToken })).status, 403);
      assert.equal((await runtime.call('/risks/tasks', { token: session.accessToken })).status, 403);
      assert.equal((await runtime.call('/payments/record', {
        method: 'POST',
        token: session.accessToken,
        body: {
          studentId: 'STU-0773',
          installmentNumber: 1,
          amountPaise: 1,
          transactionId: `QA-CROSS-STUDENT-${fixture.studentId}`,
          paymentMethod: 'upi'
        }
      })).status, 403);
    }

    const parentA = parents[0];
    const parentB = parents[1];
    assert.equal((await runtime.call(`/fees/student/${parentB.fixture.studentId}`, {
      token: parentA.session.accessToken
    })).status, 403);
    const otherPayment = await Payment.findOne({
      studentId: parentB.fixture.studentId,
      status: 'completed'
    }).select('_id').lean();
    assert.ok(otherPayment);
    assert.equal((await runtime.call(`/parent-payments/receipts/${otherPayment._id}`, {
      token: parentA.session.accessToken
    })).status, 404);
    const ownPayment = await Payment.findOne({
      studentId: parentA.fixture.studentId,
      status: 'completed'
    }).select('_id').lean();
    assert.ok(ownPayment);
    assert.equal((await runtime.call(`/parent-payments/receipts/${ownPayment._id}`, {
      token: parentA.session.accessToken
    })).status, 200);
    assert.equal((await runtime.call('/parent-payments/orders', {
      method: 'POST',
      token: parentA.session.accessToken,
      body: { installmentNumber: 1, studentId: parentB.fixture.studentId }
    })).status, 400);

    console.info(JSON.stringify({
      workflow: 'authentication-and-parent-isolation',
      result: 'PASS',
      parentAccounts: parents.length,
      accountsExecutives: 1,
      jwtValidation: 'passed',
      authorizationChecks: 'passed',
      crossParentLedgerAndReceiptDenials: 'passed'
    }));
  } finally {
    await runtime.close();
  }
});
