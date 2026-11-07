import { useCallback, useEffect, useState } from 'react';
import { api, getApiError } from '../api/client.js';

function RiskBadge({ level }) {
  return <span className={`risk-badge risk-${level.toLowerCase()}`}>{level}</span>;
}

const featureLabels = {
  missedInstallments: 'Missed instalments',
  overdueDays: 'Overdue days',
  attendancePercentage: 'Attendance',
  testPerformanceTrend: 'Test performance trend',
  brokenPaymentPromises: 'Broken promises'
};

function TaskCard({ task, canReview, onFeedback, feedbackTaskId }) {
  const scoredFeatures = Object.entries(task.scoreBreakdown ?? {}).filter(([, points]) => points > 0);
  return (
    <article className="risk-task-card">
      <div className="risk-task-heading">
        <div>
          <h3>{task.studentName || task.studentId}</h3>
          <p>{task.studentId} <span aria-hidden="true">·</span> {task.createdAt ? new Date(task.createdAt).toLocaleDateString() : 'Recently assessed'}</p>
        </div>
        <RiskBadge level={task.riskLevel} />
      </div>
      <div className="risk-score-row">
        <strong>{task.riskScore ?? '—'}<span>{task.riskScore === null || task.riskScore === undefined ? '' : '/100'}</span></strong>
        <div className="risk-score-track" role="img" aria-label={Number.isSafeInteger(task.riskScore) ? `Risk score ${task.riskScore} out of 100` : 'Risk score unavailable'}>
          {Number.isSafeInteger(task.riskScore) && <span className={`risk-score-fill risk-${task.riskLevel.toLowerCase()}`} style={{ width: `${task.riskScore}%` }} />}
        </div>
        <span className="risk-task-status">{task.status.replace('_', ' ')}</span>
      </div>
      <p className="risk-recommendation">{task.recommendedAction}</p>
      {task.reasons.length > 0 ? (
        <ul className="risk-reasons">{task.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      ) : <p className="risk-no-reasons">No elevated indicators were found in available data.</p>}
      {scoredFeatures.length > 0 && (
        <dl className="risk-score-details">
          {scoredFeatures.map(([feature, points]) => (
            <div key={feature}><dt>{featureLabels[feature] ?? feature}</dt><dd>+{points}</dd></div>
          ))}
        </dl>
      )}
      {task.missingFeatures?.length > 0 && (
        <p className="risk-missing-data">Data unavailable: {task.missingFeatures.join(', ')}</p>
      )}
      <div className="risk-task-footer">
        <span>Method: {task.assessmentMethod?.replaceAll('_', ' ')}</span>
        {task.feedback && <span className={`risk-feedback-label ${task.feedback === 'valid' ? 'valid' : 'false'}`}>
          Counsellor marked {task.feedback === 'valid' ? 'valid' : 'false flag'}
        </span>}
      </div>
      {canReview && !task.feedback && (
        <div className="risk-review-actions">
          <button disabled={feedbackTaskId === task._id} onClick={() => onFeedback(task._id, 'valid')} type="button">
            {feedbackTaskId === task._id ? 'Saving…' : 'Mark valid'}
          </button>
          <button disabled={feedbackTaskId === task._id} onClick={() => onFeedback(task._id, 'false_flag')} type="button">
            Mark false flag
          </button>
        </div>
      )}
    </article>
  );
}

export default function AiRiskMonitorPage({ user }) {
  const [tasks, setTasks] = useState([]);
  const [students, setStudents] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [feedbackTaskId, setFeedbackTaskId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canAssess = user.role === 'accounts';
  const canReview = user.role === 'counsellor';

  const loadData = useCallback(async () => {
    setError('');
    try {
      const taskResponse = await api.get('/risks/tasks');
      setTasks(taskResponse.data.tasks);
      if (canAssess) {
        const studentResponse = await api.get('/fees/students');
        const available = studentResponse.data.students.map(({ student, feePlan }) => ({
          studentId: student.studentId,
          name: student.name,
          batch: student.batch,
          hasFeePlan: Boolean(feePlan)
        }));
        setStudents(available);
        setSelectedStudentId((current) => current || available[0]?.studentId || '');
      }
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [canAssess]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function assessStudent() {
    if (!selectedStudentId) return;
    setAssessing(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/risks/assess', { studentId: selectedStudentId });
      setAssessments((previous) => [
        { ...data.assessment, studentName: students.find(({ studentId }) => studentId === selectedStudentId)?.name, taskStatus: data.task?.status ?? 'not_required' },
        ...previous.filter(({ studentId }) => studentId !== selectedStudentId)
      ]);
      setNotice(data.task
        ? 'Assessment saved as a counsellor follow-up task. No fee or reminder records were changed.'
        : 'No follow-up task was created for this low-risk assessment. No fee or reminder records were changed.');
      await loadData();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setAssessing(false);
    }
  }

  async function recordFeedback(taskId, feedback) {
    setFeedbackTaskId(taskId);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/risks/tasks/${taskId}/feedback`, { feedback });
      setTasks((previous) => previous.map((task) => task._id === taskId ? data.task : task));
      setNotice(`Counsellor feedback saved: ${feedback === 'valid' ? 'valid flag' : 'false flag'}.`);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setFeedbackTaskId('');
    }
  }

  return (
    <section className="risk-monitor">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">{canReview ? 'COUNSELLOR WORKSPACE' : 'STUDENT SUPPORT'}</p>
          <h1>AI Risk Monitor</h1>
          <p>Explainable indicators for supportive human follow-up. A risk flag is not a decision about a student.</p>
        </div>
      </div>

      <div className="risk-safety-note" role="note">
        <strong>Human review only</strong>
        <span>This transparent rules baseline cannot change fees, send reminders, suspend students, or apply penalties. Student data stays within the configured FeeFlow services.</span>
      </div>
      {notice && <div className="notice-success" role="status">{notice}</div>}
      {error && <div className="notice-error" role="alert">{error}</div>}

      {canAssess && (
        <section className="panel risk-assessment-panel">
          <div className="panel-heading">
            <div><h2>Run a student assessment</h2><p>Uses available attendance, fee, assessment trend, and recorded promise data.</p></div>
          </div>
          <div className="risk-assess-controls">
            {students.length === 0 ? <p>No students are available for assessment.</p> : (
              <>
                <label htmlFor="risk-student">Student</label>
                <select id="risk-student" value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>
                  {students.map((student) => (
                    <option key={student.studentId} value={student.studentId}>
                      {student.name} · {student.studentId}{student.hasFeePlan ? '' : ' · fee plan unavailable'}
                    </option>
                  ))}
                </select>
                <button className="button-primary" disabled={assessing || !selectedStudentId} onClick={assessStudent} type="button">
                  {assessing ? 'Assessing…' : 'Assess student'}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {assessments.length > 0 && (
        <section className="panel risk-latest-panel">
          <div className="panel-heading"><div><h2>Latest assessment</h2><p>Current session result from the local rules baseline.</p></div></div>
          <div className="risk-task-list">
            {assessments.map((assessment) => (
              <TaskCard
                canReview={false}
                key={assessment.studentId}
                task={{
                  ...assessment,
                  _id: assessment.studentId,
                  status: assessment.taskStatus,
                  createdAt: new Date().toISOString()
                }}
              />
            ))}
          </div>
        </section>
      )}

      <section className="panel risk-tasks-panel">
        <div className="panel-heading"><div><h2>Counsellor follow-up tasks</h2><p>Open flags and recorded human feedback.</p></div></div>
        {loading ? <div className="risk-empty-state" role="status">Loading risk tasks…</div>
          : tasks.length === 0 ? <div className="risk-empty-state">No follow-up tasks yet. Assessments with medium or high indicators appear here.</div>
            : <div className="risk-task-list">
              {tasks.map((task) => <TaskCard
                canReview={canReview}
                feedbackTaskId={feedbackTaskId}
                key={task._id}
                onFeedback={recordFeedback}
                task={task}
              />)}
            </div>}
      </section>
    </section>
  );
}
