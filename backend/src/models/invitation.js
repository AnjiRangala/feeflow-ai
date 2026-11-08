import mongoose from 'mongoose';

const invitationSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['parent', 'counsellor'], required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  createdBy: { type: String, required: true },
  usedAt: { type: Date, default: null }
}, { timestamps: true });

invitationSchema.index({ email: 1, usedAt: 1 });

export const Invitation = mongoose.models.Invitation ?? mongoose.model('Invitation', invitationSchema);
