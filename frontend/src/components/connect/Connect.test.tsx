import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { TaskDetailDto } from '@healthy-tasks/shared';

vi.mock('../../api/client', () => ({
  api: {
    getConnect: vi.fn(),
    listActiveUsers: vi.fn(async () => [
      { id: 'me', email: 'me@x', firstName: 'Mo', lastName: 'Me' },
      { id: 'ana', email: 'ana@x', firstName: 'Ana', lastName: 'Khan' },
    ]),
    scheduleTaskCall: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: authUser }) }));
let authUser: { id: string; role: string } | null = { id: 'me', role: 'Admin' };
const toast = vi.fn();
vi.mock('../harbor/Toast', () => ({ useToast: () => toast }));

const { api } = await import('../../api/client');
const { ScheduleCallButton } = await import('./ScheduleCallButton');
const { ConnectChat } = await import('./ConnectChat');
const { ConnectPage } = await import('../../pages/ConnectPage');
const { AppLauncher } = await import('../AppLauncher');
const { resetConnectCache } = await import('../../lib/connect');
const { renderWithRouter } = await import('../../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const task = {
  id: 5,
  name: 'Supplier contract',
  assigneeId: 'ana',
  creatorId: 'me',
} as TaskDetailDto;
const event = (over = {}) => ({
  id: 'e1',
  kind: 'call',
  title: 'Call: Supplier contract',
  connect: { kind: 'ring', joinUrl: 'https://connect.test/dms?c=1' },
  ...over,
});

describe('Schedule call (K2)', () => {
  beforeEach(() => {
    toast.mockClear();
    fn(api.scheduleTaskCall).mockReset();
  });

  it('rings the assignee now, you hosting', async () => {
    fn(api.scheduleTaskCall).mockResolvedValue({
      event: event(),
      booked: true,
      reason: null,
      skipped: [],
    });
    renderWithRouter(<ScheduleCallButton task={task} meId="me" />);
    fireEvent.click(screen.getByRole('button', { name: /Call/ }));
    await settle();
    expect(screen.getByText('Ana Khan')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ring now' })));
    expect(api.scheduleTaskCall).toHaveBeenCalledWith(5, {
      when: 'now',
      minutes: 30,
      participantIds: ['ana'],
    });
    expect(toast.mock.calls[0]![0].message).toMatch(/Ringing them in Connect now/);
  });

  it('books a time; when Connect can’t, says it was saved as a meeting and why', async () => {
    fn(api.scheduleTaskCall).mockResolvedValue({
      event: event({ kind: 'meeting', connect: null }),
      booked: false,
      reason: 'Connect said: the host already has a call then',
      skipped: [],
    });
    renderWithRouter(<ScheduleCallButton task={task} meId="me" />);
    fireEvent.click(screen.getByRole('button', { name: /Call/ }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Book call' })));
    const body = fn(api.scheduleTaskCall).mock.calls[0]![1];
    expect(Date.parse(body.when) - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(toast.mock.calls[0]![0]).toMatchObject({ tone: 'error' });
    expect(toast.mock.calls[0]![0].message).toMatch(/Saved as a meeting.*host already has a call/);
  });
});

describe('Connect chat pop-up (K1)', () => {
  beforeEach(() => resetConnectCache());

  it('is not there while Connect isn’t linked', async () => {
    fn(api.getConnect).mockResolvedValue({ available: false, url: null });
    renderWithRouter(<ConnectChat />);
    await settle();
    expect(screen.queryByRole('button', { name: /chat/i })).toBeNull();
  });

  it('opens Connect in a frame, with a link to open it in its own tab', async () => {
    fn(api.getConnect).mockResolvedValue({ available: true, url: 'https://connect.test' });
    renderWithRouter(<ConnectChat />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat (Connect)' }));
    expect(screen.getByTitle('Connect')).toHaveAttribute('src', 'https://connect.test/');
    expect(screen.getByTitle('Connect').getAttribute('allow')).toMatch(/microphone/);
    expect(screen.getByRole('link', { name: /Open in Connect/ })).toHaveAttribute(
      'href',
      'https://connect.test',
    );
  });
});

describe('Connect in the nine-dot menu', () => {
  beforeEach(() => {
    resetConnectCache();
    authUser = { id: 'me', role: 'Admin' };
  });

  it('opens Connect in a new tab once it is linked', async () => {
    fn(api.getConnect).mockResolvedValue({ available: true, url: 'https://connect.test' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderWithRouter(<AppLauncher current="central" />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'All apps' }));
    fireEvent.click(screen.getByRole('button', { name: /^Connect/ }));
    expect(open).toHaveBeenCalledWith('https://connect.test', '_blank', 'noopener');
    open.mockRestore();
  });

  it('is hidden from everyone but Admins until Connect is linked', async () => {
    fn(api.getConnect).mockResolvedValue({ available: false, url: null });
    authUser = { id: 'me', role: 'Employee' };
    renderWithRouter(<AppLauncher current="central" />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'All apps' }));
    expect(screen.queryByRole('button', { name: /^Connect/ })).toBeNull();
  });

  it('its page says it isn’t linked yet, with what to set for an Admin only', async () => {
    fn(api.getConnect).mockResolvedValue({ available: false, url: null });
    const { unmount } = renderWithRouter(<ConnectPage />, ['/connect']);
    await settle();
    expect(screen.getByText(/isn’t linked to HL Central yet/)).toHaveTextContent(/CONNECT_URL/);
    unmount();
    authUser = { id: 'me', role: 'Employee' };
    renderWithRouter(<ConnectPage />, ['/connect']);
    await settle();
    expect(screen.getByText(/isn’t linked to HL Central yet/)).not.toHaveTextContent(/CONNECT_URL/);
  });
});
