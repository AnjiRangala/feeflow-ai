import { AppError } from '../lib/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const PENDING_STATUSES = ['scheduled', 'failed'];

export function formatReminderMessage({ language, remainingAmountPaise, dueDate }) {
  const resolvedLanguage = language === 'hi' ? 'hi' : 'en';
  const amount = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: remainingAmountPaise % 100 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(remainingAmountPaise / 100);
  const date = new Intl.DateTimeFormat(resolvedLanguage === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(dueDate));

  if (resolvedLanguage === 'hi') {
    return `प्रिय अभिभावक,\nआपके बच्चे की ${amount} की फीस किस्त ${date} को देय है। कृपया पैरेंट पोर्टल के माध्यम से भुगतान करें।`;
  }
  return `Dear Parent,\nThe instalment payment of ${amount} for your child is due on ${date}. Please complete the payment using your parent portal.`;
}

function assertScheduleOffsets(offsetsDays) {
  if (!Array.isArray(offsetsDays) || offsetsDays.length === 0 ||
      offsetsDays.some((offset) => !Number.isSafeInteger(offset) || Math.abs(offset) > 365) ||
      new Set(offsetsDays).size !== offsetsDays.length) {
    throw new AppError(500, 'Reminder schedule offsets must be unique integer day offsets within one year');
  }
}

function scheduleKey(installment, dueDate, offsetDays) {
  return `${installment._id.toString()}:${new Date(dueDate).getTime()}:${offsetDays}`;
}

function reminderSchedule(installment, offsetsDays) {
  const dueDate = new Date(installment.dueDate);
  return offsetsDays.map((offsetDays) => ({
    offsetDays,
    dueDate,
    scheduledAt: new Date(dueDate.getTime() - offsetDays * DAY_MS),
    idempotencyKey: scheduleKey(installment, dueDate, offsetDays)
  })).sort((left, right) => left.scheduledAt - right.scheduledAt);
}

function parentForStudent(parents, studentId) {
  return parents.find((parent) => parent.studentId === studentId) ?? null;
}

function buildReminderData({ student, parent, installment, scheduled }) {
  const language = parent?.preferredLanguage === 'hi' ? 'hi' : 'en';
  const outstandingAmountPaise = installment.amountPaise - installment.paidAmountPaise;
  return {
    studentId: student.studentId,
    studentName: student.name,
    recipient: parent?.phone ?? student.parentPhone,
    installmentId: installment._id,
    installmentNumber: installment.installmentNumber,
    scheduleOffsetDays: scheduled.offsetDays,
    idempotencyKey: scheduled.idempotencyKey,
    scheduledAt: scheduled.scheduledAt,
    language,
    message: formatReminderMessage({
      language,
      remainingAmountPaise: outstandingAmountPaise,
      dueDate: installment.dueDate
    }),
    outstandingAmountPaise,
    status: 'scheduled'
  };
}

async function updateReminder(Reminder, filter, update, session, options = {}) {
  const query = Reminder.updateOne(filter, update, options);
  if (session && typeof query.session === 'function') query.session(session);
  return query.exec();
}

async function updateReminders(Reminder, filter, update, session) {
  const query = Reminder.updateMany(filter, update);
  if (session && typeof query.session === 'function') query.session(session);
  return query.exec();
}

function recordAudit(auditLog, event, reminder, extra = {}) {
  auditLog({
    event,
    reminderId: reminder?._id?.toString(),
    studentId: reminder?.studentId,
    installmentId: reminder?.installmentId?.toString(),
    status: reminder?.status,
    ...extra
  });
}

