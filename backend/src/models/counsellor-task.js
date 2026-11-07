import mongoose from 'mongoose';

const counsellorTaskSchema = new mongoose.Schema({
  studentId: { type: String, required: true, index: true },
  studentName: { type: String, default: '' },
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high'], required: true },
  riskScore: { type: Number, min: 0, max: 100, default: 0 },
  reasons: { type: [String], required: true, default: [] },
  scoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
  features: { type: mongoose.Schema.Types.Mixed, default: {} },
  missingFeatures: { type: [String], default: [] },
  recommendedAction: { type: String, default: '' },
  assessmentMethod: { type: String, default: 'legacy' },
  modelVersion: { type: String, default: 'legacy' },
  status: { type: String, enum: ['open', 'in_progress', 'completed', 'dismissed'], required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  openTaskStudentId: { type: String, default: undefined },
  feedback: { type: String, enum: ['valid', 'false_flag'] },
  feedbackNote: { type: String, maxlength: 500 },
  feedbackBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  demoSeedKey: { type: String, select: false },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { timestamps: { createdAt: false, updatedAt: true } });

counsellorTaskSchema.index({ openTaskStudentId: 1 }, { unique: true, sparse: true });
counsellorTaskSchema.index({ createdAt: -1 });
counsellorTaskSchema.index({ demoSeedKey: 1 }, { unique: true, sparse: true });

export const CounsellorTask = mongoose.models.CounsellorTask ?? mongoose.model('CounsellorTask', counsellorTaskSchema);
