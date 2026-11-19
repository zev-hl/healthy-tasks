import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

const auth = vi.hoisted(() => ({ user: { id: 'me', role: 'Member' } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api/client', () => {
  const fns: Record<string | symbol, unknown> = {};
  return {
    api: new Proxy(fns, {
      get: (t, k) => (t[k] ??= vi.fn(() => Promise.resolve([]))),
    }),
    ApiError: class ApiError extends Error {},
    uploadToStorage: vi.fn(),
  };
});
vi.mock('../components/RichTextEditor', () => ({ RichTextEditor: () => null }));
vi.mock('../components/RichText', () => ({
  RichText: ({ html }: { html: string }) => <div data-testid="sop">{html}</div>,
}));

const { api } = await import('../api/client');
const { DutyPage, MyDutiesPage } = await import('./DutyPage');
const { renderWithDataRouter } = await import('../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const duty = (id: string, name: string, over = {}) => ({
  id,
  departmentId: 'ops',
  name,
  description: null,
  sop: null,
  videoUrl: null,
  videoFile: null,
  archived: false,
  peopleCount: 1,
  openTaskCount: 0,
  inUse: true,
  ...over,
});

function load() {
  fn(api.listDepartments).mockResolvedValue([
    {
      id: 'ops',
      name: 'Operations',
      color: '#336',
      archived: false,
      peopleCount: 2,
      duties: [
        duty('recv', 'Receiving', {
          sop: '<p>Check the count</p>',
          videoUrl: 'https://v.example/a',
        }),
        duty('pack', 'Packing'),
      ],
    },
  ]);
  fn(api.getDutyHoldings).mockResolvedValue({ me: ['recv'], ana: ['recv', 'pack'] });
  fn(api.listActiveUsers).mockResolvedValue([
    { id: 'me', email: 'me@x', firstName: 'Mo', lastName: 'Me' },
    { id: 'ana', email: 'ana@x', firstName: 'Ana', lastName: 'Khan' },
  ]);
}

describe('Duty pages', () => {
  it('My duties lists only the duties I hold', async () => {
    load();
    renderWithDataRouter(<MyDutiesPage />, { path: '/duties', initialEntries: ['/duties'] });
    await settle();
    expect(screen.getByRole('link', { name: /Receiving/ })).toHaveAttribute('href', '/duties/recv');
    expect(screen.queryByRole('link', { name: /Packing/ })).toBeNull();
  });

  it('a duty page shows its SOP, video link and holders; no editing for a Member', async () => {
    load();
    renderWithDataRouter(<DutyPage />, { path: '/duties/:id', initialEntries: ['/duties/recv'] });
    await settle();
    expect(screen.getByTestId('sop')).toHaveTextContent('Check the count');
    expect(screen.getByRole('link', { name: /Watch the video/ })).toHaveAttribute(
      'href',
      'https://v.example/a',
    );
    expect(screen.getByText('Ana Khan')).toBeInTheDocument();
    expect(screen.getByText('Mo Me')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit SOP/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Upload a video/ })).toBeNull();
  });

  it('an Admin can edit and upload', async () => {
    auth.user = { id: 'me', role: 'Admin' };
    load();
    renderWithDataRouter(<DutyPage />, { path: '/duties/:id', initialEntries: ['/duties/pack'] });
    await settle();
    expect(screen.getByRole('button', { name: /Edit SOP/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload a video file/ })).toBeInTheDocument();
    expect(screen.getByText('No SOP written yet.')).toBeInTheDocument();
  });
});