export async function syncInstallmentReminders(Reminder, studentId, installment, now, session) {
  if (!Reminder) return;
  const filter = {
    studentId,
    installmentId: installment._id,
    status: { $in: PENDING_STATUSES }
  };

  if (installment.paidAmountPaise === installment.amountPaise) {
    await updateReminders(Reminder, filter, {
      $set: {
        status: 'cancelled',
        cancellationReason: 'Instalment fully paid',
        cancelledAt: now,
        nextAttemptAt: null
      }
    }, session);
    return;
  }

  const pendingQuery = Reminder.find(filter);
  if (session && typeof pendingQuery.session === 'function') pendingQuery.session(session);
  const pending = await pendingQuery.lean();
  for (const reminder of pending) {
    const language = reminder.language === 'hi' ? 'hi' : 'en';
    await updateReminder(Reminder, { _id: reminder._id, status: reminder.status }, {
      $set: {
        outstandingAmountPaise: installment.amountPaise - installment.paidAmountPaise,
        message: formatReminderMessage({
          language,
          remainingAmountPaise: installment.amountPaise - installment.paidAmountPaise,
          dueDate: installment.dueDate
        }),
        nextAttemptAt: reminder.status === 'failed' ? reminder.nextAttemptAt : null
      }
    }, session);
  }
}

export async function scheduleInstallmentReminders(models, {
  now = new Date(),
  offsetsDays = [3, 0, -3, -7, -15],
  catchUpWindowMs = DAY_MS,
  auditLog = () => {}
} = {}) {
  assertScheduleOffsets(offsetsDays);
  const { Reminder, Student, FeePlan, User } = models;
  if (!Reminder) throw new AppError(500, 'Reminder storage is not configured');

  const students = await Student.find({ isActive: true }).lean();
  if (!students.length) return { scheduled: 0, cancelled: 0 };
  const studentIds = students.map(({ studentId }) => studentId);
  const [plans, parents] = await Promise.all([
    FeePlan.find({ studentId: { $in: studentIds } }).lean(),
    User.find({ role: 'parent', isActive: true, studentId: { $in: studentIds } }).lean()
  ]);
  const studentById = new Map(students.map((student) => [student.studentId, student]));
  let scheduledCount = 0;
  let cancelledCount = 0;

  for (const plan of plans) {
    const student = studentById.get(plan.studentId);
    if (!student) continue;
    const parent = parentForStudent(parents, plan.studentId);
    for (const installment of plan.installments) {
      const existing = await Reminder.find({
        studentId: plan.studentId,
        installmentId: installment._id
      }).lean();
      const pendingFilter = {
        studentId: plan.studentId,
        installmentId: installment._id,
        status: { $in: PENDING_STATUSES }
      };

      if (installment.paidAmountPaise >= installment.amountPaise) {
        const result = await updateReminders(Reminder, pendingFilter, {
          $set: {
            status: 'cancelled',
            cancellationReason: 'Instalment fully paid',
            cancelledAt: now,
            nextAttemptAt: null
          }
        });
        cancelledCount += result.modifiedCount;
        continue;
      }
      if (!parent?.phone) {
        const result = await updateReminders(Reminder, pendingFilter, {
          $set: {
            status: 'cancelled',
            cancellationReason: 'No active parent account with a verified recipient is linked',
            cancelledAt: now,
            nextAttemptAt: null
          }
        });
        cancelledCount += result.modifiedCount;
        continue;
      }

      const entries = reminderSchedule(installment, offsetsDays);
      const activeKeys = new Set(entries.map(({ idempotencyKey }) => idempotencyKey));
      const stale = existing.filter((reminder) =>
        PENDING_STATUSES.includes(reminder.status) && !activeKeys.has(reminder.idempotencyKey)
      );
      for (const reminder of stale) {
        await updateReminder(Reminder, { _id: reminder._id, status: reminder.status }, {
          $set: {
            status: 'cancelled',
            cancellationReason: 'Instalment due date or reminder schedule changed',
            cancelledAt: now,
            nextAttemptAt: null
          }
        });
        cancelledCount += 1;
        recordAudit(auditLog, 'reminder.cancelled', reminder, { reason: 'schedule_changed' });
      }

      const elapsed = entries.filter(({ scheduledAt }) => scheduledAt <= now);
      const mostRecentElapsed = elapsed.at(-1);
      const elapsedToCreate = mostRecentElapsed &&
        now.getTime() - mostRecentElapsed.scheduledAt.getTime() <= catchUpWindowMs
        ? mostRecentElapsed
        : null;
      const existingByKey = new Map(existing.map((reminder) => [reminder.idempotencyKey, reminder]));

      if (!elapsedToCreate) {
        const missed = existing.filter((reminder) =>
          reminder.status === 'scheduled' && reminder.scheduledAt <= now
        );
        for (const reminder of missed) {
          await updateReminder(Reminder, { _id: reminder._id, status: 'scheduled' }, {
            $set: {
              status: 'cancelled',
              cancellationReason: 'Outside reminder catch-up window',
              cancelledAt: now,
              nextAttemptAt: null
            }
          });
          cancelledCount += 1;
          recordAudit(auditLog, 'reminder.cancelled', reminder, { reason: 'outside_catch_up_window' });
        }
      }

      for (const entry of entries) {
        const isFuture = entry.scheduledAt > now;
        if (!isFuture && entry.idempotencyKey !== elapsedToCreate?.idempotencyKey) continue;
        const data = buildReminderData({ student, parent, installment, scheduled: entry });
        const prior = existingByKey.get(entry.idempotencyKey);
        if (!prior) {
          let result;
          try {
            result = await updateReminder(Reminder, { idempotencyKey: entry.idempotencyKey }, {
              $setOnInsert: { ...data, attempts: 0, nextAttemptAt: null }
            }, null, { upsert: true });
          } catch (error) {
            if (error.code !== 11000) throw error;
            result = { upsertedCount: 0 };
          }
          if (result.upsertedCount === 1) {
            scheduledCount += 1;
            recordAudit(auditLog, 'reminder.scheduled', { ...data });
          }
          await updateReminder(Reminder, {
            idempotencyKey: entry.idempotencyKey,
            status: { $in: PENDING_STATUSES }
          }, {
            $set: {
              recipient: data.recipient,
              studentName: data.studentName,
              language: data.language,
              message: data.message,
              outstandingAmountPaise: data.outstandingAmountPaise
            }
          });
        } else if (['scheduled', 'failed'].includes(prior.status)) {
          await updateReminder(Reminder, { _id: prior._id, status: prior.status }, {
            $set: {
              recipient: data.recipient,
              studentName: data.studentName,
              language: data.language,
              message: data.message,
              outstandingAmountPaise: data.outstandingAmountPaise
            }
          });
        }
      }

      if (elapsedToCreate) {
        const olderPending = existing.filter((reminder) =>
          reminder.status === 'scheduled' &&
          reminder.scheduledAt <= now &&
          reminder.scheduledAt < elapsedToCreate.scheduledAt
        );
        for (const reminder of olderPending) {
          await updateReminder(Reminder, { _id: reminder._id, status: 'scheduled' }, {
            $set: {
              status: 'cancelled',
              cancellationReason: 'Superseded by a more recent reminder',
              cancelledAt: now,
              nextAttemptAt: null
            }
          });
          cancelledCount += 1;
          recordAudit(auditLog, 'reminder.cancelled', reminder, { reason: 'superseded' });
        }
      }
    }
  }
  return { scheduled: scheduledCount, cancelled: cancelledCount };
}

