import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.forgotPassword(email);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-brand">
        <span className="auth-brand-mark" aria-hidden="true">
          H
        </span>
        Healthy Tasks
      </div>
      <div className="card auth-card">
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-sub">We&apos;ll email you a link to set a new one.</p>
        {message ? (
          <>
            <div className="alert success">{message}</div>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              In development the reset link is printed to the backend console.
            </p>
          </>
        ) : (
          <>
            {error && <div className="alert error">{error}</div>}
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="auth-submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}
        <p className="auth-alt">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
