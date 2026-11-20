import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { UserDto } from '@healthy-tasks/shared';

const navigate = vi.fn();
const login = vi.fn();
const loginWithGoogle = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ login, loginWithGoogle, sessionExpired: false }),
}));

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

/**
 * Stand in for Google's own button. The real one renders inside an iframe from
 * Google's script, which cannot run here — and should not: a test must never
 * depend on reaching Google. This hands back a canned token on click, which is
 * all the page actually consumes.
 */
vi.mock('../components/GoogleSignInButton', () => ({
  googleSignInAvailable: true,
  GoogleSignInButton: ({
    onToken,
    onError,
    disabled,
  }: {
    onToken: (t: string) => void;
    onError: (m: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      <button type="button" disabled={disabled} onClick={() => onToken('token-from-google')}>
        Sign in with Google
      </button>
      <button type="button" onClick={() => onError('Google sign-in did not complete.')}>
        simulate google failure
      </button>
    </div>
  ),
}));

const { ApiError } = await import('../api/client');
const { LoginPage } = await import('./LoginPage');
const { renderWithRouter } = await import('../test/render');

const user = { id: 'u1', email: 'me@healthlifeny.com' } as unknown as UserDto;
const settle = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  vi.clearAllMocks();
  login.mockResolvedValue(user);
  loginWithGoogle.mockResolvedValue(user);
});

describe('LoginPage', () => {
  it('offers both ways in', () => {
    renderWithRouter(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText(/or sign in with your password/i)).toBeInTheDocument();
  });

  it('signs in with the token Google hands back, then goes to the dashboard', async () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(loginWithGoogle).toHaveBeenCalledWith('token-from-google', false));
    expect(navigate).toHaveBeenCalledWith('/');
    expect(login).not.toHaveBeenCalled();
  });

  it('still signs in with email and password', async () => {
    renderWithRouter(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'me@healthlifeny.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('me@healthlifeny.com', 'secret', false));
    expect(navigate).toHaveBeenCalledWith('/');
    expect(loginWithGoogle).not.toHaveBeenCalled();
  });

  it('says in the page, not in a browser bubble, what is missing', async () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveFocus();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@' } });
    expect(screen.getByText('That doesn’t look like an email address')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@healthlifeny.com' } });
    expect(screen.queryByText(/look like an email/)).not.toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("shows the server's reason when Google sign-in is refused", async () => {
    loginWithGoogle.mockRejectedValue(
      new ApiError(401, 'There is no HL Central account for that Google address.'),
    );
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() => expect(screen.getByText(/no HL Central account/i)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a failure that happens on Google’s side', async () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'simulate google failure' }));
    await settle();

    expect(screen.getByText(/did not complete/i)).toBeInTheDocument();
    expect(loginWithGoogle).not.toHaveBeenCalled();
  });

  it('focuses Email on load, and tabs Email › Password › Keep me signed in › Sign in', () => {
    renderWithRouter(<LoginPage />);
    const email = screen.getByLabelText('Email');
    expect(email).toHaveFocus();
    const order = [
      email,
      screen.getByLabelText('Password'),
      screen.getByRole('checkbox', { name: /Keep me signed in on this device/ }),
      screen.getByRole('button', { name: 'Sign in' }),
    ];
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
  });

  it('keeps you signed in on this device only when ticked, either way in', async () => {
    renderWithRouter(<LoginPage />);
    const box = screen.getByRole('checkbox', { name: /Keep me signed in on this device/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(loginWithGoogle).toHaveBeenCalledWith('token-from-google', true));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('a@b.c', 'pw', true));
  });
});
