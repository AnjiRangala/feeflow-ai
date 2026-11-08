import { useState } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { api, getApiError } from '../api/client.js';
import BrandMark from '../components/BrandMark.jsx';

export default function ActivateAccountPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState({ busy: false, error: '', done: false });
  const token = params.get('token') || '';

  async function submit(event) {
    event.preventDefault();
    if (password !== confirmation) {
      setState({ busy: false, error: 'Passwords do not match.', done: false });
      return;
    }
    setState({ busy: true, error: '', done: false });
    try {
      await api.post('/auth/activate', { token, password });
      setState({ busy: false, error: '', done: true });
    } catch (error) {
      setState({ busy: false, error: getApiError(error), done: false });
    }
  }

  if (state.done) return <Navigate to="/login" replace />;
  return (
    <main className="login-page min-h-screen bg-white">
      <section className="login-panel">
        <div className="mobile-brand"><BrandMark /></div>
        <div className="form-wrap">
          <div className="form-heading"><p className="form-kicker">ACCOUNT ACTIVATION</p><h2>Set your password</h2><p className="form-description">Choose a password to activate your FeeFlow account.</p></div>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="activation-password">Password</label>
            <input id="activation-password" minLength={12} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <label htmlFor="activation-confirmation">Confirm password</label>
            <input id="activation-confirmation" minLength={12} required type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            {state.error && <p className="form-error" role="alert">{state.error}</p>}
            <button className="primary-button" disabled={state.busy || !token} type="submit">{state.busy ? 'Activating…' : 'Activate account'}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
