import mongoose from 'mongoose';

const paymentWebhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  event: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  status: { type: String, enum: ['processed', 'ignored', 'failed'], default: 'processed' },
  processedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

export const PaymentWebhookEvent = mongoose.models.PaymentWebhookEvent ??
  mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
