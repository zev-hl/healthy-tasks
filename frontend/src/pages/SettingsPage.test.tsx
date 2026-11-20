import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('../api/client', () => ({
  api: {
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),
    connectSignInStatus: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

const { api } = await import('../api/client');
const { SettingsPage } = await import('./SettingsPage');
const { renderWithRouter } = await import('../test/render');

const getSettings = api.getAppSettings as unknown as ReturnType<typeof vi.fn>;
const update = api.updateAppSettings as unknown as ReturnType<typeof vi.fn>;

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({
      materializeLeadDays: 14,
      timerCheckInHours: 4,
      timerCheckInGraceMinutes: 15,
    });
    (api.connectSignInStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it('refuses an empty number instead of saving it as 0, and says so under the field', async () => {
    renderWithRouter(<SettingsPage />);
    const lead = await screen.findByLabelText(/Create repeating tasks/);
    await waitFor(() => expect(lead).toHaveValue(14));
    fireEvent.change(lead, { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(await screen.findByText(/Enter a number of days between/)).toBeInTheDocument();
    expect(lead).toHaveAttribute('aria-invalid', 'true');
    expect(lead).toHaveAccessibleDescription(/Enter a number of days/);
    expect(update).not.toHaveBeenCalled();
  });

  it('shows a timer field’s problem under that field', async () => {
    renderWithRouter(<SettingsPage />);
    const grace = await screen.findByLabelText(/Stop it if nobody answers/);
    await waitFor(() => expect(grace).toHaveValue(15));
    fireEvent.change(grace, { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!);
    expect(await screen.findByText(/Enter a number of minutes between/)).toBeInTheDocument();
    expect(grace).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Still working/)).not.toHaveAttribute('aria-invalid', 'true');
    expect(update).not.toHaveBeenCalled();
  });
});
