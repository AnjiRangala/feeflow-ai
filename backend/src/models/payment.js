import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  studentId: { type: String, required: true, index: true },
  installmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  transactionId: { type: String, required: true, unique: true, trim: true },
  mockOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MockPaymentOrder', default: null },
  provider: { type: String, enum: ['mock', 'razorpay'], default: 'mock' },
  providerOrderId: { type: String, default: null, index: true },
  providerPaymentId: { type: String, default: undefined, unique: true, sparse: true },
  paymentMethod: { type: String, enum: ['cash', 'card', 'upi', 'bank_transfer', 'other'], required: true },
  status: { type: String, enum: ['pending', 'authorized', 'completed', 'failed', 'cancelled', 'refunded'], required: true },
  demoSeedKey: { type: String, select: false },
  paidAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

export const Payment = mongoose.models.Payment ?? mongoose.model('Payment', paymentSchema);
