import mongoose from 'mongoose';

const mockPaymentOrderSchema = new mongoose.Schema({
  studentId: { type: String, required: true, index: true },
  parentUserId: { type: String, required: true, index: true },
  installmentNumber: { type: Number, required: true, min: 1 },
  installmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  transactionId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], required: true, default: 'pending' },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  expiresAt: { type: Date, required: true },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

mockPaymentOrderSchema.index({ parentUserId: 1, status: 1, expiresAt: 1 });

export const MockPaymentOrder = mongoose.models.MockPaymentOrder ??
  mongoose.model('MockPaymentOrder', mockPaymentOrderSchema);
