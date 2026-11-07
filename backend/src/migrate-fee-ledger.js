import mongoose from 'mongoose';
import { config } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { AppError } from './lib/errors.js';
import { getInstallmentStatus, rupeesToPaise, sumSafeIntegers } from './lib/fee-ledger.js';
import { FeePlan, Payment } from './models/index.js';

function migratePlan(document) {
  const totalFeePaise = rupeesToPaise(document.totalFee, 'Total fee');
  const discountPaise = rupeesToPaise(document.discount ?? 0, 'Discount', { allowZero: true });
  const netFeePaise = rupeesToPaise(document.netFee, 'Net fee');
  if (discountPaise > totalFeePaise || netFeePaise !== totalFeePaise - discountPaise) {
    throw new AppError(400, `Fee plan ${document._id} has inconsistent totals`);
  }
  const installments = document.installments.map((installment) => {
    const amountPaise = rupeesToPaise(installment.amount, 'Instalment amount');
    const paidAmountPaise = rupeesToPaise(installment.paidAmount ?? 0, 'Paid amount', { allowZero: true });
    if (paidAmountPaise > amountPaise) {
      throw new AppError(400, `Fee plan ${document._id} has an overpaid instalment`);
    }
    const converted = { ...installment, amountPaise, paidAmountPaise };
    delete converted.amount;
    delete converted.paidAmount;
    converted.status = getInstallmentStatus(converted);
    return converted;
  });
  if (installments.length !== document.numberOfInstallments ||
      sumSafeIntegers(installments.map(({ amountPaise }) => amountPaise)) !== netFeePaise) {
    throw new AppError(400, `Fee plan ${document._id} has inconsistent instalments`);
  }
  const migrated = { ...document, totalFeePaise, discountPaise, netFeePaise, installments };
  delete migrated.totalFee;
  delete migrated.discount;
  delete migrated.netFee;
  return migrated;
}

function migratePayment(document) {
  const migrated = { ...document, amountPaise: rupeesToPaise(document.amount, 'Payment amount') };
  delete migrated.amount;
  return migrated;
}

try {
  await connectDatabase(config.MONGO_URI);
  const [legacyPlans, legacyPayments] = await Promise.all([
    FeePlan.collection.find({ totalFee: { $exists: true } }).toArray(),
    Payment.collection.find({ amount: { $exists: true } }).toArray()
  ]);
  if (!legacyPlans.length && !legacyPayments.length) {
    console.info('Fee ledger migration: no legacy rupee-denominated records found.');
  } else {
    const migratedPlans = legacyPlans.map(migratePlan);
    const migratedPayments = legacyPayments.map(migratePayment);
    const session = await mongoose.connection.startSession();
    try {
      await session.withTransaction(async () => {
        for (const plan of migratedPlans) {
          await FeePlan.collection.replaceOne({ _id: plan._id }, plan, { session });
        }
        for (const payment of migratedPayments) {
          await Payment.collection.replaceOne({ _id: payment._id }, payment, { session });
        }
      });
    } finally {
      await session.endSession();
    }
    console.info(`Fee ledger migration complete: ${migratedPlans.length} plans and ${migratedPayments.length} payments converted to paise.`);
  }
} catch (error) {
  console.error('Fee ledger migration failed:', error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
