import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api, getApiError } from '../api/client.js';
import { formatDate, formatPaise } from '../lib/money.js';

export default function ParentPaymentPage({ user }) {
  const { studentId, installmentNumber: installmentParam } = useParams();
  const installmentNumber = Number(installmentParam);
  const [ledger, setLedger] = useState(null);
  const [order, setOrder] = useState(null);
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

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

  if (user.role !== 'parent') return <Navigate to="/" replace />;
  if (!Number.isInteger(installmentNumber) || installmentNumber < 1) return <Navigate to="/" replace />;

  async function createOrder() {
    setError('');
    setProcessing(true);
    try {
      const { data } = await api.post('/parent-payments/orders', { installmentNumber });
      setOrder(data.order);
      setPayment(null);
    } catch (requestError) {
      setError(getApiError(requestError));
      if (requestError.response?.status === 409) {
        try {
          await loadLedger();
        } catch (refreshError) {
          setError(getApiError(refreshError));
        }
      }
    } finally {
      setProcessing(false);
    }
  }

  async function completeOrder(outcome) {
    setError('');
    setProcessing(true);
    try {
      const { data } = await api.post(`/parent-payments/orders/${encodeURIComponent(order.id)}/complete`, { outcome });
      setOrder(data.order);
      if (data.payment) {
        setPayment(data.payment);
        await loadLedger();
      }

      async function startRazorpayCheckout() {
        setError('');
        setProcessing(true);
        try {
          if (!window.Razorpay) {
            await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = 'https://checkout.razorpay.com/v1/checkout.js';
              script.onload = resolve;
              script.onerror = () => reject(new Error('Razorpay checkout could not load'));
              document.head.appendChild(script);
            });
          }
          await new Promise((resolve, reject) => {
            const checkout = new window.Razorpay({
              key: order.razorpayKeyId,
              amount: order.amountPaise,
              currency: order.currency,
              name: 'FeeFlow AI',
              order_id: order.providerOrderId,
              handler: async (response) => {
                try {
                  const { data } = await api.post('/parent-payments/razorpay/verify', response);
                  setOrder(data.order);
                  setPayment(data.payment);
                  await loadLedger();
                  resolve();
                } catch (requestError) {
                  reject(requestError);
                }
              },
              modal: { ondismiss: () => reject(new Error('Payment checkout was cancelled')) }
            });
            checkout.on('payment.failed', () => reject(new Error('Payment failed; no fee was recorded')));
            checkout.open();
          });
        } catch (requestError) {
          setError(getApiError(requestError));
        } finally {
          setProcessing(false);
        }
      }
    } catch (requestError) {
      setError(getApiError(requestError));
      if (requestError.response?.status === 409) {
        setOrder(null);
        try {
          await loadLedger();
        } catch (refreshError) {
          setError(getApiError(refreshError));
        }
      }
    } finally {
      setProcessing(false);
    }
  }

  if (loading) return <div className="parent-loading" aria-label="Loading payment details"><i /><i /></div>;
  if (error && !ledger) return <section><Link className="back-link" to="/">← Parent dashboard</Link><div className="notice-error" role="alert">{error}</div></section>;
  if (!ledger) return null;

  const installment = ledger.feePlan?.installments.find(({ installmentNumber: number }) => number === installmentNumber);
  if (!installment) return <section><Link className="back-link" to="/">← Parent dashboard</Link><div className="notice-error" role="alert">This instalment is not available.</div></section>;

  return (
    <section className="parent-payment-page">
      <Link className="back-link" to={`/fees/${encodeURIComponent(studentId)}`}>← Fee details</Link>
      <div className="page-heading"><div><p className="page-eyebrow">SECURE MOCK CHECKOUT</p><h1>Instalment {installmentNumber}</h1><p>{ledger.student.name} · {ledger.student.studentId}</p></div></div>
      {error && <div className="notice-error" role="alert">{error}</div>}
      <section className="panel payment-detail-card">
        <div className="panel-heading"><div><h2>Payment details</h2><p>{ledger.student.batch}</p></div><span className={`status-badge ${installment.status}`}>{installment.status.replace('_', ' ')}</span></div>
        <dl className="payment-detail-list">
          <div><dt>Original amount</dt><dd>{formatPaise(installment.amountPaise)}</dd></div>
          <div><dt>Already paid</dt><dd>{formatPaise(installment.paidAmountPaise)}</dd></div>
          <div><dt>Remaining amount</dt><dd className="payment-remaining">{formatPaise(installment.outstandingPaise)}</dd></div>
          <div><dt>Due date</dt><dd>{formatDate(installment.dueDate)}</dd></div>
        </dl>
        {!order && installment.outstandingPaise > 0 && (
          <div className="payment-action-area">
            <p>The server will create an order for the remaining amount. No payment is taken until you confirm in the mock checkout.</p>
            <button className="parent-pay-button" disabled={processing} onClick={createOrder} type="button">{processing ? 'Creating order…' : 'Continue to payment'}</button>
          </div>
        )}
        {installment.outstandingPaise === 0 && !payment && (
          <div className="notice-success payment-complete-notice" role="status">This instalment is fully paid.</div>
        )}
      </section>

      {order?.status === 'pending' && (
        <section className="panel mock-checkout">
          <div className="panel-heading"><div><h2>{order.provider === 'razorpay' ? 'Razorpay sandbox checkout' : 'Mock payment checkout'}</h2><p>{order.provider === 'razorpay' ? 'Sandbox only · no production payment credentials are used' : 'Development simulator only · no real money is charged'}</p></div></div>
          <div className="mock-order-summary">
            <span>Payable amount</span><strong>{formatPaise(order.amountPaise)}</strong>
            <span>Server-generated transaction</span><code>{order.transactionId}</code>
            <span>Order expires</span><span>{formatDate(order.expiresAt)}</span>
          </div>
          <p className="mock-checkout-note">{order.provider === 'razorpay' ? 'The gateway controls the payment details. The backend verifies the signed callback and server-stored amount.' : 'Choose a simulated result. The backend checks this pending order and its stored amount; the browser cannot submit a payment amount or transaction ID.'}</p>
          <div className="mock-checkout-actions">
            {order.provider === 'razorpay' ? (
              <button className="parent-pay-button" disabled={processing} onClick={startRazorpayCheckout} type="button">{processing ? 'Opening checkout…' : 'Pay with Razorpay sandbox'}</button>
            ) : (<>
              <button className="mock-fail-button" disabled={processing} onClick={() => completeOrder('failure')} type="button">{processing ? 'Processing…' : 'Simulate failure'}</button>
              <button className="parent-pay-button" disabled={processing} onClick={() => completeOrder('success')} type="button">{processing ? 'Processing…' : 'Simulate success'}</button>
            </>)}
          </div>
        </section>
      )}

      {order?.status === 'failed' && (
        <section className="notice-error payment-result-notice" role="status">
          Simulated payment failed. No payment was recorded and your fee balance is unchanged.
          <button className="text-button" disabled={processing} onClick={() => setOrder(null)} type="button">Try again</button>
        </section>
      )}

      {payment && (
        <section className="panel payment-receipt-card" aria-live="polite">
          <div className="receipt-success-icon" aria-hidden="true">✓</div>
          <h2>Payment successful</h2>
          <p>Your fee ledger has been updated.</p>
          <strong className="receipt-amount">{formatPaise(payment.amountPaise)}</strong>
          <span className="receipt-transaction">{payment.transactionId}</span>
          <p className="receipt-balance">Updated outstanding balance: <strong>{formatPaise(ledger.remainingBalancePaise)}</strong></p>
          <a className="parent-pay-button receipt-download" href={`${api.defaults.baseURL}/parent-payments/receipts/${encodeURIComponent(payment.id)}`} onClick={async (event) => {
            event.preventDefault();
            try {
              const { data } = await api.get(`/parent-payments/receipts/${encodeURIComponent(payment.id)}`, { responseType: 'blob' });
              const url = URL.createObjectURL(data);
              const download = document.createElement('a');
              download.href = url;
              download.download = `feeflow-receipt-${payment.id}.html`;
              download.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (requestError) {
              setError(getApiError(requestError));
            }
          }}>Download receipt</a>
        </section>
      )}
    </section>
  );
}
