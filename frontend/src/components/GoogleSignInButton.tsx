/**
 * The "Sign in with Google" button.
 *
 * Google's own script renders the button — its appearance and wording are
 * fixed by Google's branding rules, so there is nothing to style here. Clicking
 * it opens a popup on Google's domain; our page never navigates away, and the
 * person's Google password is never typed on our site.
 *
 * What comes back is an ID token: a short-lived signed statement of who they
 * are. We hand it straight to the server, which verifies it properly. Nothing
 * in it is trusted here.
 *
 * Renders nothing when no client id is configured, so an environment where
 * Google is not wired up simply shows the password form on its own rather than
 * a button that cannot work.
 */
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function GoogleSignInButton({
  onToken,
  onError,
  disabled = false,
}: {
  onToken: (idToken: string) => void;
  onError: (message: string) => void;
  /** Greys the button out while a sign-in is already in flight. */
  disabled?: boolean;
}) {
  if (!CLIENT_ID) return null;

  return (
    <div className="google-signin" aria-busy={disabled}>
      <GoogleOAuthProvider clientId={CLIENT_ID}>
        <GoogleLogin
          onSuccess={(res) => {
            if (res.credential) onToken(res.credential);
            else onError('Google did not return a sign-in token. Please try again.');
          }}
          onError={() => {
            // Google gives no reason here — a closed popup, a blocked popup and
            // a misconfigured origin all arrive the same way.
            onError('Google sign-in did not complete. Please try again.');
          }}
          text="signin_with"
          shape="rectangular"
          width="320"
        />
      </GoogleOAuthProvider>
    </div>
  );
}

/** Whether this build has Google sign-in configured at all. */
export const googleSignInAvailable = Boolean(CLIENT_ID);
