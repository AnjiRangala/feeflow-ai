import mongoose from 'mongoose';

const installmentSchema = new mongoose.Schema({
  installmentNumber: { type: Number, required: true, min: 1 },
  dueDate: { type: Date, required: true },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  paidAmountPaise: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
    validate: {
      validator(value) {
        return Number.isSafeInteger(value) && value <= this.amountPaise;
      },
      message: 'Paid amount must be safe integer paise and cannot exceed the instalment amount'
    }
  },
  status: { type: String, enum: ['upcoming', 'partially_paid', 'overdue', 'paid'], required: true },
  payments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }]
});

const feePlanSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  totalFeePaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  discountPaise: { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger },
  netFeePaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  numberOfInstallments: { type: Number, required: true, enum: [3, 4] },
  demoSeedKey: { type: String, select: false },
  installments: {
    type: [installmentSchema],
    required: true,
    validate: {
      validator: (installments) => [3, 4].includes(installments.length),
      message: 'A fee plan must contain three or four installments'
    }
  }
}, { timestamps: { createdAt: true, updatedAt: true } });

feePlanSchema.index({ studentId: 1 }, { unique: true });

feePlanSchema.pre('validate', function validateFeePlan() {
  if (this.discountPaise > this.totalFeePaise) {
    this.invalidate('discountPaise', 'Discount cannot exceed total fee');
  }
  if (this.netFeePaise !== this.totalFeePaise - this.discountPaise) {
    this.invalidate('netFeePaise', 'Net fee must equal total fee less discount');
  }
  if (this.numberOfInstallments !== this.installments.length) {
    this.invalidate('numberOfInstallments', 'Installment count must match the installments list');
  }
  const installmentTotal = this.installments.reduce((total, installment) => total + installment.amountPaise, 0);
  if (!Number.isSafeInteger(installmentTotal) || installmentTotal !== this.netFeePaise) {
    this.invalidate('installments', 'Installment amounts must add up to the net fee');
  }
  const paidTotal = this.installments.reduce((total, installment) => total + installment.paidAmountPaise, 0);
  if (!Number.isSafeInteger(paidTotal) || paidTotal > this.netFeePaise) {
    this.invalidate('installments', 'Paid amount cannot exceed the net fee');
  }
});

export const FeePlan = mongoose.models.FeePlan ?? mongoose.model('FeePlan', feePlanSchema);
