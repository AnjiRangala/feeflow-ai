import mongoose from 'mongoose';

const policyInputsSchema = new mongoose.Schema({
  courseStartDate: { type: Date, required: true },
  withdrawalDate: { type: Date, required: true },
  totalCourseDurationDays: { type: Number, required: true, min: 1, max: 36_500, validate: Number.isSafeInteger },
  totalCourseFeePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  netCourseFeePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  amountPaidPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  nonRefundableChargesPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  policyVersion: { type: String, required: true, trim: true, maxlength: 80 },
  financialInputsSource: { type: String, enum: ['fee_ledger', 'accounts_override'], required: true },
  overrideReason: { type: String, trim: true, maxlength: 500, default: null }
}, { _id: false });

const calculationDetailsSchema = new mongoose.Schema({
  daysCompleted: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  feeEarnedPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  refundableAmountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  formula: { type: String, required: true },
  assumption: { type: String, required: true },
  rounding: { type: String, required: true }
}, { _id: false });

const refundSchema = new mongoose.Schema({
  studentId: { type: String, required: true, index: true },
  studentName: { type: String, required: true, trim: true, maxlength: 120 },
  policyInputs: { type: policyInputsSchema, required: true },
  calculationDetails: { type: calculationDetailsSchema, required: true },
  refundAmountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: ['pending_review', 'approved', 'rejected'], required: true, default: 'pending_review' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, trim: true, maxlength: 500, default: null },
  demoSeedKey: { type: String, select: false },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { timestamps: { createdAt: false, updatedAt: true } });

refundSchema.index({ demoSeedKey: 1 }, { unique: true, sparse: true });

export const Refund = mongoose.models.Refund ?? mongoose.model('Refund', refundSchema);
