import { AppError } from '../lib/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(start, end) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS));
}

function performanceTrend(testPerformance) {
  if (!Array.isArray(testPerformance) || testPerformance.length < 2) return null;
  const tests = [...testPerformance]
    .filter(({ score, testDate }) => Number.isFinite(score) && Number.isFinite(new Date(testDate).getTime()))
    .sort((left, right) => new Date(left.testDate) - new Date(right.testDate));
  if (tests.length < 2) return null;
  return Number((tests[tests.length - 1].score - tests[tests.length - 2].score).toFixed(2));
}

export function getRiskFeatures(student, feePlan, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (feePlan && (!Array.isArray(feePlan.installments) || feePlan.installments.some((installment) =>
    !Number.isSafeInteger(installment.amountPaise) ||
    !Number.isSafeInteger(installment.paidAmountPaise) ||
    installment.paidAmountPaise < 0 ||
    installment.paidAmountPaise > installment.amountPaise ||
    !Number.isFinite(new Date(installment.dueDate).getTime())
  ))) {
    throw new AppError(503, 'Fee data is inconsistent and cannot be assessed');
  }
  const unpaid = feePlan?.installments.filter(({ amountPaise, paidAmountPaise }) =>
    paidAmountPaise < amountPaise) ?? [];
  const overdue = unpaid
    .filter(({ dueDate }) => new Date(dueDate).getTime() < today.getTime())
    .map(({ dueDate }) => daysBetween(new Date(dueDate), today));
  const brokenPaymentPromises = Array.isArray(student.paymentPromises)
    ? student.paymentPromises.filter(({ status }) => status === 'broken').length
    : null;

  return {
    studentId: student.studentId,
    missedInstallments: feePlan ? overdue.length : null,
    overdueDays: feePlan ? overdue.length ? Math.max(...overdue) : 0 : null,
    attendancePercentage: Number.isFinite(student.attendancePercentage) ? student.attendancePercentage : null,
    testPerformanceTrend: performanceTrend(student.testPerformance),
    brokenPaymentPromises
  };
}

function validateAssessment(result, studentId) {
  const expectedLevel = result?.riskScore >= 60 ? 'HIGH' : result?.riskScore >= 30 ? 'MEDIUM' : 'LOW';
  const breakdown = result?.scoreBreakdown;
  if (!result || result.studentId !== studentId ||
      !['LOW', 'MEDIUM', 'HIGH'].includes(result.riskLevel) ||
      result.riskLevel !== expectedLevel ||
      !Number.isSafeInteger(result.riskScore) || result.riskScore < 0 || result.riskScore > 100 ||
      !Array.isArray(result.reasons) || !result.reasons.every((reason) => typeof reason === 'string') ||
      !Array.isArray(result.missingFeatures) || !result.missingFeatures.every((feature) => typeof feature === 'string') ||
      typeof result.recommendedAction !== 'string' ||
      result.assessmentMethod !== 'explainable_rules_baseline' ||
      typeof result.modelVersion !== 'string' ||
      !breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown) ||
      Object.values(breakdown).some((points) => !Number.isSafeInteger(points) || points < 0) ||
      Object.values(breakdown).reduce((total, points) => total + points, 0) !== result.riskScore ||
      result.recommendedAction !== (result.riskScore >= 30
        ? 'Create counsellor follow-up task'
        : 'Continue routine monitoring')) {
    throw new AppError(502, 'Risk service returned an invalid assessment');
  }
}

export async function createStudentRiskAssessment(models, studentId, {
  fetchImpl = globalThis.fetch,
  serviceUrl,
  serviceToken,
  timeoutMs = 5_000,
  actorId,
  now = new Date()
}) {
  const student = await models.Student.findOne({ studentId, isActive: true }).lean();
  if (!student) throw new AppError(404, 'Student not found');
  const feePlan = await models.FeePlan.findOne({ studentId }).lean();
  const features = getRiskFeatures(student, feePlan, now);

  let response;
  try {
    response = await fetchImpl(`${serviceUrl.replace(/\/+$/, '')}/predict-risk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {})
      },
      body: JSON.stringify(features),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new AppError(503, 'Student risk service is unavailable');
  }
  if (!response.ok) {
    throw new AppError(response.status >= 500 ? 503 : 502, 'Student risk service could not complete the assessment');
  }

  let assessment;
  try {
    assessment = await response.json();
  } catch {
    throw new AppError(502, 'Student risk service returned an invalid response');
  }
  validateAssessment(assessment, studentId);

  let task = null;
  if (assessment.riskScore >= 30) {
    const taskData = {
      studentId,
      studentName: student.name,
      riskLevel: assessment.riskLevel,
      riskScore: assessment.riskScore,
      reasons: assessment.reasons,
      scoreBreakdown: assessment.scoreBreakdown,
      features,
      missingFeatures: assessment.missingFeatures,
      recommendedAction: assessment.recommendedAction,
      assessmentMethod: assessment.assessmentMethod,
      modelVersion: assessment.modelVersion,
      createdBy: actorId
    };
    try {
      task = await models.CounsellorTask.findOneAndUpdate(
        { studentId, status: { $in: ['open', 'in_progress'] } },
        { $set: { ...taskData, openTaskStudentId: studentId } },
        { new: true, runValidators: true }
      );
      if (!task) {
        task = await models.CounsellorTask.findOneAndUpdate(
          { openTaskStudentId: studentId },
          {
            $set: { ...taskData, openTaskStudentId: studentId },
            $setOnInsert: { status: 'open' }
          },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
      }
    } catch (error) {
      if (error.code !== 11000) throw error;
      task = await models.CounsellorTask.findOneAndUpdate(
        { openTaskStudentId: studentId },
        { $set: taskData },
        { new: true, runValidators: true }
      );
      if (!task) throw error;
    }
  }

  await models.RiskAssessment.create({
    studentId,
    riskLevel: assessment.riskLevel,
    riskScore: assessment.riskScore,
    reasons: assessment.reasons,
    scoreBreakdown: assessment.scoreBreakdown,
    features,
    missingFeatures: assessment.missingFeatures,
    recommendedAction: assessment.recommendedAction,
    assessmentMethod: assessment.assessmentMethod,
    modelVersion: assessment.modelVersion,
    assessedBy: actorId,
    counsellorTaskId: task?._id ?? null,
    assessedAt: now
  });

  return { assessment, task };
}
