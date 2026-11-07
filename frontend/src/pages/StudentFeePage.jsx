import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getApiError } from '../api/client.js';
import { formatDate, formatPaise, parsePaise } from '../lib/money.js';

export default function StudentFeePage({ user }) {
  const { studentId } = useParams();
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [payment, setPayment] = useState({ installmentNumber: '', amount: '', transactionId: '', paymentMethod: 'upi' });

  async function loadLedger() {
    const { data } = await api.get(`/fees/student/${encodeURIComponent(studentId)}`);
    setLedger(data.student);
  }

  useEffect(() => {
    let active = true;
    api.get(`/fees/student/${encodeURIComponent(studentId)}`).then(({ data }) => {
      if (active) setLedger(data.student);
    }).catch((requestError) => {
      if (active) setError(getApiError(requestError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [studentId]);

  async function submitPayment(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const amountPaise = parsePaise(payment.amount);
    if (amountPaise === null) {
      setError('Enter a valid payment amount with no more than two decimal places.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/payments/record', {
        studentId,
        installmentNumber: Number(payment.installmentNumber),
        amountPaise,
        transactionId: payment.transactionId,
        paymentMethod: payment.paymentMethod
      });
      setNotice('Payment recorded and ledger updated.');
      setPayment({ ...payment, amount: '', transactionId: '' });
      await loadLedger();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="detail-skeleton" aria-label="Loading student details"><i /><i /><i /></div>;
  if (error && !ledger) return <section><Link className="back-link" to="/fees">← Back to ledger</Link><div className="notice-error" role="alert">{error}</div></section>;
  if (!ledger) return null;

  const { student, feePlan } = ledger;
  return (
    <section>
      <Link className="back-link" to="/fees">← Fee ledger</Link>
      <div className="page-heading detail-heading">
        <div><p className="page-eyebrow">STUDENT ACCOUNT · {student.studentId}</p><h1>{student.name}</h1><p>{student.batch} <span className="dot-divider">·</span> {student.centre}</p></div>
        {feePlan && <span className="status-badge large">{feePlan.numberOfInstallments} instalments</span>}
      </div>
      {error && <div className="notice-error" role="alert">{error}</div>}
      {notice && <div className="notice-success" role="status">{notice}</div>}
      <div className="student-overview-grid">
        <div className="student-info panel"><p className="panel-caption">STUDENT DETAILS</p><div><span>Parent email</span><strong>{student.parentEmail}</strong></div><div><span>Parent phone</span><strong>{student.parentPhone}</strong></div><div><span>Centre</span><strong>{student.centre}</strong></div></div>
        <div className="balance-card panel"><p className="panel-caption">REMAINING BALANCE</p><strong>{formatPaise(ledger.remainingBalancePaise)}</strong><div><span>Total fee {formatPaise(feePlan?.totalFeePaise ?? 0)}</span><span>Collected {formatPaise(ledger.amountPaidPaise)}</span></div></div>
      </div>
      {feePlan ? (
        <section className="panel detail-panel">
          <div className="panel-heading"><div><h2>Instalment schedule</h2><p>Discount {formatPaise(feePlan.discountPaise)} · Net payable {formatPaise(feePlan.netFeePaise)}</p></div></div>
          <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Instalment</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Days overdue</th><th>Status</th>{user.role === 'parent' && <th>Pay</th>}<th>Receipt</th></tr></thead>
            <tbody>{feePlan.installments.map((installment) => (
              <tr key={installment._id}><td><strong>Instalment {installment.installmentNumber}</strong></td><td>{formatDate(installment.dueDate)}</td><td>{formatPaise(installment.amountPaise)}</td><td>{formatPaise(installment.paidAmountPaise)}</td><td>{formatPaise(installment.outstandingPaise)}</td><td>{installment.daysOverdue || '—'}</td><td><span className={`status-badge ${installment.status}`}>{installment.status.replace('_', ' ')}</span></td>{user.role === 'parent' && <td>{installment.outstandingPaise > 0 && <Link className="parent-installment-pay" to={`/payments/${encodeURIComponent(student.studentId)}/${installment.installmentNumber}`}>Pay</Link>}</td>}</tr>
            ))}</tbody>
          </table></div>
        </section>
      ) : <div className="empty-state panel"><span>◷</span><h3>No fee plan assigned</h3><p>The accounts team has not created a fee plan for this student yet.</p></div>}
      {user.role === 'accounts' && feePlan && ledger.remainingBalancePaise > 0 && (
        <form className="panel payment-form" onSubmit={submitPayment}>
          <div className="panel-heading"><div><h2>Record a payment</h2><p>Recorded payments are applied atomically to the selected instalment.</p></div></div>
          <div className="form-grid">
            <label>Instalment<select required value={payment.installmentNumber} onChange={(event) => setPayment({ ...payment, installmentNumber: event.target.value })}>
              <option value="">Select instalment</option>{feePlan.installments.filter(({ outstandingPaise }) => outstandingPaise > 0).map((item) => <option key={item.installmentNumber} value={item.installmentNumber}>Instalment {item.installmentNumber} · balance {formatPaise(item.outstandingPaise)}</option>)}
            </select></label>
            <label>Amount (₹)<input required min="0.01" step="0.01" type="number" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></label>
            <label>Transaction ID<input required maxLength={120} value={payment.transactionId} onChange={(event) => setPayment({ ...payment, transactionId: event.target.value })} /></label>
            <label>Method<select value={payment.paymentMethod} onChange={(event) => setPayment({ ...payment, paymentMethod: event.target.value })}><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
          </div>
          <div className="form-actions"><span>Payment cannot exceed the remaining instalment balance.</span><button className="button-primary" disabled={saving} type="submit">{saving ? 'Recording…' : 'Record payment'}</button></div>
        </form>
      )}
      <section className="panel detail-panel">
        <div className="panel-heading"><div><h2>Payment history</h2><p>{ledger.paymentHistory.length} completed transactions</p></div></div>
        {ledger.paymentHistory.length ? <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Transaction</th><th>Date</th><th>Instalment</th><th>Method</th><th>Amount</th></tr></thead>
          <tbody>{ledger.paymentHistory.map((entry) => (
            <tr key={entry._id}><td><strong>{entry.transactionId}</strong></td><td>{formatDate(entry.paidAt)}</td><td>{feePlan?.installments.find(({ _id }) => String(_id) === String(entry.installmentId))?.installmentNumber ?? '—'}</td><td className="capitalize">{entry.paymentMethod.replace('_', ' ')}</td><td className="amount-emphasis">{formatPaise(entry.amountPaise)}</td><td><a className="quiet-link" href={`${api.defaults.baseURL}/parent-payments/receipts/${encodeURIComponent(entry._id)}`} onClick={async (event) => {
              event.preventDefault();
              try {
                const { data } = await api.get(`/parent-payments/receipts/${encodeURIComponent(entry._id)}`, { responseType: 'blob' });
                const url = URL.createObjectURL(data);
                const download = document.createElement('a');
                download.href = url;
                download.download = `feeflow-receipt-${entry._id}.html`;
                download.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (requestError) {
                setError(getApiError(requestError));
              }
            }}>Receipt</a></td></tr>
          ))}</tbody>
        </table></div> : <div className="empty-state compact"><span>↗</span><h3>No payments recorded</h3><p>New transactions will appear here after they are recorded.</p></div>}
      </section>
    </section>
  );
}
