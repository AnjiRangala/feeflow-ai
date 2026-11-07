import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchDueReminders,
  formatReminderMessage,
  processReminderCycle,
  scheduleInstallmentReminders
} from '../src/services/reminders.js';

const offsetsDays = [3, 0, -3, -7, -15];
const dueDate = new Date('2026-11-10T00:00:00.000Z');

function createHarness({
  paidAmountPaise = 0,
  language = 'en',
  provider,
  failureDelaysMs = [1000, 5000]
} = {}) {
  const student = {
    studentId: 'STU-1',
    name: 'Student One',
    parentPhone: '+910000000001',
    parentEmail: 'parent@example.test',
    isActive: true
  };
  const parent = {
    _id: 'parent-id',
    studentId: 'STU-1',
    phone: '+910000000001',
    preferredLanguage: language,
    role: 'parent',
    isActive: true
  };
  const installment = {
    _id: 'installment-id',
    installmentNumber: 1,
    dueDate,
    amountPaise: 3_000_000,
    paidAmountPaise,
    payments: []
  };
  const plan = {
    studentId: 'STU-1',
    installments: [installment]
  };
  const reminders = [];
  let nextId = 1;
  const id = () => `reminder-${nextId++}`;
  const matches = (entry, filter = {}) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(entry, branch));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$in' in value) return value.$in.includes(entry[key]);
      if ('$lte' in value && !(entry[key] <= value.$lte)) return false;
      if ('$gt' in value && !(entry[key] > value.$gt)) return false;
      if ('$ne' in value && entry[key] === value.$ne) return false;
      return true;
    }
    return entry[key] === value;
  });
  const apply = (entry, update) => {
    Object.assign(entry, update.$set ?? {});
    for (const [key, increment] of Object.entries(update.$inc ?? {})) {
      entry[key] = (entry[key] ?? 0) + increment;
    }
  };
  class Reminder {
    constructor(data) {
      Object.assign(this, data, { _id: id() });
    }
    async save() {
      const existing = reminders.find(({ idempotencyKey }) => idempotencyKey === this.idempotencyKey);
      if (existing) return existing;
      reminders.push(this);
      return this;
    }
    static find(filter) {
      const query = {
        sort() { return this; },
        lean: async () => reminders.filter((entry) => matches(entry, filter))
      };
      return query;
    }
    static updateOne(filter, update) {
      return {
        exec: async () => {
          const entry = reminders.find((candidate) => matches(candidate, filter));
          if (!entry && update.$setOnInsert) {
            const created = new Reminder(update.$setOnInsert);
            reminders.push(created);
            return { upsertedCount: 1, matchedCount: 0 };
          }
          if (!entry) return { matchedCount: 0, modifiedCount: 0 };
          apply(entry, update);
          return { matchedCount: 1, modifiedCount: 1 };
        }
      };
    }
    static updateMany(filter, update) {
      return {
        exec: async () => {
          const found = reminders.filter((entry) => matches(entry, filter));
          found.forEach((entry) => apply(entry, update));
          return { matchedCount: found.length, modifiedCount: found.length };
        }
      };
    }
    static findOneAndUpdate(filter, update) {
      return {
        exec: async () => {
          const entry = reminders.find((candidate) => matches(candidate, filter));
          if (!entry) return null;
          apply(entry, update);
          return entry;
        }
      };
    }
    static findById(idValue) {
      return {
        lean: async () => reminders.find((entry) => entry._id === idValue) ?? null
      };
    }
  }
  const query = (value) => ({ lean: async () => value });
  const models = {
    Reminder,
    Student: {
      find: () => query([student]),
      findOne: (filter) => query(filter.studentId === student.studentId ? student : null)
    },
    User: {
      find: () => query([parent]),
      findOne: (filter) => query(filter.studentId === student.studentId ? parent : null)
    },
    FeePlan: {
      find: () => query([plan]),
      findOne: (filter) => query(filter.studentId === plan.studentId ? plan : null)
    }
  };
  const options = {
    now: new Date('2026-11-07T00:00:00.000Z'),
    offsetsDays,
    catchUpWindowMs: 24 * 60 * 60 * 1000,
    retryDelaysMs: failureDelaysMs,
    provider: provider ?? { send: async () => ({ accepted: true }) },
    auditLog: () => {}
  };
  return { models, reminders, installment, student, parent, options };
}

test('schedules and sends the reminder three days before the due date', async () => {
  const harness = createHarness({ language: 'en' });
  harness.options.now = new Date('2026-11-07T00:00:00.000Z');
  await scheduleInstallmentReminders(harness.models, harness.options);
  const sent = await dispatchDueReminders(harness.models, harness.options);
  assert.equal(sent.sent, 1);
  assert.equal(harness.reminders.filter(({ status }) => status === 'sent').length, 1);
  assert.match(harness.reminders.find(({ status }) => status === 'sent').message, /₹30,000/);
});

test('sends a due-date reminder in Hindi using the preferred language', async () => {
  const harness = createHarness({ language: 'hi' });
  harness.options.now = new Date('2026-11-10T00:00:00.000Z');
  await scheduleInstallmentReminders(harness.models, harness.options);
  const sent = await dispatchDueReminders(harness.models, harness.options);
  assert.equal(sent.sent, 1);
  assert.match(harness.reminders.find(({ status }) => status === 'sent').message, /प्रिय अभिभावक/);
  assert.match(harness.reminders.find(({ status }) => status === 'sent').message, /₹30,000/);
});

