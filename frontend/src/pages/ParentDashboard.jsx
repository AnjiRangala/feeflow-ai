import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getApiError } from '../api/client.js';
import { formatDate, formatPaise } from '../lib/money.js';

export default function ParentDashboard() {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [languageSaving, setLanguageSaving] = useState(false);
  const [languageMessage, setLanguageMessage] = useState('');
  const [languageError, setLanguageError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/fees/students').then(({ data }) => {
      if (active) setLedger(data.students[0] ?? null);
    }).catch((requestError) => {
      if (active) setError(getApiError(requestError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    api.get('/reminders/preferences').then(({ data }) => {
      if (active) setPreferredLanguage(data.preferredLanguage === 'hi' ? 'hi' : 'en');
    }).catch((requestError) => {
      if (active) setLanguageError(getApiError(requestError));
    });
    return () => { active = false; };
  }, []);

  async function saveLanguage(event) {
    const language = event.target.value;
    const previousLanguage = preferredLanguage;
    setPreferredLanguage(language);
    setLanguageSaving(true);
    setLanguageError('');
    setLanguageMessage('');
    try {
      await api.post('/reminders/preferences', { preferredLanguage: language });
      setLanguageMessage('Reminder language saved.');
    } catch (requestError) {
      setPreferredLanguage(previousLanguage);
      setLanguageError(getApiError(requestError));
    } finally {
      setLanguageSaving(false);
    }
  }

  if (loading) return <div className="parent-loading" aria-label="Loading student fee details"><i /><i /><i /></div>;
  if (error) return <section><div className="notice-error" role="alert">{error}</div></section>;
  if (!ledger) return (
    <section className="panel parent-empty">
      <h1>No linked student found</h1>
      <p>Contact the accounts team to link your parent account to a student.</p>
    </section>
  );

  const { student, feePlan } = ledger;
  const installments = feePlan?.installments ?? [];
  const payableInstallments = installments
    .filter(({ outstandingPaise }) => outstandingPaise > 0)
    .sort((left, right) => new Date(left.dueDate) - new Date(right.dueDate));
  const overdue = installments.filter(({ status, outstandingPaise }) => status === 'overdue' && outstandingPaise > 0);
  const upcoming = installments.filter(({ status, outstandingPaise }) =>
    ['upcoming', 'partially_paid'].includes(status) && outstandingPaise > 0
  );
  const nextInstallment = payableInstallments[0];

  return (
    <section className="parent-dashboard">
      <div className="page-heading">
        <div><p className="page-eyebrow">PARENT PORTAL</p><h1>Hello, {student.name.split(' ')[0]}</h1><p>Your student’s fee account at a glance.</p></div>
      </div>
      <section className="panel reminder-language-panel">
        <div><strong>Fee reminder language</strong><span>Choose the language used for scheduled mock reminders.</span></div>
        <label>
          <span className="sr-only">Preferred reminder language</span>
          <select aria-label="Preferred reminder language" disabled={languageSaving} onChange={saveLanguage} value={preferredLanguage}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </label>
        {languageSaving && <span className="reminder-language-feedback">Saving…</span>}
        {languageMessage && <span className="reminder-language-feedback success">{languageMessage}</span>}
        {languageError && <span className="reminder-language-feedback error" role="alert">{languageError}</span>}
      </section>
      <section className="parent-priority-card" aria-label="Amount due and next payment">
        <div>
          <span className="parent-card-label">TOTAL OUTSTANDING</span>
          <strong className="parent-due-amount">{formatPaise(ledger.remainingBalancePaise)}</strong>
          <span className="parent-next-date">{nextInstallment
            ? `${nextInstallment.status === 'overdue' ? 'Past due' : 'Next due'} · ${formatDate(nextInstallment.dueDate)}`
            : 'No payment due'}</span>
        </div>
        {nextInstallment ? (
          <Link className="parent-pay-button" to={`/payments/${encodeURIComponent(student.studentId)}/${nextInstallment.installmentNumber}`}>
            Pay now <span aria-hidden="true">→</span>
          </Link>
        ) : <span className="parent-paid-indicator">{feePlan ? 'All caught up' : 'No fee plan assigned'}</span>}
      </section>

      <div className="parent-identity panel">
        <span className="parent-student-avatar" aria-hidden="true">{student.name.slice(0, 1).toUpperCase()}</span>
        <div><span className="panel-caption">STUDENT</span><strong>{student.name}</strong><span>{student.studentId} · {student.batch}</span></div>
        <Link className="quiet-link" to={`/fees/${encodeURIComponent(student.studentId)}`}>Profile &amp; fees →</Link>
      </div>

      <div className="parent-stat-grid">
        <article className="parent-stat panel"><span>Total course fee</span><strong>{formatPaise(feePlan?.totalFeePaise ?? 0)}</strong></article>
        <article className="parent-stat panel"><span>Total paid</span><strong>{formatPaise(ledger.amountPaidPaise)}</strong></article>
        <article className="parent-stat panel"><span>Outstanding balance</span><strong>{formatPaise(ledger.remainingBalancePaise)}</strong></article>
      </div>

      <section className="panel parent-installment-panel">
        <div className="panel-heading"><div><h2>Instalment schedule</h2><p>{overdue.length} overdue · {upcoming.length} upcoming</p></div></div>
        {installments.length ? (
          <div className="parent-installment-list">
            {installments.map((installment) => (
              <article className="parent-installment" key={installment._id}>
                <div className="parent-installment-main">
                  <strong>Instalment {installment.installmentNumber}</strong>
                  <span>{formatDate(installment.dueDate)} · {formatPaise(installment.outstandingPaise)} due</span>
                </div>
                <span className={`status-badge ${installment.status}`}>{installment.status.replace('_', ' ')}</span>
                {installment.outstandingPaise > 0 && (
                  <Link aria-label={`Pay instalment ${installment.installmentNumber}`} className="parent-installment-pay" to={`/payments/${encodeURIComponent(student.studentId)}/${installment.installmentNumber}`}>Pay</Link>
                )}
              </article>
            ))}
          </div>
        ) : <div className="empty-state compact"><h3>No fee plan assigned</h3><p>Your instalment schedule will appear here.</p></div>}
      </section>

      <Link className="parent-profile-link" to={`/fees/${encodeURIComponent(student.studentId)}`}>View student profile, fee details and payment history →</Link>
    </section>
  );
}
