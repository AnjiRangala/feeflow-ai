import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, getApiError } from '../api/client.js';
import BrandMark from '../components/BrandMark.jsx';

export default function LoginPage({ user, onAuthenticated }) {
  const [step, setStep] = useState('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submitCredentials(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setChallengeId(data.challengeId);
      setStep('verification');
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/verify-otp', { challengeId, code });
      onAuthenticated(data.accessToken, data.user);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page min-h-screen bg-white">
      <section className="login-intro" aria-label="FeeFlow AI introduction">
        <BrandMark />
        <div className="intro-content">
          <div className="eyebrow"><span className="eyebrow-dot" /> A clearer way to stay on track</div>
          <h1>Fee management,<br /><span>made clear.</span></h1>
          <p>One calm place for families and institute teams to stay connected.</p>
        </div>
        <div className="intro-footer">Thoughtful tools for better learning journeys.</div>
        <div className="decorative-orb orb-one" />
        <div className="decorative-orb orb-two" />
      </section>

      <section className="login-panel">
        <div className="mobile-brand"><BrandMark /></div>
        <div className="form-wrap">
          <div className="form-heading">
            <p className="form-kicker">{step === 'credentials' ? 'WELCOME BACK' : 'ONE MORE STEP'}</p>
            <h2>{step === 'credentials' ? 'Sign in to your account' : 'Verify it’s you'}</h2>
            <p className="form-description">
              {step === 'credentials'
                ? 'Enter your account details to continue.'
                : `Enter the six-digit verification code for ${email}.`}
            </p>
          </div>

          {step === 'credentials' ? (
            <form className="auth-form" onSubmit={submitCredentials}>
              <label htmlFor="email">Email address</label>
              <input
                autoComplete="email"
                id="email"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
              <div className="label-row">
                <label htmlFor="password">Password</label>
              </div>
              <input
                autoComplete="current-password"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                required
                type="password"
                value={password}
              />
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? 'Signing in…' : 'Continue'}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={submitCode}>
              <label htmlFor="code">Verification code</label>
              <input
                autoComplete="one-time-code"
                autoFocus
                className="otp-input"
                id="code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                required
                type="text"
                value={code}
              />
              {import.meta.env.DEV && (
                <p className="helper-text">For this demo, the code is printed in the backend terminal.</p>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" disabled={busy || code.length !== 6} type="submit">
                {busy ? 'Verifying…' : 'Verify and sign in'}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setStep('credentials');
                  setCode('');
                  setError('');
                }}
                type="button"
              >
                Back to sign in
              </button>
            </form>
          )}

          <p className="support-note">Need help signing in? Contact your institute office.</p>
        </div>
        <p className="copyright">© {new Date().getFullYear()} FeeFlow AI</p>
      </section>
    </main>
  );
}
