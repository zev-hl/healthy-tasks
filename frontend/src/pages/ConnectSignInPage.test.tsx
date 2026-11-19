import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

vi.mock('../api/client', () => ({
  api: {
    connectAuthStatus: vi.fn(async () => ({ available: true, connectUrl: 'https://connect.test' })),
    connectAuthSession: vi.fn(async () => undefined),
  },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../api/client');
const { ConnectSignInPage } = await import('./ConnectSignInPage');
const { renderWithRouter } = await import('../test/render');
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe('Signing in to Connect with HL Central (Stage 5)', () => {
  const replace = vi.fn();
  const real = window.location;
  beforeEach(() => {
    replace.mockReset();
    vi.mocked(api.connectAuthSession).mockClear();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, replace } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: real });
  });

  it('sets the cookie and goes back to Connect', async () => {
    const back = 'https://connect.test/desktop-signin?challenge=abc&central=1';
    renderWithRouter(<ConnectSignInPage />, [
      `/connect-signin?return_to=${encodeURIComponent(back)}`,
    ]);
    await settle();
    expect(api.connectAuthSession).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(back);
  });

  it('never goes to an address that isn’t our Connect', async () => {
    renderWithRouter(<ConnectSignInPage />, [
      `/connect-signin?return_to=${encodeURIComponent('https://evil.test/?central=1')}`,
    ]);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t for our Connect/);
    expect(api.connectAuthSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('says so when it isn’t set up', async () => {
    vi.mocked(api.connectAuthStatus).mockResolvedValueOnce({ available: false, connectUrl: null });
    renderWithRouter(<ConnectSignInPage />, ['/connect-signin']);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t set up yet/);
  });
});
