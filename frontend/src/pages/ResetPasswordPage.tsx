import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AuthShell } from '../components/AuthShell';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="auth-head">
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">Choose a strong password you don&apos;t use elsewhere.</p>
      </div>
      {!token && <div className="alert error">Missing reset token in the link.</div>}
      {done ? (
        <>
          <div className="alert success">Your password has been updated.</div>
          <p className="auth-alt">
            <Link to="/login">Continue to sign in</Link>
          </p>
        </>
      ) : (
        <>
          {error && <div className="alert error">{error}</div>}
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="password">New password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <button type="submit" className="auth-submit" disabled={submitting || !token}>
              {submitting ? 'Saving…' : 'Set password'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