async function latestInstallmentState(models, reminder) {
  const [student, plan] = await Promise.all([
    models.Student.findOne({ studentId: reminder.studentId, isActive: true }).lean(),
    models.FeePlan.findOne({ studentId: reminder.studentId }).lean()
  ]);
  const installment = plan?.installments.find(
    (entry) => entry._id.toString() === reminder.installmentId.toString()
  );
  const parent = models.User
    ? await models.User.findOne({
      role: 'parent',
      isActive: true,
      studentId: reminder.studentId
    }).lean()
    : null;
  return { student, plan, installment, parent };
}

function retryTime(attempts, retryDelaysMs, now) {
  const delay = retryDelaysMs[attempts - 1];
  return delay ? new Date(now.getTime() + delay) : null;
}

async function recoverStaleSendingReminders(Reminder, now, staleSendingTimeoutMs, auditLog) {
  if (!staleSendingTimeoutMs) return 0;
  const cutoff = new Date(now.getTime() - staleSendingTimeoutMs);
  const stale = await Reminder.find({
    status: 'sending',
    lastAttemptAt: { $lte: cutoff }
  }).lean();
  let recovered = 0;
  for (const reminder of stale) {
    const result = await updateReminder(Reminder, {
      _id: reminder._id,
      status: 'sending',
      lastAttemptAt: reminder.lastAttemptAt
    }, {
      $set: {
        status: 'failed',
        failureReason: 'Previous delivery attempt did not complete',
        nextAttemptAt: now
      }
    });
    if (result.modifiedCount === 1) {
      recovered += 1;
      recordAudit(auditLog, 'reminder.stale_attempt_recovered', reminder, {
        attempt: reminder.attempts
      });
    }
  }
  return recovered;
}

