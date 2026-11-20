import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../api/client', () => ({
  api: {
    createTask: vi.fn(),
    listActiveUsers: vi.fn(),
    listDepartments: vi.fn(),
    getDutyHoldings: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me-1' } }) }));

const { api } = await import('../../api/client');
const { QuickTaskButton, TASK_CREATED_EVENT } = await import('./QuickTask');
const { ToastProvider } = await import('./Toast');
const createTask = api.createTask as unknown as ReturnType<typeof vi.fn>;
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

function NewPage() {
  const state = useLocation().state as { name?: string; isProject?: boolean };
  return (
    <p>
      Full page with “{state?.name}”{state?.isProject ? ' as a project' : ''}
    </p>
  );
}

function renderButton() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<QuickTaskButton />} />
          <Route path="/tasks/new" element={<NewPage />} />
          <Route path="/tasks/:id" element={<p>Task page</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function open(kind: 'Task' | 'Project') {
  renderButton();
  fireEvent.click(screen.getByRole('button', { name: 'New' }));
  fireEvent.click(screen.getByRole('menuitem', { name: kind }));
  await settle();
}

function pick(label: RegExp, option: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('QuickTaskButton', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    createTask.mockReset();
    fn(api.listActiveUsers).mockResolvedValue([
      { id: 'me-1', email: 'me@x', firstName: 'Mo', lastName: 'Me' },
      { id: 'u2', email: 'bea@x', firstName: 'Bea', lastName: 'Bell' },
    ]);
    fn(api.listDepartments).mockResolvedValue([
      {
        id: 'd1',
        name: 'Ops',
        color: '#336',
        archived: false,
        duties: [
          { id: 'x1', name: 'Receiving', archived: false },
          { id: 'x2', name: 'Shipping', archived: false },
        ],
      },
    ]);
    fn(api.getDutyHoldings).mockResolvedValue({ 'me-1': ['x1'], u2: ['x2'] });
  });

  it('needs a title, an assignee (me by default) and a duty choice, "No duty" included', async () => {
    createTask.mockResolvedValue({ id: 42, name: 'Call the supplier' });
    const created = vi.fn();
    window.addEventListener(TASK_CREATED_EVENT, created);
    await open('Task');
    const add = screen.getByRole('button', { name: 'Add task' }) as HTMLButtonElement;
    expect(
      screen.getByText('Still needed: a title and a duty (or “No duty”).'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Call the supplier' },
    });
    expect(add.disabled).toBe(true);
    expect(screen.getByText('Still needed: a duty (or “No duty”).')).toBeInTheDocument();
    // Only my own duties are offered, after "No duty".
    fireEvent.click(screen.getByRole('button', { name: /^Duty/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'No duty',
      'Ops › Receiving',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'No duty' }));
    await act(async () => fireEvent.click(add));
    expect(createTask).toHaveBeenCalledWith({
      name: 'Call the supplier',
      assigneeId: 'me-1',
      dutyId: null,
      dueAt: null,
    });
    expect(created).toHaveBeenCalled();
    expect(screen.getByText('Added “Call the supplier” to your tasks.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Task page')).toBeInTheDocument();
    window.removeEventListener(TASK_CREATED_EVENT, created);
  });

  it("offers the new assignee's duties, and forgets a duty they don't hold", async () => {
    createTask.mockResolvedValue({ id: 43, name: 'Ship it' });
    await open('Task');
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Ship it' },
    });
    pick(/^Duty/, 'Ops › Receiving');
    pick(/^Assignee/, 'Bea Bell');
    expect((screen.getByRole('button', { name: 'Add task' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    pick(/^Duty/, 'Ops › Shipping');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add task' })));
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'u2', dutyId: 'x2' }),
    );
  });

  it('makes a project from the Project choice, its switch on', async () => {
    createTask.mockResolvedValue({ id: 44, name: 'Q4 launch' });
    await open('Project');
    expect(screen.getByRole('checkbox', { name: 'Project' })).toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Q4 launch' },
    });
    pick(/^Duty/, 'No duty');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add project' })));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ isProject: true }));
  });

  it('carries what was typed to the full page with More details', async () => {
    await open('Project');
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Plan the launch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'More details' }));
    expect(screen.getByText('Full page with “Plan the launch” as a project')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();
  });
});
