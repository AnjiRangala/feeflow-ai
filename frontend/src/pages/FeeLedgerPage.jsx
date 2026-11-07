import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getApiError } from '../api/client.js';
import { formatPaise, parsePaise, studentLedgerStatus } from '../lib/money.js';

const filters = ['all', 'upcoming', 'partially_paid', 'overdue', 'paid', 'no_plan'];

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function FeeLedgerPage({ user }) {
  const [ledgers, setLedgers] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planForm, setPlanForm] = useState({
    studentId: '', totalFee: '', discount: '0', count: '4', dueDates: [dateOffset(30), dateOffset(60), dateOffset(90), dateOffset(120)], amounts: ''
  });

  async function loadLedgers() {
    const { data } = await api.get('/fees/students');
    setLedgers(data.students);
  }

  useEffect(() => {
    let active = true;
    api.get('/fees/students').then(({ data }) => {
      if (active) setLedgers(data.students);
    }).catch((requestError) => {
      if (active) setError(getApiError(requestError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => ledgers.filter((ledger) => {
    const search = query.trim().toLowerCase();
    const student = ledger.student;
    const matchesText = !search || [student.name, student.studentId, student.centre, student.batch]
      .some((value) => value?.toLowerCase().includes(search));
    return matchesText && (status === 'all' || studentLedgerStatus(ledger) === status);
  }), [ledgers, query, status]);

  const unplanned = ledgers.filter((ledger) => !ledger.feePlan);
  const selectedCount = Number(planForm.count);

  async function submitPlan(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const totalFeePaise = parsePaise(planForm.totalFee);
    const discountPaise = parsePaise(planForm.discount);
    const amountsPaise = planForm.amounts.trim()
      ? planForm.amounts.split(',').map((amount) => parsePaise(amount.trim()))
      : undefined;
    if (totalFeePaise === null || discountPaise === null || amountsPaise?.some((amount) => amount === null)) {
      setError('Enter monetary amounts with no more than two decimal places.');
      return;
    }
    setSaving(true);
    try {
      const dueDates = planForm.dueDates.slice(0, selectedCount);
      await api.post('/fees/create-plan', {
        studentId: planForm.studentId, totalFeePaise, discountPaise, dueDates, amountsPaise
      });
      setNotice('Fee plan created successfully.');
      setFormOpen(false);
      setPlanForm((current) => ({ ...current, totalFee: '', discount: '0', amounts: '' }));
      await loadLedgers();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="page-heading">
        <div><p className="page-eyebrow">{user.role === 'accounts' ? 'ACCOUNTS' : 'PARENT PORTAL'}</p><h1>Fee ledger</h1><p>{user.role === 'accounts' ? 'Search student fee plans, instalments and balances.' : 'Your linked student’s fee plan, instalments and balance.'}</p></div>
        {user.role === 'accounts' && unplanned.length > 0 && (
          <button className="button-primary" onClick={() => setFormOpen((open) => !open)} type="button">
            {formOpen ? 'Close form' : '+ Create fee plan'}
          </button>
        )}
      </div>
      {error && <div className="notice-error" role="alert">{error}</div>}
      {notice && <div className="notice-success" role="status">{notice}</div>}
      {formOpen && (
        <form className="panel create-plan-form" onSubmit={submitPlan}>
          <div className="panel-heading"><div><h2>New fee plan</h2><p>All amounts are entered in rupees and stored as integer paise.</p></div></div>
          <div className="form-grid">
            <label>Student<select required value={planForm.studentId} onChange={(event) => setPlanForm({ ...planForm, studentId: event.target.value })}>
              <option value="">Select a student</option>{unplanned.map(({ student }) => <option key={student.studentId} value={student.studentId}>{student.name} · {student.studentId}</option>)}
            </select></label>
            <label>Total course fee (₹)<input required min="0.01" step="0.01" type="number" value={planForm.totalFee} onChange={(event) => setPlanForm({ ...planForm, totalFee: event.target.value })} /></label>
            <label>Discount (₹)<input min="0" step="0.01" type="number" value={planForm.discount} onChange={(event) => setPlanForm({ ...planForm, discount: event.target.value })} /></label>
            <label>Instalments<select value={planForm.count} onChange={(event) => setPlanForm({ ...planForm, count: event.target.value })}><option value="3">3 instalments</option><option value="4">4 instalments</option></select></label>
            {planForm.dueDates.slice(0, selectedCount).map((date, index) => (
              <label key={index}>Instalment {index + 1} due date<input required type="date" value={date} onChange={(event) => {
                const dueDates = [...planForm.dueDates];
                dueDates[index] = event.target.value;
                setPlanForm({ ...planForm, dueDates });
              }} /></label>
            ))}
            <label className="form-grid-wide">Custom instalment amounts (₹, comma-separated)<input placeholder="Leave blank to split the net fee evenly" value={planForm.amounts} onChange={(event) => setPlanForm({ ...planForm, amounts: event.target.value })} /></label>
          </div>
          <div className="form-actions"><span>Custom amounts must add up exactly to the net fee.</span><button className="button-primary" disabled={saving} type="submit">{saving ? 'Creating…' : 'Create plan'}</button></div>
        </form>
      )}
      <section className="panel ledger-panel">
        <div className="ledger-controls">
          <label className="search-control"><span aria-hidden="true">⌕</span><input aria-label="Search students" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID, centre or batch" value={query} /></label>
          <label className="filter-control"><span>Status</span><select aria-label="Filter by payment status" onChange={(event) => setStatus(event.target.value)} value={status}>
            {filters.map((filter) => <option key={filter} value={filter}>{filter === 'all' ? 'All statuses' : filter.replace('_', ' ')}</option>)}
          </select></label>
          <span className="result-count">{visible.length} students</span>
        </div>
        {loading ? <div className="table-skeleton" aria-label="Loading fee ledger"><i /><i /><i /><i /></div> : visible.length ? (
          <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Student</th><th>Centre / batch</th><th>Total fee</th><th>Discount</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead>
            <tbody>{visible.map((ledger) => (
              <tr key={ledger.student.studentId}>
                <td><strong>{ledger.student.name}</strong><span className="table-subtext">{ledger.student.studentId}</span></td>
                <td>{ledger.student.centre}<span className="table-subtext">{ledger.student.batch}</span></td>
                <td>{formatPaise(ledger.feePlan?.totalFeePaise ?? 0)}</td>
                <td>{formatPaise(ledger.feePlan?.discountPaise ?? 0)}</td>
                <td>{formatPaise(ledger.amountPaidPaise)}</td>
                <td className="amount-emphasis">{formatPaise(ledger.remainingBalancePaise)}</td>
                <td><span className={`status-badge ${studentLedgerStatus(ledger)}`}>{studentLedgerStatus(ledger).replace('_', ' ')}</span></td>
                <td><Link className="row-link" to={`/fees/${ledger.student.studentId}`} aria-label={`Open ${ledger.student.name} ledger`}>→</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty-state"><span>⌕</span><h3>No matching fee records</h3><p>Try changing your search or status filter.</p></div>}
      </section>
    </section>
  );
}
