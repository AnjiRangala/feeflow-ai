import { AppError } from '../lib/errors.js';
import { sumSafeIntegers } from '../lib/fee-ledger.js';
import { getStudentLedgers, summarizeLedgers } from './fee-ledger.js';

const AGEING_BUCKETS = [
  { key: 'notDue', label: 'Not due', matches: (days) => days === 0 },
  { key: 'days1To30', label: '1–30 days', matches: (days) => days >= 1 && days <= 30 },
  { key: 'days31To60', label: '31–60 days', matches: (days) => days >= 31 && days <= 60 },
  { key: 'days61To90', label: '61–90 days', matches: (days) => days >= 61 && days <= 90 },
  { key: 'above90', label: 'Above 90 days', matches: (days) => days > 90 }
];
const REFUND_STATUSES = ['pending_review', 'approved', 'rejected'];
const REMINDER_STATUSES = ['scheduled', 'sending', 'sent', 'failed', 'cancelled'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high'];

function countsByKey(groups) {
  return new Map(groups.map(({ _id, count }) => [_id, count]));
}

function zeroOperationalMetrics() {
  return {
    students: { totalActive: 0, assessedForRisk: 0 },
    refunds: { total: 0, pending: 0, approved: 0, rejected: 0 },
    reminders: { total: 0, scheduled: 0, pending: 0, sent: 0, failed: 0, cancelled: 0 },
    riskDistribution: { low: 0, medium: 0, high: 0 }
  };
}

async function getOperationalMetrics(models, students) {
  const activeStudentIds = [...new Set(students
    .filter((student) => student.isActive === true &&
      typeof student.studentId === 'string' && student.studentId.trim().length > 0 &&
      typeof student.name === 'string' && student.name.trim().length > 0)
    .map(({ studentId }) => studentId))];
  if (!activeStudentIds.length) return zeroOperationalMetrics();

  const [refundGroups, reminderGroups, assessmentGroups, legacyTaskGroups] = await Promise.all([
    models.Refund.aggregate([
      { $match: { studentId: { $in: activeStudentIds }, status: { $in: REFUND_STATUSES } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    models.Reminder.aggregate([
      { $match: { studentId: { $in: activeStudentIds }, status: { $in: REMINDER_STATUSES } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    models.RiskAssessment.aggregate([
      { $match: { studentId: { $in: activeStudentIds }, riskLevel: { $in: RISK_LEVELS } } },
      { $sort: { assessedAt: -1, _id: -1 } },
      { $group: { _id: '$studentId', riskLevel: { $first: '$riskLevel' } } }
    ]),
    models.CounsellorTask.aggregate([
      { $match: { studentId: { $in: activeStudentIds }, riskLevel: { $in: RISK_LEVELS } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$studentId', riskLevel: { $first: '$riskLevel' } } }
    ])
  ]);
  const refundCounts = countsByKey(refundGroups);
  const reminderCounts = countsByKey(reminderGroups);
  const riskByStudent = new Map(legacyTaskGroups.map(({ _id, riskLevel }) => [_id, riskLevel]));
  for (const { _id, riskLevel } of assessmentGroups) riskByStudent.set(_id, riskLevel);
  const riskDistribution = { low: 0, medium: 0, high: 0 };
  for (const level of riskByStudent.values()) {
    const category = String(level).toLowerCase();
    if (Object.hasOwn(riskDistribution, category)) riskDistribution[category] += 1;
  }
  const refunds = {
    pending: refundCounts.get('pending_review') ?? 0,
    approved: refundCounts.get('approved') ?? 0,
    rejected: refundCounts.get('rejected') ?? 0
  };
  const reminders = {
    scheduled: reminderCounts.get('scheduled') ?? 0,
    pending: (reminderCounts.get('scheduled') ?? 0) + (reminderCounts.get('sending') ?? 0),
    sent: reminderCounts.get('sent') ?? 0,
    failed: reminderCounts.get('failed') ?? 0,
    cancelled: reminderCounts.get('cancelled') ?? 0
  };
  const totalReminders = REMINDER_STATUSES.reduce((total, status) =>
    total + (reminderCounts.get(status) ?? 0), 0);
  return {
    students: {
      totalActive: activeStudentIds.length,
      assessedForRisk: riskByStudent.size
    },
    refunds: {
      total: Object.values(refunds).reduce((total, count) => total + count, 0),
      ...refunds
    },
    reminders: {
      total: totalReminders,
      ...reminders
    },
    riskDistribution
  };
}

function addSafe(map, key, amount) {
  const next = (map.get(key) ?? 0) + amount;
  if (!Number.isSafeInteger(next)) throw new AppError(400, 'Dashboard aggregation exceeds the safe monetary range');
  map.set(key, next);
}

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildAccountsDashboard(ledgers, now = new Date()) {
  const summary = summarizeLedgers(ledgers);
  const centreMap = new Map();
  const batchOutstanding = new Map();
  const ageingAmounts = new Map(AGEING_BUCKETS.map(({ key }) => [key, 0]));
  const ageingCounts = new Map(AGEING_BUCKETS.map(({ key }) => [key, 0]));
  const monthly = new Map();
  const currentMonth = monthStart(now);
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - index, 1));
    monthly.set(monthKey(date), { month: monthKey(date), label: new Intl.DateTimeFormat('en', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(date), collectedPaise: 0 });
  }

  const rows = [];
  for (const ledger of ledgers) {
    if (!ledger.feePlan) continue;
    const centre = ledger.student.centre || 'Unassigned';
    const currentCentre = centreMap.get(centre) ?? { name: centre, billedPaise: 0, collectedPaise: 0, outstandingPaise: 0 };
    currentCentre.billedPaise += ledger.feePlan.netFeePaise;
    currentCentre.collectedPaise += ledger.amountPaidPaise;
    currentCentre.outstandingPaise += ledger.remainingBalancePaise;
    for (const amount of [currentCentre.billedPaise, currentCentre.collectedPaise, currentCentre.outstandingPaise]) {
      if (!Number.isSafeInteger(amount)) throw new AppError(400, 'Centre totals exceed the safe monetary range');
    }
    centreMap.set(centre, currentCentre);
    addSafe(batchOutstanding, ledger.student.batch || 'Unassigned', ledger.remainingBalancePaise);

    for (const payment of ledger.paymentHistory) {
      const paidAt = new Date(payment.paidAt);
      if (!Number.isFinite(paidAt.getTime())) continue;
      const month = monthly.get(monthKey(paidAt));
      if (month) {
        month.collectedPaise += payment.amountPaise;
        if (!Number.isSafeInteger(month.collectedPaise)) {
          throw new AppError(400, 'Monthly collections exceed the safe monetary range');
        }
      }
    }

    for (const installment of ledger.feePlan.installments) {
      const outstandingPaise = installment.outstandingPaise;
      const daysOverdue = installment.status === 'overdue' ? installment.daysOverdue : 0;
      const bucket = AGEING_BUCKETS.find(({ matches }) => matches(daysOverdue));
      if (outstandingPaise > 0) {
        addSafe(ageingAmounts, bucket.key, outstandingPaise);
        addSafe(ageingCounts, bucket.key, 1);
      }
      rows.push({
        studentId: ledger.student.studentId,
        studentName: ledger.student.name,
        centre: ledger.student.centre,
        batch: ledger.student.batch,
        installmentNumber: installment.installmentNumber,
        dueDate: installment.dueDate,
        amountPaise: installment.amountPaise,
        paidAmountPaise: installment.paidAmountPaise,
        outstandingPaise,
        status: installment.status
      });
    }
  }

  return {
    summary,
    centreWiseCollection: [...centreMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
    batchWiseOutstanding: [...batchOutstanding].map(([name, outstandingPaise]) => ({ name, outstandingPaise }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    monthlyCollectionTrend: [...monthly.values()],
    overdueAgeing: AGEING_BUCKETS.map(({ key, label }) => ({
      key,
      label,
      amountPaise: ageingAmounts.get(key),
      installmentCount: ageingCounts.get(key)
    })),
    rows
  };
}

export async function getAccountsDashboard(models, now = new Date()) {
  const students = await models.Student.find({ isActive: true }).sort({ name: 1 }).lean();
  const [ledgers, metrics] = await Promise.all([
    getStudentLedgers(models, students, now),
    getOperationalMetrics(models, students)
  ]);
  return { ...buildAccountsDashboard(ledgers, now), metrics };
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function formatRupees(paise) {
  return (paise / 100).toFixed(2);
}

export function buildDashboardCsv(rows) {
  const headings = [
    'Student ID', 'Student name', 'Centre', 'Batch', 'Instalment', 'Due date',
    'Amount (INR)', 'Paid amount (INR)', 'Outstanding balance (INR)', 'Status'
  ];
  const lines = [headings.map(csvCell).join(',')];
  for (const row of rows) {
    const dueDate = row.dueDate ? new Date(row.dueDate).toISOString().slice(0, 10) : '';
    lines.push([
      row.studentId,
      row.studentName,
      row.centre,
      row.batch,
      row.installmentNumber,
      dueDate,
      formatRupees(row.amountPaise),
      formatRupees(row.paidAmountPaise),
      formatRupees(row.outstandingPaise),
      row.status
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
