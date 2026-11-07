import mongoose from 'mongoose';

const riskAssessmentSchema = new mongoose.Schema({
  studentId: { type: String, required: true, trim: true },
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high'], required: true },
  riskScore: { type: Number, min: 0, max: 100, required: true },
  reasons: { type: [String], required: true, default: [] },
  scoreBreakdown: { type: mongoose.Schema.Types.Mixed, required: true },
  features: { type: mongoose.Schema.Types.Mixed, required: true },
  missingFeatures: { type: [String], required: true, default: [] },
  recommendedAction: { type: String, required: true },
  assessmentMethod: { type: String, required: true },
  modelVersion: { type: String, required: true },
  assessedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  counsellorTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'CounsellorTask', default: null },
  assessedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

riskAssessmentSchema.index({ studentId: 1, assessedAt: -1, _id: -1 });

export const RiskAssessment = mongoose.models.RiskAssessment ??
  mongoose.model('RiskAssessment', riskAssessmentSchema);
