export function parsePaise(value) {
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const rupees = Number(match[1]);
  const paise = Number((match[2] ?? '').padEnd(2, '0'));
  const total = rupees * 100 + paise;
  return Number.isSafeInteger(total) ? total : null;
}

export function formatPaise(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format((value ?? 0) / 100);
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

export function studentLedgerStatus(ledger) {
  if (!ledger.feePlan) return 'no_plan';
  const statuses = ledger.feePlan.installments.map(({ status }) => status);
  if (statuses.includes('overdue')) return 'overdue';
  if (statuses.includes('partially_paid')) return 'partially_paid';
  if (ledger.remainingBalancePaise === 0) return 'paid';
  return 'upcoming';
}
