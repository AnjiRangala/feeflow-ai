import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getApiError } from '../api/client.js';
import { formatDate, formatPaise } from '../lib/money.js';

const filters = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Pending' },
  { value: 'sent', label: 'Sent' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed', label: 'Failed' }
];

function statusLabel(status) {
  if (status === 'scheduled') return 'Pending';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function scheduleLabel(offsetDays) {
  if (offsetDays === 0) return 'On due date';
  return offsetDays > 0
    ? `${offsetDays} days before due`
    : `${Math.abs(offsetDays)} days after due`;
}

export default function ReminderCenterPage() {
  const [reminders, setReminders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [retryingId, setRetryingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadReminders = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/reminders');
      setReminders(data.reminders);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  const visibleReminders = useMemo(() => filter === 'all'
    ? reminders
    : reminders.filter(({ status }) => status === filter), [filter, reminders]);

  async function runCycle() {
    setProcessing(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/reminders/process');
      const result = data.result;
      setNotice(`Reminder cycle complete: ${result.scheduled} scheduled, ${result.sent} sent, ${result.cancelled} cancelled, ${result.failed} failed.`);
      await loadReminders();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setProcessing(false);
    }
  }

  async function retryReminder(reminderId) {
    setRetryingId(reminderId);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/reminders/${reminderId}/retry`);
      setNotice(data.result.sent
        ? 'Reminder retry sent through the mock message provider.'
        : 'Reminder retry was processed.');
      await loadReminders();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setRetryingId('');
    }
  }

  return (
    <section className="reminder-center">
      <div className="page-heading reminder-center-heading">
        <div>
          <p className="page-eyebrow">ACCOUNTS WORKSPACE</p>
          <h1>Reminder centre</h1>
          <p>Review and retry scheduled fee reminders. Messages use a mock provider and are not sent as SMS.</p>
        </div>
        <button className="primary-button reminder-run-button" disabled={processing} onClick={runCycle} type="button">
          {processing ? 'Running…' : 'Run reminder cycle'}
        </button>
      </div>

      {notice && <div className="notice-success" role="status">{notice}</div>}
      {error && <div className="notice-error" role="alert">{error}</div>}

      <section className="panel reminder-panel">
        <div className="reminder-toolbar">
          <div>
            <h2>Message activity</h2>
            <p>{reminders.length} reminder{reminders.length === 1 ? '' : 's'} across all statuses</p>
          </div>
          <div className="reminder-filters" aria-label="Filter reminders">
            {filters.map(({ value, label }) => (
              <button
                aria-pressed={filter === value}
                className={filter === value ? 'reminder-filter active' : 'reminder-filter'}
                key={value}
                onClick={() => setFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="reminder-empty" role="status">Loading reminders…</div>
        ) : visibleReminders.length === 0 ? (
          <div className="reminder-empty">
            <strong>No {filter === 'all' ? '' : `${filters.find(({ value }) => value === filter)?.label.toLowerCase()} `}reminders yet</strong>
            <span>Run a reminder cycle to schedule messages for unpaid instalments.</span>
          </div>
        ) : (
          <div className="reminder-list">
            {visibleReminders.map((reminder) => (
              <article className="reminder-item" key={reminder._id}>
                <div className="reminder-item-main">
                  <div className="reminder-item-heading">
                    <strong>{reminder.studentName}</strong>
                    <span className={`status-badge reminder-status ${reminder.status}`}>{statusLabel(reminder.status)}</span>
                  </div>
                  <span>{reminder.studentId} · Instalment {reminder.installmentNumber ?? ''}</span>
                  <span>{scheduleLabel(reminder.scheduleOffsetDays)} · {formatDate(reminder.scheduledAt)}</span>
                </div>
                <div className="reminder-item-amount">
                  <span>Outstanding</span>
                  <strong>{formatPaise(reminder.outstandingAmountPaise)}</strong>
                </div>
                <div className="reminder-item-meta">
                  <span>{reminder.language === 'hi' ? 'Hindi' : 'English'} · {reminder.attempts} attempt{reminder.attempts === 1 ? '' : 's'}</span>
                  {reminder.failureReason && <span className="reminder-reason error">Failure: {reminder.failureReason}</span>}
                  {reminder.cancellationReason && <span className="reminder-reason">Cancelled: {reminder.cancellationReason}</span>}
                  {reminder.status === 'failed' && (
                    <button
                      className="reminder-retry-button"
                      disabled={retryingId === reminder._id}
                      onClick={() => retryReminder(reminder._id)}
                      type="button"
                    >
                      {retryingId === reminder._id ? 'Retrying…' : 'Retry delivery'}
                    </button>
                  )}
                  <details className="reminder-message-preview">
                    <summary>Preview message</summary>
                    <p>{reminder.message}</p>
                  </details>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
