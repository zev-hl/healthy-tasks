import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AuthShell } from '../components/AuthShell';
import { emailProblem, FieldError, invalidProps } from '../components/ui/FieldError';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Checked once the link is asked for, then as it is fixed.
  const [checked, setChecked] = useState(false);
  const problem = checked ? emailProblem(email) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setChecked(true);
    if (emailProblem(email)) {
      document.getElementById('email')?.focus();
      return;
    }
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
    <AuthShell>
      <div className="auth-head">
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-sub">We&apos;ll email you a link to set a new one.</p>
      </div>
      {message ? (
        <div className="alert success">{message}</div>
      ) : (
        <>
          {error && <div className="alert error">{error}</div>}
          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                {...invalidProps('email-error', problem)}
              />
              <FieldError id="email-error">{problem}</FieldError>
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
    </AuthShell>
  );
}
