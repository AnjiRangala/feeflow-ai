import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getApiError } from '../api/client.js';
import { formatPaise, studentLedgerStatus } from '../lib/money.js';

function SummaryCard({ label, value, detail, tone = '' }) {
  return (
    <article className={`summary-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

export default function HomePage({ user }) {
  const [summary, setSummary] = useState(null);
  const [ledgers, setLedgers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/fees/students'),
      user.role === 'accounts' ? api.get('/fees/summary') : Promise.resolve(null)
    ]).then(([studentsResponse, summaryResponse]) => {
      if (!active) return;
      const studentLedgers = studentsResponse.data.students;
      setLedgers(studentLedgers);
      if (summaryResponse) setSummary(summaryResponse.data.summary);
      else {
        const billed = studentLedgers.reduce((sum, item) => sum + (item.feePlan?.totalFeePaise ?? 0), 0);
        const collected = studentLedgers.reduce((sum, item) => sum + item.amountPaidPaise, 0);
        const outstanding = studentLedgers.reduce((sum, item) => sum + item.remainingBalancePaise, 0);
        setSummary({
          totalFeesBilledPaise: billed,
          totalFeesCollectedPaise: collected,
          totalOutstandingPaise: outstanding,
          overdueAmountPaise: studentLedgers.reduce((sum, item) => sum + (item.feePlan?.installments ?? [])
            .filter(({ status }) => status === 'overdue').reduce((partial, installment) => partial + installment.outstandingPaise, 0), 0),
          collectionPercentage: billed ? Number((collected / billed * 100).toFixed(2)) : 0
        });
      }
    }).catch((requestError) => {
      if (active) setError(getApiError(requestError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user.role]);

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">OVERVIEW</p>
          <h1>Good {new Date().getHours() < 12 ? 'morning' : 'day'}, {user.name.split(' ')[0]}</h1>
          <p>Here’s the current fee position across your institute.</p>
        </div>
        <Link className="button-primary" to="/fees">View fee ledger <span aria-hidden="true">→</span></Link>
      </div>
      {error && <div className="notice-error" role="alert">{error}</div>}
      {loading ? (
        <div className="summary-grid" aria-label="Loading dashboard">
          {[1, 2, 3, 4].map((item) => <div className="summary-skeleton" key={item} />)}
        </div>
      ) : summary && (
        <>
          <div className="summary-grid">
            <SummaryCard label="Total fees billed" value={formatPaise(summary.totalFeesBilledPaise)} detail="Across active fee plans" />
            <SummaryCard label="Fees collected" value={formatPaise(summary.totalFeesCollectedPaise)} detail={`${summary.collectionPercentage}% collection rate`} tone="green" />
            <SummaryCard label="Outstanding" value={formatPaise(summary.totalOutstandingPaise)} detail="Remaining student balances" tone="blue" />
            <SummaryCard label="Overdue" value={formatPaise(summary.overdueAmountPaise)} detail="Unpaid past-due instalments" tone="amber" />
          </div>
          <section className="panel dashboard-ledgers">
            <div className="panel-heading">
              <div><h2>Student accounts</h2><p>Latest fee ledger overview</p></div>
              <Link className="quiet-link" to="/fees">View all <span aria-hidden="true">→</span></Link>
            </div>
            {ledgers.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Student</th><th>Centre / batch</th><th>Total fee</th><th>Outstanding</th><th>Status</th><th /></tr></thead>
                  <tbody>{ledgers.slice(0, 6).map((ledger) => (
                    <tr key={ledger.student.studentId}>
                      <td><strong>{ledger.student.name}</strong><span className="table-subtext">{ledger.student.studentId}</span></td>
                      <td>{ledger.student.centre}<span className="table-subtext">{ledger.student.batch}</span></td>
                      <td>{formatPaise(ledger.feePlan?.totalFeePaise ?? 0)}</td>
                      <td className="amount-emphasis">{formatPaise(ledger.remainingBalancePaise)}</td>
                      <td><span className={`status-badge ${studentLedgerStatus(ledger)}`}>{studentLedgerStatus(ledger).replace('_', ' ')}</span></td>
                      <td><Link className="row-link" to={`/fees/${ledger.student.studentId}`} aria-label={`View ${ledger.student.name} fee details`}>→</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="empty-state"><span>◷</span><h3>No student records yet</h3><p>Student fee records will appear here when available.</p></div>}
          </section>
        </>
      )}
    </section>
  );
}
