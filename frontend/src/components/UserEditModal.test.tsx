import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { EmailChangeSummary, UserDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: { updateUser: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../api/client');
const { UserEditModal, savedMessage } = await import('./UserEditModal');
const updateUser = api.updateUser as unknown as ReturnType<typeof vi.fn>;

const user = {
  id: 'u1',
  email: 'user1@gmail.com',
  firstName: 'Una',
  lastName: 'User',
  role: 'Member',
  title: null,
  jobDescription: null,
  supervisorId: null,
  isActive: true,
} as unknown as UserDto;

const change = (over: Partial<EmailChangeSummary> = {}): EmailChangeSummary => ({
  from: 'user1@gmail.com',
  to: 'user2@gmail.com',
  signInMethod: 'password',
  inactive: false,
  ...over,
});

describe('what the admin is told after saving', () => {
  it('a plain save, with no address change', () => {
    expect(savedMessage('user1@gmail.com')).toBe('Saved changes to user1@gmail.com.');
  });

  it('a new password address: the password stays, and both addresses were told', () => {
    const text = savedMessage('user2@gmail.com', change());
    expect(text).toMatch(/user2@gmail\.com was emailed/);
    expect(text).toMatch(/password stays the same/);
    expect(text).toMatch(/user1@gmail\.com was told about the change/);
  });

  it('onto Google: told to sign in with Google', () => {
    const text = savedMessage(
      'a@healthlifeny.com',
      change({ to: 'a@healthlifeny.com', signInMethod: 'google' }),
    );
    expect(text).toMatch(/a@healthlifeny\.com was emailed to sign in with Google/);
    expect(text).toMatch(/user1@gmail\.com was told/);
  });

  it('off Google: a set-password link, shown below too', () => {
    const text = savedMessage(
      'user2@gmail.com',
      change({
        resetLink: 'http://x.test/reset-password?token=t',
        expiresAt: '2026-10-16T12:00:00Z',
      }),
    );
    expect(text).toMatch(/emailed a link to set a password/);
    expect(text).toMatch(/also shown below/);
  });

  it('an inactive account: both were emailed, and it must be reactivated first', () => {
    const text = savedMessage('user2@gmail.com', change({ inactive: true }));
    expect(text).toMatch(/Both user2@gmail\.com and user1@gmail\.com were emailed/);
    expect(text).toMatch(/inactive/);
  });
});

describe('UserEditModal', () => {
  it('passes on what the address change sent, and the set-password link', async () => {
    const summary = change({
      resetLink: 'http://x.test/reset-password?token=t',
      expiresAt: '2026-10-16T12:00:00Z',
    });
    updateUser.mockResolvedValue({ ...user, email: 'user2@gmail.com', emailChange: summary });
    const onSaved = vi.fn();
    render(<UserEditModal user={user} supervisors={[]} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Email (login id)'), {
      target: { value: 'user2@gmail.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });

    expect(updateUser).toHaveBeenCalledWith('u1', { email: 'user2@gmail.com' });
    expect(onSaved).toHaveBeenCalledWith(
      savedMessage('user2@gmail.com', summary),
      'http://x.test/reset-password?token=t',
    );
  });

  it('a save without an address change hands over no link', async () => {
    updateUser.mockResolvedValue({ ...user, title: 'Lead' });
    const onSaved = vi.fn();
    render(<UserEditModal user={user} supervisors={[]} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Lead' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });

    expect(onSaved).toHaveBeenCalledWith('Saved changes to user1@gmail.com.', undefined);
  });
});
