import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../api/client', () => ({
  api: { createTask: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me-1' } }) }));

const { api } = await import('../../api/client');
const { QuickTaskButton, TASK_CREATED_EVENT } = await import('./QuickTask');
const { ToastProvider } = await import('./Toast');
const createTask = api.createTask as unknown as ReturnType<typeof vi.fn>;

function NewPage() {
  const state = useLocation().state as { name?: string };
  return <p>Full page with “{state?.name}”</p>;
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

describe('QuickTaskButton', () => {
  beforeEach(() => createTask.mockReset());

  it('adds a task for me without leaving the page, and offers to open it', async () => {
    createTask.mockResolvedValue({ id: 42, name: 'Call the supplier' });
    const created = vi.fn();
    window.addEventListener(TASK_CREATED_EVENT, created);
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const add = screen.getByRole('button', { name: 'Add task' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Call the supplier' },
    });
    await act(async () => fireEvent.click(add));
    expect(createTask).toHaveBeenCalledWith({
      name: 'Call the supplier',
      assigneeId: 'me-1',
      dueAt: null,
    });
    expect(created).toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull();
    expect(screen.getByText('Added “Call the supplier” to your tasks.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Task page')).toBeInTheDocument();
    window.removeEventListener(TASK_CREATED_EVENT, created);
  });

  it('carries what was typed to the full page with More details', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Plan the launch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'More details' }));
    expect(screen.getByText('Full page with “Plan the launch”')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();
  });
});
