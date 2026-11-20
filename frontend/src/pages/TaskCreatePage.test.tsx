import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

vi.mock('../api/client', () => {
  const fns: Record<string | symbol, unknown> = {};
  return {
    api: new Proxy(fns, {
      get: (t, k) => (t[k] ??= vi.fn(() => Promise.resolve([]))),
    }),
    ApiError: class ApiError extends Error {},
  };
});
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me-1', role: 'Member' } }),
}));
vi.mock('../components/RichTextEditor', () => ({ RichTextEditor: () => null }));

const { api } = await import('../api/client');
const { TaskCreatePage } = await import('./TaskCreatePage');
const { renderWithDataRouter } = await import('../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function renderPage(state?: unknown) {
  renderWithDataRouter(<TaskCreatePage />, {
    path: '/tasks/new',
    initialEntries: [{ pathname: '/tasks/new', state }],
    extraRoutes: [{ path: '/tasks/:id', element: <p>Task page</p> }],
  });
  await settle();
}

describe('New task page', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    fn(api.listActiveUsers).mockResolvedValue([
      { id: 'me-1', email: 'me@x', firstName: 'Mo', lastName: 'Me' },
    ]);
    fn(api.listDepartments).mockResolvedValue([
      {
        id: 'd1',
        name: 'Ops',
        color: '#336',
        archived: false,
        duties: [{ id: 'x1', name: 'Receiving', archived: false }],
      },
    ]);
    fn(api.getDutyHoldings).mockResolvedValue({ 'me-1': ['x1'] });
    fn(api.createTask).mockReset().mockResolvedValue({ id: 9, name: 'Restock' });
    fn(api.createSubtask).mockReset().mockResolvedValue({});
  });

  it('waits for a duty choice, then makes the task and a sub-task per line', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Restock' },
    });
    const create = screen.getByRole('button', { name: 'Create task' });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Duty/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Ops › Receiving' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Sub-tasks, one per line' }), {
      target: { value: 'Count shelf A\n\nOrder labels\n' },
    });
    await act(async () => fireEvent.click(create));
    await settle();
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Restock', assigneeId: 'me-1', dutyId: 'x1' }),
    );
    expect(fn(api.createSubtask).mock.calls).toEqual([
      [9, 'Count shelf A'],
      [9, 'Order labels'],
    ]);
    expect(screen.getByText('Task page')).toBeInTheDocument();
  });

  it('comes from the quick panel as a project, its switch on', async () => {
    await renderPage({ name: 'Q4 launch', isProject: true, dutyChoice: '__no_duty' });
    expect(screen.getByRole('checkbox', { name: 'Project' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Q4 launch');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create project' })));
    await settle();
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ isProject: true, dutyId: null }),
    );
  });

  it('from a draft: carries its notes and finishes the draft once the task is made', async () => {
    fn(api.finishDraft).mockReset().mockResolvedValue(undefined);
    await renderPage({
      name: 'Idea',
      description: '<p>notes</p>',
      draftId: 'dr1',
      dutyChoice: '__no_duty',
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create task' })));
    await settle();
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Idea', description: '<p>notes</p>' }),
    );
    expect(api.finishDraft).toHaveBeenCalledWith('dr1', 9);
  });
});
