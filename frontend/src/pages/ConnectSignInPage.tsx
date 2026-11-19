import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AuthShell } from '../components/AuthShell';

/**
 * Where our Connect sends someone to sign in with HL Central (Nov 2026 plan,
 * Stage 5; Connect's CENTRAL_SIGNIN_URL). Signed in here (the sign-in page
 * comes first if not), it sets the cookie Connect's page then uses to get a
 * token from HL Central, and goes back to Connect. Only an address on our
 * Connect is gone back to.
 */
export function ConnectSignInPage() {
  const [params] = useSearchParams();
  const [problem, setProblem] = useState<string | null>(null);
  const returnTo = params.get('return_to');

  useEffect(() => {
    let gone = false;
    (async () => {
      const status = await api.connectAuthStatus().catch(() => null);
      if (!status?.available || !status.connectUrl) {
        throw new Error('Signing in to Connect with HL Central isn’t set up yet.');
      }
      const connect = new URL(status.connectUrl).origin;
      let target = `${connect}/?central=1`;
      if (returnTo) {
        let back: URL;
        try {
          back = new URL(returnTo);
        } catch {
          throw new Error('That sign-in link is broken.');
        }
        if (back.origin !== connect) throw new Error('That sign-in link isn’t for our Connect.');
        target = back.toString();
      }
      await api.connectAuthSession();
      if (!gone) window.location.replace(target);
    })().catch((e: unknown) => {
      if (!gone) {
        setProblem(
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Could not sign you in to Connect.',
        );
      }
    });
    return () => {
      gone = true;
    };
  }, [returnTo]);

  return (
    <AuthShell>
      <div className="auth-head">
        <h1 className="auth-title">Connect</h1>
        <p className="auth-sub">
          {problem ? 'Couldn’t sign you in to Connect.' : 'Signing you in to Connect…'}
        </p>
      </div>
      {problem && (
        <>
          <div className="alert error" role="alert">
            {problem}
          </div>
          <p className="auth-alt">
            <Link to="/">Go to HL Central</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
