import mongoose from 'mongoose';

const otpChallengeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attempts: { type: Number, default: 0, min: 0, max: 5 }
}, { timestamps: true });

export const OtpChallenge = mongoose.models.OtpChallenge ?? mongoose.model('OtpChallenge', otpChallengeSchema);
