import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { api, getApiError } from '../api/client.js';
import { formatDate, formatPaise, studentLedgerStatus } from '../lib/money.js';

function SummaryCard({ label, value, detail, tone = '' }) {
  return (
    <article className={`summary-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function ChartPanel({ title, description, children, className = '' }) {
  return (
    <section className={`panel chart-panel ${className}`}>
      <div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
      {children}
    </section>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map(({ name, value, color }) => (
        <span key={name} style={{ color }}>{name}: {formatPaise(value)}</span>
      ))}
    </div>
  );
}

function CountChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map(({ name, value, color }) => (
        <span key={name} style={{ color }}>{name}: {value}</span>
      ))}
    </div>
  );
}

function shortRupees(paise) {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(0)}k`;
  return `₹${Math.round(rupees)}`;
}

export default function AccountsDashboardPage({ user }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/fees/dashboard');
      setDashboard(data.dashboard);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function exportCsv() {
    setExporting(true);
    setError('');
    try {
      const response = await api.get('/fees/export.csv', { responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `feeflow-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setExporting(false);
    }
  }

  const summary = dashboard?.summary;
  const metrics = dashboard?.metrics;
  const riskData = [
    { name: 'Low', count: metrics?.riskDistribution.low ?? 0, color: '#4a9c79' },
    { name: 'Medium', count: metrics?.riskDistribution.medium ?? 0, color: '#d5a052' },
    { name: 'High', count: metrics?.riskDistribution.high ?? 0, color: '#c56b62' }
  ];
  const reminderData = [
    { name: 'Pending', count: metrics?.reminders.pending ?? 0, color: '#d5a052' },
    { name: 'Sent', count: metrics?.reminders.sent ?? 0, color: '#4a9c79' },
    { name: 'Failed', count: metrics?.reminders.failed ?? 0, color: '#c56b62' },
    { name: 'Cancelled', count: metrics?.reminders.cancelled ?? 0, color: '#8a97a7' }
  ];
  return (
    <section className="accounts-dashboard">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">ACCOUNTS WORKSPACE</p>
          <h1>Fee overview</h1>
          <p>Collections, outstanding balances and overdue instalment ageing across active fee plans.</p>
        </div>
        <button className="button-primary" disabled={loading || exporting} onClick={exportCsv} type="button">
          {exporting ? 'Preparing CSV…' : 'Export dashboard CSV'}
        </button>
      </div>
      {error && <div className="notice-error" role="alert">{error}</div>}
      {loading ? (
        <div className="summary-grid" aria-label="Loading dashboard">
          {[1, 2, 3, 4, 5].map((item) => <div className="summary-skeleton" key={item} />)}
        </div>
      ) : summary && (
        <>
          <div className="summary-grid account-summary-grid">
            <SummaryCard label="Total billed" value={formatPaise(summary.totalFeesBilledPaise)} detail="Gross fees across active plans" />
            <SummaryCard label="Total collected" value={formatPaise(summary.totalFeesCollectedPaise)} detail="Completed ledger payments" tone="green" />
            <SummaryCard label="Outstanding" value={formatPaise(summary.totalOutstandingPaise)} detail="Net fee less amount collected" tone="blue" />
            <SummaryCard label="Overdue" value={formatPaise(summary.overdueAmountPaise)} detail="Outstanding on past-due instalments" tone="amber" />
            <SummaryCard label="Collection rate" value={`${summary.collectionPercentage}%`} detail="Collected divided by net fees billed" />
          </div>

          <div className="summary-grid account-summary-grid operational-summary-grid">
            <SummaryCard label="Active students" value={metrics.students.totalActive} detail="Valid active student records" tone="blue" />
            <SummaryCard label="Risk assessed" value={metrics.students.assessedForRisk} detail="Active students with a current assessment" />
            <SummaryCard label="Pending refunds" value={metrics.refunds.pending} detail="Awaiting Accounts review" tone="amber" />
            <SummaryCard label="Scheduled reminders" value={metrics.reminders.scheduled} detail="Waiting for their scheduled time" />
            <SummaryCard label="Pending reminders" value={metrics.reminders.pending} detail="Scheduled or currently sending" tone="blue" />
          </div>

          <div className="dashboard-chart-grid operational-chart-grid">
            <ChartPanel title="AI risk distribution" description="Latest assessment per active student">
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={riskData} margin={{ top: 8, right: 16, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="#edf1f5" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} width={35} />
                    <Tooltip content={<CountChartTooltip />} />
                    <Bar name="Students" dataKey="count" radius={[4, 4, 0, 0]}>
                      {riskData.map((entry) => <Cell fill={entry.color} key={entry.name} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>
            <ChartPanel title="Reminder status" description={`All ${metrics.reminders.total} reminders, grouped by delivery state`}>
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reminderData} margin={{ top: 8, right: 16, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="#edf1f5" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} width={35} />
                    <Tooltip content={<CountChartTooltip />} />
                    <Bar name="Reminders" dataKey="count" radius={[4, 4, 0, 0]}>
                      {reminderData.map((entry) => <Cell fill={entry.color} key={entry.name} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>
            <ChartPanel title="Refund review" description="Refunds grouped by current review status">
              <div className="refund-status-summary">
                <div><span>Pending review</span><strong>{metrics.refunds.pending}</strong></div>
                <div><span>Approved</span><strong>{metrics.refunds.approved}</strong></div>
                <div><span>Rejected</span><strong>{metrics.refunds.rejected}</strong></div>
              </div>
            </ChartPanel>
          </div>

          <div className="dashboard-chart-grid">
            <ChartPanel title="Monthly collection trend" description="Payments recorded in the last 12 calendar months">
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboard.monthlyCollectionTrend} margin={{ top: 8, right: 16, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="#edf1f5" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} tickFormatter={shortRupees} width={55} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line name="Collected" dataKey="collectedPaise" stroke="#3476a8" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>
            <ChartPanel title="Centre-wise collection" description="Net fees billed, collected and outstanding by centre">
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.centreWiseCollection} margin={{ top: 8, right: 12, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="#edf1f5" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} tickFormatter={shortRupees} width={55} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar name="Billed" dataKey="billedPaise" fill="#dbe7f2" radius={[4, 4, 0, 0]} />
                    <Bar name="Collected" dataKey="collectedPaise" fill="#4a9c79" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>
            <ChartPanel title="Batch-wise outstanding" description="Remaining balance grouped by batch">
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.batchWiseOutstanding} margin={{ top: 8, right: 12, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="#edf1f5" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} tickFormatter={shortRupees} width={55} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar name="Outstanding" dataKey="outstandingPaise" fill="#d5a052" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>
            <ChartPanel title="Overdue instalment ageing" description="Outstanding amount by days past due">
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.overdueAgeing} margin={{ top: 8, right: 12, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="#edf1f5" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 9 }} interval={0} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8a97a7', fontSize: 10 }} tickFormatter={shortRupees} width={55} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar name="Outstanding" dataKey="amountPaise" fill="#c56b62" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartPanel>
          </div>

          <section className="panel dashboard-ledgers">
            <div className="panel-heading">
              <div><h2>Instalment ageing detail</h2><p>Unpaid amounts grouped using UTC calendar days after the due date</p></div>
              <Link className="quiet-link" to="/fees">Open fee ledger <span aria-hidden="true">→</span></Link>
            </div>
            <div className="ageing-summary-grid">
              {dashboard.overdueAgeing.map((bucket) => (
                <article className="ageing-summary-card" key={bucket.key}>
                  <span>{bucket.label}</span>
                  <strong>{formatPaise(bucket.amountPaise)}</strong>
                  <small>{bucket.installmentCount} unpaid instalment{bucket.installmentCount === 1 ? '' : 's'}</small>
                </article>
              ))}
            </div>
            {dashboard.rows.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Student</th><th>Centre / batch</th><th>Instalment</th><th>Due date</th><th>Outstanding</th><th>Status</th><th /></tr></thead>
                  <tbody>{dashboard.rows.filter(({ outstandingPaise }) => outstandingPaise > 0).slice(0, 8).map((row, index) => (
                    <tr key={`${row.studentId}-${row.installmentNumber}-${index}`}>
                      <td><strong>{row.studentName}</strong><span className="table-subtext">{row.studentId}</span></td>
                      <td>{row.centre}<span className="table-subtext">{row.batch}</span></td>
                      <td>{row.installmentNumber}</td>
                      <td>{formatDate(row.dueDate)}</td>
                      <td className="amount-emphasis">{formatPaise(row.outstandingPaise)}</td>
                      <td><span className={`status-badge ${studentLedgerStatus({
                        feePlan: { installments: [{ status: row.status }] },
                        remainingBalancePaise: row.outstandingPaise
                      })}`}>{row.status.replace('_', ' ')}</span></td>
                      <td><Link className="row-link" to={`/fees/${row.studentId}`} aria-label={`View ${row.studentName} ledger`}>→</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="empty-state"><span>◷</span><h3>No fee plans yet</h3><p>Create a fee plan to populate collection and ageing insights.</p></div>}
          </section>
        </>
      )}
    </section>
  );
}
