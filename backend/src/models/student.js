import mongoose from 'mongoose';

const testPerformanceSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true },
  score: { type: Number, min: 0, max: 100, required: true },
  testDate: { type: Date, required: true }
}, { _id: false });

const paymentPromiseSchema = new mongoose.Schema({
  status: { type: String, enum: ['pending', 'kept', 'broken'], required: true },
  promisedAt: { type: Date, required: true },
  resolvedAt: { type: Date }
}, { _id: false });

const studentSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  batch: { type: String, required: true, trim: true },
  centre: { type: String, required: true, trim: true },
  parentPhone: { type: String, required: true, trim: true },
  parentEmail: { type: String, required: true, lowercase: true, trim: true },
  attendancePercentage: { type: Number, min: 0, max: 100, default: 0 },
  testPerformance: { type: [testPerformanceSchema], default: [] },
  paymentPromises: { type: [paymentPromiseSchema], default: undefined },
  demoSeedKey: { type: String, select: false },
  isActive: { type: Boolean, default: true, required: true }
}, { timestamps: true });

export const Student = mongoose.models.Student ?? mongoose.model('Student', studentSchema);
