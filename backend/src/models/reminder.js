import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema({
  studentId: { type: String, required: true, index: true },
  studentName: { type: String, required: true, trim: true, maxlength: 120 },
  recipient: { type: String, required: true, trim: true, maxlength: 50 },
  installmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  installmentNumber: { type: Number, required: true, min: 1 },
  scheduleOffsetDays: { type: Number, required: true, min: -365, max: 365 },
  idempotencyKey: { type: String, required: true },
  scheduledAt: { type: Date, required: true },
  language: { type: String, enum: ['en', 'hi'], required: true, default: 'en' },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  outstandingAmountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'], required: true },
  attempts: { type: Number, required: true, min: 0, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  failureReason: { type: String, default: null, maxlength: 500 },
  cancellationReason: { type: String, default: null, maxlength: 300 },
  cancelledAt: { type: Date, default: null },
  provider: { type: String, enum: ['mock'], default: 'mock' },
  demoSeedKey: { type: String, select: false }
}, { timestamps: true });

reminderSchema.index({ idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: 'string' } }
});
reminderSchema.index({ status: 1, scheduledAt: 1, nextAttemptAt: 1 });
reminderSchema.index({ studentId: 1, installmentId: 1, status: 1 });
reminderSchema.index({ demoSeedKey: 1 }, { unique: true, sparse: true });

export const Reminder = mongoose.models.Reminder ?? mongoose.model('Reminder', reminderSchema);
