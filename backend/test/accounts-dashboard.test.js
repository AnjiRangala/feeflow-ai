import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAccountsDashboard,
  buildDashboardCsv
} from '../src/services/accounts-dashboard.js';

const now = new Date('2026-11-05T00:00:00.000Z');

const ledgers = [{
  student: { studentId: 'STU-1', name: 'Student One', centre: 'Jaipur', batch: 'JEE 2027' },
  feePlan: {
    totalFeePaise: 120_000,
    netFeePaise: 100_000,
    installments: [
      { installmentNumber: 1, dueDate: new Date('2026-10-01T00:00:00.000Z'), amountPaise: 50_000, paidAmountPaise: 25_000, outstandingPaise: 25_000, status: 'overdue', daysOverdue: 35 },
      { installmentNumber: 2, dueDate: new Date('2026-12-01T00:00:00.000Z'), amountPaise: 50_000, paidAmountPaise: 0, outstandingPaise: 50_000, status: 'upcoming', daysOverdue: 0 }
    ]
  },
  amountPaidPaise: 25_000,
  remainingBalancePaise: 75_000,
  paymentHistory: [{ amountPaise: 25_000, paidAt: new Date('2026-10-15T00:00:00.000Z') }]
}, {
  student: { studentId: 'STU-2', name: 'Student, Two', centre: 'Ajmer', batch: 'NEET 2027' },
  feePlan: {
    totalFeePaise: 100_000,
    netFeePaise: 100_000,
    installments: [
      { installmentNumber: 1, dueDate: new Date('2026-09-01T00:00:00.000Z'), amountPaise: 100_000, paidAmountPaise: 0, outstandingPaise: 100_000, status: 'overdue', daysOverdue: 65 }
    ]
  },
  amountPaidPaise: 0,
  remainingBalancePaise: 100_000,
  paymentHistory: []
}];

test('dashboard aggregates billings, collections, group metrics, trend, and ageing', () => {
  const dashboard = buildAccountsDashboard(ledgers, now);
  assert.equal(dashboard.summary.totalFeesBilledPaise, 220_000);
  assert.equal(dashboard.summary.totalFeesCollectedPaise, 25_000);
  assert.equal(dashboard.summary.totalOutstandingPaise, 175_000);
  assert.equal(dashboard.summary.overdueAmountPaise, 125_000);
  assert.equal(dashboard.summary.collectionPercentage, 12.5);
  assert.deepEqual(dashboard.centreWiseCollection.map(({ name, collectedPaise }) => [name, collectedPaise]), [
    ['Ajmer', 0], ['Jaipur', 25_000]
  ]);
  assert.deepEqual(dashboard.overdueAgeing.map(({ key, amountPaise }) => [key, amountPaise]), [
    ['notDue', 50_000], ['days1To30', 0], ['days31To60', 25_000],
    ['days61To90', 100_000], ['above90', 0]
  ]);
  assert.equal(dashboard.monthlyCollectionTrend.find(({ month }) => month === '2026-10').collectedPaise, 25_000);
  assert.equal(dashboard.rows.length, 3);
});

test('CSV export contains required columns, escapes fields, and prevents formula injection', () => {
  const csv = buildDashboardCsv([{
    studentId: 'STU-1',
    studentName: '  =HYPERLINK("https://bad.example")',
    centre: 'Jaipur, North',
    batch: 'JEE "Advanced"',
    installmentNumber: 1,
    dueDate: new Date('2026-10-01T00:00:00.000Z'),
    amountPaise: 50_000,
    paidAmountPaise: 25_000,
    outstandingPaise: 25_000,
    status: 'overdue'
  }]);
  assert.match(csv, /"Student ID","Student name","Centre","Batch","Instalment","Due date","Amount \(INR\)","Paid amount \(INR\)","Outstanding balance \(INR\)","Status"/);
  assert.match(csv, /"'  =HYPERLINK\(""https:\/\/bad\.example""\)"/);
  assert.match(csv, /"Jaipur, North"/);
  assert.match(csv, /"JEE ""Advanced"""/);
});