test('sends only the current overdue reminder after a scheduler catch-up', async () => {
  const harness = createHarness();
  harness.options.now = new Date('2026-11-13T00:00:00.000Z');
  await scheduleInstallmentReminders(harness.models, harness.options);
  const result = await dispatchDueReminders(harness.models, harness.options);
  assert.equal(result.sent, 1);
  const sent = harness.reminders.filter(({ status }) => status === 'sent');
  assert.equal(sent[0].scheduleOffsetDays, -3);
  assert.equal(harness.reminders.filter(({ status }) => status === 'scheduled').length, 2);
});

test('cancels missed reminders outside the catch-up window instead of sending a backlog', async () => {
  const harness = createHarness();
  await scheduleInstallmentReminders(harness.models, harness.options);
  const now = new Date('2026-11-27T00:00:00.000Z');
  const reconciliation = await scheduleInstallmentReminders(harness.models, {
    ...harness.options,
    now
  });
  const dispatch = await dispatchDueReminders(harness.models, { ...harness.options, now });
  assert.equal(dispatch.sent, 0);
  assert.equal(reconciliation.cancelled, 5);
  assert.ok(harness.reminders.every(({ status }) => status === 'cancelled'));
  assert.ok(harness.reminders.every(({ cancellationReason }) =>
    cancellationReason === 'Outside reminder catch-up window'
  ));
});

test('recovers stale in-progress deliveries into the retry flow', async () => {
  const harness = createHarness();
  await scheduleInstallmentReminders(harness.models, harness.options);
  const reminder = harness.reminders.find(({ scheduledAt }) =>
    scheduledAt.getTime() === harness.options.now.getTime()
  );
  reminder.status = 'sending';
  reminder.attempts = 1;
  reminder.lastAttemptAt = new Date(harness.options.now.getTime() - 300_000);
  const result = await processReminderCycle(harness.models, {
    ...harness.options,
    staleSendingTimeoutMs: 300_000
  });
  assert.equal(result.recovered, 1);
  assert.equal(result.sent, 1);
  assert.equal(reminder.status, 'sent');
});

test('fully paid instalments cancel all pending reminders and never dispatch', async () => {
  const harness = createHarness();
  await scheduleInstallmentReminders(harness.models, harness.options);
  harness.installment.paidAmountPaise = harness.installment.amountPaise;
  const reconciliation = await scheduleInstallmentReminders(harness.models, {
    ...harness.options,
    now: new Date('2026-11-08T00:00:00.000Z')
  });
  const dispatch = await dispatchDueReminders(harness.models, {
    ...harness.options,
    now: new Date('2026-11-10T00:00:00.000Z')
  });
  assert.ok(reconciliation.cancelled > 0);
  assert.equal(dispatch.sent, 0);
  assert.ok(harness.reminders.every(({ status }) => status === 'cancelled'));
  assert.ok(harness.reminders.every(({ cancellationReason }) => cancellationReason));
});

test('partial payment refreshes the amount in pending messages', async () => {
  const harness = createHarness();
  await scheduleInstallmentReminders(harness.models, harness.options);
  harness.installment.paidAmountPaise = 1_000_000;
  await scheduleInstallmentReminders(harness.models, {
    ...harness.options,
    now: new Date('2026-11-08T00:00:00.000Z')
  });
  const pending = harness.reminders.find(({ status }) => status === 'scheduled');
  assert.equal(pending.outstandingAmountPaise, 2_000_000);
  assert.match(pending.message, /₹20,000/);
});

test('repeated scheduler runs do not create duplicate reminders', async () => {
  const harness = createHarness();
  await scheduleInstallmentReminders(harness.models, harness.options);
  const count = harness.reminders.length;
  await scheduleInstallmentReminders(harness.models, harness.options);
  assert.equal(harness.reminders.length, count);
});

test('failed mock delivery records failure and succeeds on retry', async () => {
  let fail = true;
  const harness = createHarness({
    provider: {
      send: async () => {
        if (fail) throw new Error('simulated provider failure');
        return { accepted: true };
      }
    }
  });
  harness.options.now = new Date('2026-11-07T00:00:00.000Z');
  await scheduleInstallmentReminders(harness.models, harness.options);
  const first = await dispatchDueReminders(harness.models, harness.options);
  assert.equal(first.failed, 1);
  const failed = harness.reminders.find(({ status }) => status === 'failed');
  assert.equal(failed.failureReason, 'Mock message delivery failed');
  assert.ok(failed.nextAttemptAt > harness.options.now);

  fail = false;
  const retried = await dispatchDueReminders(harness.models, {
    ...harness.options,
    now: failed.nextAttemptAt
  });
  assert.equal(retried.sent, 1);
  assert.equal(failed.status, 'sent');
});

test('formats English and Hindi reminders with remaining amount and due date', () => {
  const common = {
    remainingAmountPaise: 3_000_000,
    dueDate,
    studentName: 'Aarav'
  };
  assert.match(formatReminderMessage({ ...common, language: 'en' }), /₹30,000/);
  assert.match(formatReminderMessage({ ...common, language: 'en' }), /10 November 2026/);
  assert.match(formatReminderMessage({ ...common, language: 'hi' }), /10 नवंबर 2026/);
});
