import { useEffect, useMemo, useState } from 'react';
import { api, getApiError } from '../api/client.js';
import { formatDate, formatPaise, parsePaise } from '../lib/money.js';

function localDate(daysOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function inputRupees(paise) {
  return (paise / 100).toFixed(2);
}

function RefundBreakdown({ refund }) {
  const inputs = refund.policyInputs;
  const details = refund.calculationDetails;
  return (
    <div className="refund-report" id="refund-report">
      <div className="refund-report-header">
        <div><p className="page-eyebrow">POLICY CALCULATION · {inputs.policyVersion}</p><h2>Pro-rata refund calculation</h2></div>
        <span className={`status-badge ${refund.status}`}>{refund.status.replace('_', ' ')}</span>
      </div>
      <p className="refund-student-line"><strong>{refund.studentName}</strong><span>{refund.studentId}</span></p>
      <div className="refund-breakdown-grid">
        <div><span>Total course fee</span><strong>{formatPaise(inputs.totalCourseFeePaise)}</strong></div>
        <div><span>Net course fee</span><strong>{formatPaise(inputs.netCourseFeePaise)}</strong></div>
        <div><span>Amount paid</span><strong>{formatPaise(inputs.amountPaidPaise)}</strong></div>
        <div><span>Course duration</span><strong>{inputs.totalCourseDurationDays} days</strong></div>
        <div><span>Days completed</span><strong>{details.daysCompleted} days</strong></div>
        <div><span>Fee earned</span><strong>{formatPaise(details.feeEarnedPaise)}</strong></div>
        <div><span>Non-refundable charges</span><strong>{formatPaise(inputs.nonRefundableChargesPaise)}</strong></div>
        <div className="refund-result"><span>Refundable amount · zero floor applied</span><strong>{formatPaise(refund.refundAmountPaise)}</strong></div>
      </div>
      <div className="refund-formula">
        <strong>Calculation</strong>
        <span>{formatPaise(inputs.amountPaidPaise)} − {formatPaise(details.feeEarnedPaise)} − {formatPaise(inputs.nonRefundableChargesPaise)}</span>
        <span>Refundable amount after applying max(0, result): {formatPaise(refund.refundAmountPaise)}</span>
      </div>
      <p className="refund-assumption"><strong>Demonstration assumption:</strong> {details.assumption} {details.rounding}</p>
      <p className="refund-assumption">Course start: {formatDate(inputs.courseStartDate)} · Withdrawal: {formatDate(inputs.withdrawalDate)}</p>
    </div>
  );
}

export default function RefundCalculatorPage() {
  const [ledgers, setLedgers] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [courseStartDate, setCourseStartDate] = useState('');
  const [withdrawalDate, setWithdrawalDate] = useState(localDate());
  const [durationDays, setDurationDays] = useState('90');
  const [nonRefundableCharges, setNonRefundableCharges] = useState('0');
  const [netCourseFee, setNetCourseFee] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [activeRefund, setActiveRefund] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadData() {
    setError('');
    try {
      const [ledgerResponse, refundResponse] = await Promise.all([
        api.get('/fees/students'),
        api.get('/refunds')
      ]);
      const nextLedgers = ledgerResponse.data.students;
      setLedgers(nextLedgers);
      setRefunds(refundResponse.data.refunds);
      if (!selectedId && nextLedgers.length) {
        setSelectedId(nextLedgers.find(({ feePlan: plan }) => plan)?.student.studentId ?? '');
      }
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const selectedLedger = useMemo(() => ledgers.find(({ student }) => student.studentId === selectedId), [ledgers, selectedId]);
  const feePlan = selectedLedger?.feePlan;
  const netCourseFeeInput = netCourseFee || (feePlan ? inputRupees(feePlan.netFeePaise) : '');
  const amountPaidInput = amountPaid || (selectedLedger ? inputRupees(selectedLedger.amountPaidPaise) : '');

  async function calculateRefund(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const nonRefundableChargesPaise = parsePaise(nonRefundableCharges);
    const netCourseFeePaise = parsePaise(netCourseFeeInput);
    const amountPaidPaise = parsePaise(amountPaidInput);
    if (!selectedId || !courseStartDate || !withdrawalDate ||
        !Number.isSafeInteger(Number(durationDays)) || Number(durationDays) < 1 ||
        nonRefundableChargesPaise === null || netCourseFeePaise === null || amountPaidPaise === null) {
      setError('Select a student and enter valid dates, duration, and non-negative rupee amounts.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/refunds/calculate', {
        studentId: selectedId,
        courseStartDate,
        withdrawalDate,
        totalCourseDurationDays: Number(durationDays),
        netCourseFeePaise,
        amountPaidPaise,
        nonRefundableChargesPaise,
        overrideReason
      });
      const refund = {
        ...data.refund,
      };
      setActiveRefund(refund);
      setRefunds((current) => [refund, ...current]);
      setNotice('Calculation report saved for accounts review. No refund has been issued.');
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function review(refundId, decision) {
    setReviewingId(refundId);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/refunds/${refundId}/${decision}`, {});
      setRefunds((current) => current.map((refund) => refund._id === refundId ? data.refund : refund));
      if (activeRefund?._id === refundId) setActiveRefund(data.refund);
      setNotice(decision === 'approve'
        ? 'Refund calculation approved. Disbursement was not initiated.'
        : 'Refund calculation rejected. No disbursement was initiated.');
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setReviewingId('');
    }
  }

  return (
    <section className="refund-page">
      <div className="page-heading non-printable">
        <div>
          <p className="page-eyebrow">ACCOUNTS WORKSPACE</p>
          <h1>Refund calculator</h1>
          <p>Prepare a policy-versioned pro-rata calculation for review. Approval never transfers or issues funds.</p>
        </div>
      </div>
      <div className="refund-policy-notice non-printable" role="note">
        <strong>Demonstration policy assumption · no legal formula asserted</strong>
        <span>Refundable amount = amount paid − fee earned − non-refundable charges. Fee earned is prorated by completed course days. Confirm your institution’s published policy before relying on any calculation.</span>
      </div>
      {error && <div className="notice-error non-printable" role="alert">{error}</div>}
      {notice && <div className="notice-success non-printable" role="status">{notice}</div>}

      <div className="refund-workspace non-printable">
        <form className="panel refund-form" onSubmit={calculateRefund}>
          <div className="panel-heading"><div><h2>Calculation inputs</h2><p>Course dates, duration and non-refundable charges for this case</p></div></div>
          <div className="refund-form-fields">
            <label>Student
              <select required value={selectedId} onChange={(event) => {
                setSelectedId(event.target.value);
                setActiveRefund(null);
                const nextLedger = ledgers.find(({ student }) => student.studentId === event.target.value);
                setNetCourseFee(nextLedger?.feePlan ? inputRupees(nextLedger.feePlan.netFeePaise) : '');
                setAmountPaid(nextLedger ? inputRupees(nextLedger.amountPaidPaise) : '');
                setOverrideReason('');
              }}>
                {ledgers.filter(({ feePlan: plan }) => plan).map(({ student }) => (
                  <option key={student.studentId} value={student.studentId}>{student.name} · {student.studentId}</option>
                ))}
                {!ledgers.some(({ feePlan: plan }) => plan) && <option value="">No fee plans available</option>}
              </select>
            </label>
            <label>Course start date<input required type="date" value={courseStartDate} onChange={(event) => setCourseStartDate(event.target.value)} /></label>
            <label>Withdrawal date<input required type="date" value={withdrawalDate} onChange={(event) => setWithdrawalDate(event.target.value)} /></label>
            <label>Total course duration (days)<input required min="1" max="36500" step="1" type="number" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} /></label>
            <label>Net course fee (₹)<input required min="0" step="0.01" type="number" value={netCourseFeeInput} onChange={(event) => setNetCourseFee(event.target.value)} /></label>
            <label>Amount paid (₹)<input required min="0" step="0.01" type="number" value={amountPaidInput} onChange={(event) => setAmountPaid(event.target.value)} /></label>
            <label>Non-refundable charges (₹)<input required min="0" step="0.01" type="number" value={nonRefundableCharges} onChange={(event) => setNonRefundableCharges(event.target.value)} /></label>
            <label className="refund-form-wide">Ledger override reason (if changing fee/paid amount)<input maxLength="500" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
          </div>
          {selectedLedger && feePlan && (
            <div className="refund-ledger-snapshot">
              <strong>Ledger source · {selectedLedger.student.name}</strong>
              <span>Total course fee: {formatPaise(feePlan.totalFeePaise)}</span>
              <span>Ledger net course fee: {formatPaise(feePlan.netFeePaise)}</span>
              <span>Ledger paid amount: {formatPaise(selectedLedger.amountPaidPaise)}</span>
            </div>
          )}
          <div className="refund-form-actions">
            <span>Ledger values are prefilled. Any manual fee/paid override requires a reason and is saved with the report.</span>
            <button className="button-primary" disabled={saving || loading || !feePlan} type="submit">{saving ? 'Calculating…' : 'Generate calculation report'}</button>
          </div>
        </form>

        <section className="panel refund-queue">
          <div className="panel-heading"><div><h2>Review queue</h2><p>Calculations awaiting an accounts decision</p></div></div>
          {loading ? <div className="empty-state compact">Loading refund records…</div> : refunds.length ? (
            <div className="refund-queue-list">
              {refunds.map((refund) => (
                <article className="refund-queue-item" key={refund._id}>
                  <button className="refund-queue-select" onClick={() => setActiveRefund(refund)} type="button">
                    <strong>{refund.studentName}</strong>
                    <span>{refund.studentId} · {formatDate(refund.createdAt)}</span>
                    <b>{formatPaise(refund.refundAmountPaise)}</b>
                    <span className={`status-badge ${refund.status}`}>{refund.status.replace('_', ' ')}</span>
                  </button>
                  {refund.status === 'pending_review' && (
                    <div className="refund-review-actions">
                      <button disabled={reviewingId === refund._id} onClick={() => review(refund._id, 'approve')} type="button">Approve</button>
                      <button disabled={reviewingId === refund._id} onClick={() => review(refund._id, 'reject')} type="button">Reject</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : <div className="empty-state compact"><span>₹</span><h3>No refund calculations</h3><p>Generated reports will be listed here for review.</p></div>}
        </section>
      </div>

      {activeRefund && (
        <section className="panel refund-report-panel">
          <div className="refund-report-actions non-printable">
            <span>Saved report · {activeRefund.status.replace('_', ' ')}</span>
            <button className="button-primary" onClick={() => window.print()} type="button">Print report</button>
          </div>
          <RefundBreakdown refund={activeRefund} />
          <p className="refund-no-disbursement">Calculation and approval are records only. This application does not issue refunds.</p>
        </section>
      )}
    </section>
  );
}
