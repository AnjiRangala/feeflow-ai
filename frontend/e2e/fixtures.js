import { expect, test } from '@playwright/test';

const now = new Date('2026-11-06T09:00:00.000Z');
const installment = {
  _id: 'installment-e2e',
  installmentNumber: 1,
  dueDate: new Date('2026-12-01T00:00:00.000Z').toISOString(),
  amountPaise: 100_000,
  paidAmountPaise: 20_000,
  outstandingPaise: 80_000,
  status: 'upcoming',
  payments: []
};
const ledger = {
  student: {
    studentId: 'E2E-STUDENT',
    name: 'E2E Student',
    batch: 'QA 2027',
    centre: 'QA Centre'
  },
  feePlan: {
    id: 'plan-e2e',
    totalFeePaise: 100_000,
    discountPaise: 0,
    netFeePaise: 100_000,
    numberOfInstallments: 1,
    installments: [installment]
  },
  amountPaidPaise: 20_000,
  remainingBalancePaise: 80_000,
  paymentHistory: []
};
const task = {
  _id: '64b000000000000000000099',
  studentId: ledger.student.studentId,
  studentName: ledger.student.name,
  riskLevel: 'HIGH',
  riskScore: 82,
  reasons: ['Attendance below 70%'],
  scoreBreakdown: { attendancePercentage: 20 },
  status: 'open',
  createdAt: now.toISOString(),
  recommendedAction: 'Create counsellor follow-up task',
  assessmentMethod: 'explainable_rules_baseline',
  missingFeatures: []
};

function dashboardData() {
  return {
    summary: {
      totalFeesBilledPaise: 100_000,
      totalNetFeesPaise: 95_000,
      totalFeesCollectedPaise: 20_000,
      totalOutstandingPaise: 75_000,
      overdueAmountPaise: 0,
      collectionPercentage: 21.05
    },
    metrics: {
      students: { totalActive: 1, assessedForRisk: 1 },
      refunds: { total: 1, pending: 1, approved: 0, rejected: 0 },
      reminders: { total: 2, scheduled: 1, pending: 1, sent: 1, failed: 0, cancelled: 0 },
      riskDistribution: { low: 0, medium: 0, high: 1 }
    },
    centreWiseCollection: [],
    batchWiseOutstanding: [],
    monthlyCollectionTrend: [],
    overdueAgeing: [],
    rows: []
  };
}

export async function installApiMocks(page, role, {
  holdDashboard = false,
  dashboardError = false,
  authenticated = true
} = {}) {
  let releaseDashboard;
  const dashboardWait = holdDashboard
    ? new Promise((resolve) => { releaseDashboard = resolve; })
    : Promise.resolve();
  const user = { id: 'e2e-user', name: 'E2E User', role, studentId: role === 'parent' ? ledger.student.studentId : null };
  const refunds = [];
  let orderNumber = 0;
  await page.addInitScript((hasSession) => {
    if (hasSession) localStorage.setItem('feeflow.accessToken', 'e2e-only-placeholder');
    else localStorage.removeItem('feeflow.accessToken');
  }, authenticated);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    const respond = (body, status = 200, contentType = 'application/json') =>
      route.fulfill({ status, contentType, body: contentType === 'application/json' ? JSON.stringify(body) : body });

    if (path === '/auth/me') return respond({ user });
    if (path === '/auth/login') return respond({ error: 'Invalid email or password' }, 401);
    if (path === '/fees/dashboard') {
      await dashboardWait;
      if (dashboardError) return respond({ error: 'Dashboard unavailable for this test' }, 503);
      return respond({ dashboard: dashboardData() });
    }
    if (path === '/fees/students') {
      return respond({ students: [{ ...ledger, student: ledger.student }] });
    }
    if (path === `/fees/student/${ledger.student.studentId}`) return respond({ student: ledger });
    if (path === '/reminders/preferences' && method === 'GET') return respond({ preferredLanguage: 'en' });
    if (path === '/reminders') return respond({ reminders: [{
      _id: 'reminder-e2e',
      studentId: ledger.student.studentId,
      studentName: ledger.student.name,
      installmentNumber: 1,
      scheduleOffsetDays: 3,
      scheduledAt: now.toISOString(),
      outstandingAmountPaise: 80_000,
      language: 'en',
      attempts: 0,
      status: 'scheduled',
      message: 'A mock reminder for the E2E student.'
    }] });
    if (path === '/refunds' && method === 'GET') return respond({ refunds });
    if (path === '/refunds/calculate' && method === 'POST') {
      const refund = {
        _id: 'refund-e2e',
        studentId: ledger.student.studentId,
        studentName: ledger.student.name,
        status: 'pending_review',
        createdAt: now.toISOString(),
        refundAmountPaise: 70_000,
        policyInputs: {
          policyVersion: 'e2e-policy-v1',
          courseStartDate: '2026-09-01T00:00:00.000Z',
          withdrawalDate: '2026-10-01T00:00:00.000Z',
          totalCourseFeePaise: 100_000,
          netCourseFeePaise: 100_000,
          amountPaidPaise: 100_000,
          nonRefundableChargesPaise: 0,
          totalCourseDurationDays: 90
        },
        calculationDetails: {
          daysCompleted: 30,
          feeEarnedPaise: 30_000,
          refundableAmountPaise: 70_000,
          formula: 'amount paid - earned fee',
          assumption: 'demonstration assumption',
          rounding: 'rounded to paise'
        }
      };
      refunds.unshift(refund);
      return respond({ refund }, 201);
    }
    if (path === `/refunds/refund-e2e/approve` && method === 'POST') {
      refunds[0].status = 'approved';
      return respond({ refund: refunds[0] });
    }
    if (path === '/refunds/refund-e2e/reject' && method === 'POST') {
      refunds[0].status = 'rejected';
      return respond({ refund: refunds[0] });
    }
    if (path === '/risks/tasks') return respond({ tasks: [{ ...task }] });
    if (path === '/risks/assess' && method === 'POST') {
      return respond({
        assessment: { ...task, studentId: ledger.student.studentId },
        task: { ...task }
      }, 201);
    }
    if (path === `/risks/tasks/${task._id}/feedback` && method === 'POST') {
      return respond({ task: { ...task, feedback: 'valid', status: 'in_progress' } });
    }
    if (path === '/parent-payments/orders' && method === 'POST') {
      orderNumber += 1;
      return respond({
        order: {
          id: `order-e2e-${orderNumber}`,
          status: 'pending',
          amountPaise: 80_000,
          transactionId: `mock-e2e-${orderNumber}`,
          expiresAt: new Date(now.getTime() + 60_000).toISOString()
        }
      }, 201);
    }
    if (/^\/parent-payments\/orders\/[^/]+\/complete$/.test(path) && method === 'POST') {
      const outcome = request.postDataJSON().outcome;
      const order = { id: `order-e2e-${orderNumber}`, status: outcome === 'failure' ? 'failed' : 'completed' };
      if (outcome === 'failure') return respond({ order });
      return respond({
        order,
        payment: {
          id: 'payment-e2e',
          amountPaise: 80_000,
          transactionId: `mock-e2e-${orderNumber}`
        }
      });
    }
    if (path === '/parent-payments/receipts/payment-e2e') return respond('<html>Test receipt</html>', 200, 'text/html');
    return respond({});
  });
  return { releaseDashboard };
}

export async function openAs(page, role, path = '/') {
  await installApiMocks(page, role);
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

export { expect, test };
