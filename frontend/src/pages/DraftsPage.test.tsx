import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { DraftDto } from '@healthy-tasks/shared';

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

const { api } = await import('../api/client');
const { DraftsPage } = await import('./DraftsPage');
const { renderWithDataRouter } = await import('../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const draft = (id: string, title: string, over: Partial<DraftDto> = {}): DraftDto => ({
  id,
  title,
  notes: null,
  files: [],
  createdAt: '2026-11-18T10:00:00Z',
  updatedAt: '2026-11-18T10:00:00Z',
  ...over,
});

describe('Drafts page', () => {
  beforeEach(() => {
    fn(api.listDrafts).mockResolvedValue([
      draft('a', 'Shelf labels', { notes: '<p>Use the new printer</p>' }),
      draft('b', 'Supplier list'),
    ]);
  });

  async function renderPage() {
    renderWithDataRouter(<DraftsPage />, {
      path: '/drafts',
      initialEntries: ['/drafts'],
      extraRoutes: [{ path: '/tasks/new', element: <p>New task page</p> }],
    });
    await settle();
  }

  it('lists drafts and opens the first', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /Shelf labels/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'Draft title' })).toHaveValue('Shelf labels');
  });

  it('adds a draft from its title', async () => {
    fn(api.createDraft).mockResolvedValue(draft('c', 'Rack plan'));
    await renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'New draft title' }), {
      target: { value: 'Rack plan' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add' })));
    expect(api.createDraft).toHaveBeenCalledWith({ title: 'Rack plan' });
    expect(screen.getByRole('textbox', { name: 'Draft title' })).toHaveValue('Rack plan');
  });

  it('Make task opens the New task page', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Make task' }));
    expect(screen.getByText('New task page')).toBeInTheDocument();
  });

  it('deletes a draft after asking', async () => {
    fn(api.deleteDraft).mockResolvedValue(undefined);
    await renderPage();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Delete draft/ })));
    const ask = await screen.findByRole('alertdialog');
    expect(ask).toHaveTextContent('Delete the draft “Shelf labels”?');
    expect(api.deleteDraft).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(within(ask).getByRole('button', { name: 'Delete draft' })),
    );
    expect(api.deleteDraft).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('button', { name: /Shelf labels/ })).toBeNull();
  });
});
