import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['parent', 'accounts', 'counsellor'], required: true },
  studentId: { type: String, default: null },
  preferredLanguage: { type: String, enum: ['en', 'hi'], default: 'en' },
  demoSeedKey: { type: String, select: false },
  isActive: { type: Boolean, default: true, required: true }
}, { timestamps: { createdAt: true, updatedAt: true } });

userSchema.index({ studentId: 1 });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
