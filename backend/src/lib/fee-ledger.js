import { AppError } from './errors.js';

export function requirePaise(value, field, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new AppError(400, `${field} must be a safe integer amount in paise`);
  }
  return value;
}

export function rupeesToPaise(value, field, { allowZero = false } = {}) {
  const amount = String(value);
  const match = amount.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new AppError(400, `${field} cannot be converted to paise safely`);
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return requirePaise(paise, field, { allowZero });
}

export function sumSafeIntegers(values, field = 'Total') {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new AppError(400, `${field} exceeds the safe monetary range`);
  return total;
}

export function calculateNetFee(totalFeePaise, discountPaise) {
  requirePaise(totalFeePaise, 'totalFeePaise');
  requirePaise(discountPaise, 'discountPaise', { allowZero: true });
  if (discountPaise > totalFeePaise) throw new AppError(400, 'Discount cannot exceed total fee');
  return totalFeePaise - discountPaise;
}

export function buildInstallments({ totalFeePaise, discountPaise = 0, dueDates, amountsPaise }) {
  const netFeePaise = calculateNetFee(totalFeePaise, discountPaise);
  if (!Array.isArray(dueDates) || ![3, 4].includes(dueDates.length)) {
    throw new AppError(400, 'A fee plan must contain three or four instalments');
  }

  const amounts = amountsPaise ?? Array.from({ length: dueDates.length }, (_, index) =>
    Math.floor(netFeePaise / dueDates.length) + Number(index < netFeePaise % dueDates.length)
  );
  if (!Array.isArray(amounts) || amounts.length !== dueDates.length) {
    throw new AppError(400, 'Instalment amounts must match the due dates');
  }
  amounts.forEach((amount) => requirePaise(amount, 'Instalment amount'));
  if (sumSafeIntegers(amounts, 'Instalment total') !== netFeePaise) {
    throw new AppError(400, 'Instalment amounts must equal the net fee');
  }

  const parsedDates = dueDates.map((dueDate) =>
    typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? new Date(`${dueDate}T00:00:00.000Z`)
      : new Date(Number.NaN)
  );
  if (parsedDates.some((date, index) =>
    !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dueDates[index]
  )) {
    throw new AppError(400, 'Each instalment needs a valid due date');
  }
  if (parsedDates.some((date, index) => index > 0 && date.getTime() <= parsedDates[index - 1].getTime())) {
    throw new AppError(400, 'Instalment due dates must be in increasing order');
  }
  const installments = parsedDates.map((date, index) => {
    return {
      installmentNumber: index + 1,
      dueDate: date,
      amountPaise: amounts[index],
      paidAmountPaise: 0,
      status: 'upcoming',
      payments: []
    };
  });
  return { netFeePaise, installments };
}

export function getInstallmentStatus(installment, now = new Date()) {
  if (installment.paidAmountPaise === installment.amountPaise) return 'paid';
  if (new Date(installment.dueDate).getTime() < utcDayStart(now)) return 'overdue';
  if (installment.paidAmountPaise > 0) return 'partially_paid';
  return 'upcoming';
}

export function getDaysOverdue(installment, now = new Date()) {
  if (getInstallmentStatus(installment, now) !== 'overdue') return 0;
  return Math.floor((utcDayStart(now) - utcDayStart(installment.dueDate)) / 86_400_000);
}

export function utcDayStart(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function updateFeePlanTotals(plan) {
  const paid = sumSafeIntegers(plan.installments.map((installment) => installment.paidAmountPaise), 'Amount paid');
  const remainingBalancePaise = plan.netFeePaise - paid;
  if (!Number.isSafeInteger(remainingBalancePaise) || remainingBalancePaise < 0) {
    throw new AppError(500, 'Fee ledger balance is inconsistent');
  }
  return {
    totalFeePaise: plan.totalFeePaise,
    discountPaise: plan.discountPaise,
    netFeePaise: plan.netFeePaise,
    amountPaidPaise: paid,
    remainingBalancePaise
  };
}