export async function dispatchDueReminders(models, {
  now = new Date(),
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  provider = { send: async () => ({ accepted: true, provider: 'mock' }) },
  auditLog = () => {},
  onlyIds
} = {}) {
  const { Reminder } = models;
  if (!Reminder) throw new AppError(500, 'Reminder storage is not configured');
  const dueFilter = {
    $or: [
      { status: 'scheduled', scheduledAt: { $lte: now } },
      { status: 'failed', nextAttemptAt: { $lte: now }, attempts: { $lt: retryDelaysMs.length + 1 } }
    ]
  };
  if (onlyIds) dueFilter._id = { $in: onlyIds };
  const query = Reminder.find(dueFilter).sort({ scheduledAt: 1 });
  const due = await query.lean();
  const result = { sent: 0, cancelled: 0, failed: 0, skipped: 0 };

  for (const candidate of due) {
    const claimFilter = candidate.status === 'scheduled'
      ? { _id: candidate._id, status: 'scheduled', scheduledAt: { $lte: now } }
      : {
        _id: candidate._id,
        status: 'failed',
        nextAttemptAt: { $lte: now },
        attempts: { $lt: retryDelaysMs.length + 1 }
      };
    const claimedQuery = Reminder.findOneAndUpdate(claimFilter, {
      $set: { status: 'sending', lastAttemptAt: now },
      $inc: { attempts: 1 }
    }, { new: true });
    const claimed = await claimedQuery.exec();
    if (!claimed) {
      result.skipped += 1;
      continue;
    }
    recordAudit(auditLog, 'reminder.attempted', claimed);

    try {
      const { student, installment, parent } = await latestInstallmentState(models, claimed);
      if (!student || !installment ||
          installment.paidAmountPaise >= installment.amountPaise || !parent?.phone) {
        const cancellationReason = !student
          ? 'Student is inactive or unavailable'
          : !installment
            ? 'Instalment is unavailable'
            : !parent?.phone
              ? 'No active parent account with a verified recipient is linked'
              : 'Instalment fully paid';
        await updateReminder(Reminder, { _id: claimed._id, status: 'sending' }, {
          $set: {
            status: 'cancelled',
            cancellationReason,
            cancelledAt: now,
            nextAttemptAt: null
          }
        });
        claimed.status = 'cancelled';
        claimed.cancellationReason = cancellationReason;
        result.cancelled += 1;
        recordAudit(auditLog, 'reminder.cancelled', claimed, { reason: cancellationReason });
        continue;
      }

      const language = parent?.preferredLanguage === 'hi' ? 'hi' : 'en';
      const outstandingAmountPaise = installment.amountPaise - installment.paidAmountPaise;
      const message = formatReminderMessage({
        language,
        remainingAmountPaise: outstandingAmountPaise,
        dueDate: installment.dueDate
      });
      await updateReminder(Reminder, { _id: claimed._id, status: 'sending' }, {
        $set: {
          recipient: parent?.phone ?? student.parentPhone,
          studentName: student.name,
          installmentNumber: installment.installmentNumber,
          outstandingAmountPaise,
          language,
          message
        }
      });
      claimed.recipient = parent?.phone ?? student.parentPhone;
      claimed.studentName = student.name;
      claimed.outstandingAmountPaise = outstandingAmountPaise;
      claimed.installmentNumber = installment.installmentNumber;
      claimed.language = language;
      claimed.message = message;

      const delivery = await provider.send({
        recipient: claimed.recipient,
        studentId: claimed.studentId,
        installmentId: claimed.installmentId.toString(),
        message: claimed.message,
        language: claimed.language,
        reminderId: claimed._id.toString()
      });
      if (!delivery?.accepted) throw new Error('Mock message provider did not accept the message');
      await updateReminder(Reminder, { _id: claimed._id, status: 'sending' }, {
        $set: {
          status: 'sent',
          sentAt: now,
          failureReason: null,
          nextAttemptAt: null
        }
      });
      claimed.status = 'sent';
      result.sent += 1;
      recordAudit(auditLog, 'reminder.sent', claimed, { provider: delivery.provider ?? 'mock' });
    } catch (error) {
      const reason = 'Mock message delivery failed';
      const nextAttemptAt = retryTime(claimed.attempts, retryDelaysMs, now);
      await updateReminder(Reminder, { _id: claimed._id, status: 'sending' }, {
        $set: {
          status: 'failed',
          failureReason: reason,
          nextAttemptAt
        }
      });
      claimed.status = 'failed';
      claimed.failureReason = reason;
      claimed.nextAttemptAt = nextAttemptAt;
      result.failed += 1;
      recordAudit(auditLog, 'reminder.failed', claimed, {
        attempt: claimed.attempts,
        retryScheduled: Boolean(nextAttemptAt),
        errorName: error.name ?? 'Error',
        errorCode: Number.isInteger(error.code) ? error.code : undefined
      });
    }
  }
  return result;
}

export async function retryFailedReminder(models, reminderId, {
  now = new Date(),
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  provider,
  auditLog = () => {}
} = {}) {
  const reminder = await models.Reminder.findById(reminderId).lean();
  if (!reminder || reminder.status !== 'failed') {
    throw new AppError(404, 'Failed reminder not found');
  }
  const { installment } = await latestInstallmentState(models, reminder);
  if (!installment || installment.paidAmountPaise >= installment.amountPaise) {
    await updateReminder(models.Reminder, { _id: reminder._id, status: 'failed' }, {
      $set: {
        status: 'cancelled',
        cancellationReason: !installment ? 'Instalment is unavailable' : 'Instalment fully paid',
        cancelledAt: now,
        nextAttemptAt: null
      }
    });
    throw new AppError(409, 'The reminder was cancelled because no balance remains');
  }
  const result = await updateReminder(models.Reminder, { _id: reminder._id, status: 'failed' }, {
    $set: {
      status: 'scheduled',
      scheduledAt: now,
      attempts: 0,
      failureReason: null,
      nextAttemptAt: null
    }
  });
  if (result.matchedCount !== 1) throw new AppError(409, 'Reminder status changed; refresh and try again');
  recordAudit(auditLog, 'reminder.retry_requested', reminder);
  return dispatchDueReminders(models, {
    now,
    retryDelaysMs,
    provider,
    auditLog,
    onlyIds: [reminder._id]
  });
}

export async function processReminderCycle(models, options = {}) {
  const recovered = await recoverStaleSendingReminders(
    models.Reminder,
    options.now ?? new Date(),
    options.staleSendingTimeoutMs,
    options.auditLog ?? (() => {})
  );
  const scheduling = await scheduleInstallmentReminders(models, options);
  const delivery = await dispatchDueReminders(models, options);
  return { ...scheduling, ...delivery, recovered };
}

export function startReminderScheduler({ models, config, provider, auditLog = console.info }) {
  let running = false;
  let stopped = false;
  let currentRun = Promise.resolve();
  const options = {
    offsetsDays: config.REMINDER_SCHEDULE_OFFSETS_DAYS,
    catchUpWindowMs: config.REMINDER_CATCH_UP_WINDOW_MS,
    retryDelaysMs: config.REMINDER_RETRY_DELAYS_MS,
    staleSendingTimeoutMs: config.REMINDER_STALE_SENDING_TIMEOUT_MS,
    provider,
    auditLog
  };

  const run = () => {
    if (stopped || running) return currentRun;
    running = true;
    currentRun = processReminderCycle(models, options)
      .then((result) => {
        auditLog({ event: 'reminder.cycle_completed', ...result });
      })
      .catch((error) => {
        auditLog({
          event: 'reminder.cycle_failed',
          errorName: error.name ?? 'Error',
          errorCode: Number.isInteger(error.code) ? error.code : undefined
        });
      })
      .finally(() => { running = false; });
    return currentRun;
  };

  const timer = setInterval(run, config.REMINDER_POLL_INTERVAL_MS);
  timer.unref?.();
  void run();
  return {
    run,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await currentRun;
    }
  };
}
