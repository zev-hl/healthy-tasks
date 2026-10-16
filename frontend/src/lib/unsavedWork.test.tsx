// Guards against silently losing typed work: leaving the page asks first, and
// a modal holding edits doesn't close on a stray (or drag-select) backdrop click.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';

vi.mock('../api/client', () => ({
  api: {
    listActiveUsers: vi.fn(),
    listDepartments: vi.fn(),
    getDutyHoldings: vi.fn(),
    listSupervisors: vi.fn(),
    createGoal: vi.fn(),
    createUser: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'Admin' } }),
}));

const { api } = await import('../api/client');
const { useBackdropDismiss } = await import('./useBackdropDismiss');
const { TaskForm } = await import('../components/TaskForm');
const { GoalEditorModal } = await import('../components/goals/GoalEditorModal');
const { UserFormModal } = await import('../components/UserFormModal');
const { renderWithDataRouter } = await import('../test/render');
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// The page plus a stand-in for the sidebar, and somewhere for it to lead.
function renderWithSidebar(ui: ReactElement) {
  renderWithDataRouter(
    <>
      <Link to="/elsewhere">Sidebar link</Link>
      {ui}
    </>,
    { extraRoutes: [{ path: '/elsewhere', element: <div>Another page</div> }] },
  );
}

let confirm: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  m(api.listActiveUsers).mockResolvedValue([]);
  m(api.listDepartments).mockResolvedValue([]);
  m(api.getDutyHoldings).mockResolvedValue({ byUser: {} });
  m(api.listSupervisors).mockResolvedValue([]);
  confirm = vi.fn(() => false);
  vi.spyOn(window, 'confirm').mockImplementation(confirm);
});
afterEach(() => vi.restoreAllMocks());

describe('useBackdropDismiss', () => {
  function Backdrop({ onDismiss, blocked }: { onDismiss: () => void; blocked?: boolean }) {
    const props = useBackdropDismiss(onDismiss, blocked);
    return (
      <div data-testid="backdrop" {...props}>
        <input aria-label="field" />
      </div>
    );
  }

  it('closes on a real click on the backdrop', () => {
    const onDismiss = vi.fn();
    render(<Backdrop onDismiss={onDismiss} />);
    const bd = screen.getByTestId('backdrop');
    fireEvent.mouseDown(bd);
    fireEvent.click(bd);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores a text selection dragged out of a field and released on the backdrop', () => {
    const onDismiss = vi.fn();
    render(<Backdrop onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByLabelText('field'));
    fireEvent.click(screen.getByTestId('backdrop'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('never closes while blocked (unsaved edits)', () => {
    const onDismiss = vi.fn();
    render(<Backdrop onDismiss={onDismiss} blocked />);
    const bd = screen.getByTestId('backdrop');
    fireEvent.mouseDown(bd);
    fireEvent.click(bd);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('New task form', () => {
  it('asks before leaving once something is typed, and staying keeps it', async () => {
    renderWithSidebar(<TaskForm submitLabel="Create task" onSubmit={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Name *'), {
      target: { value: 'Count the pallets' },
    });

    fireEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Another page')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name *')).toHaveValue('Count the pallets');
  });

  it('leaves without asking when nothing was entered', async () => {
    renderWithSidebar(<TaskForm submitLabel="Create task" onSubmit={vi.fn()} />);
    await screen.findByLabelText('Name *');
    fireEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));
    expect(await screen.findByText('Another page')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('Goal editor', () => {
  const backdrop = () => document.querySelector('.modal-backdrop') as HTMLElement;
  const clickBackdrop = () => {
    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());
  };

  it('stays open on a backdrop click once something is typed', () => {
    const onClose = vi.fn();
    renderWithSidebar(<GoalEditorModal onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Specific/), { target: { value: 'Ship faster' } });
    clickBackdrop();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click while still empty', () => {
    const onClose = vi.fn();
    renderWithSidebar(<GoalEditorModal onClose={onClose} onSaved={vi.fn()} />);
    clickBackdrop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before the page is left with a goal half-written', async () => {
    renderWithSidebar(<GoalEditorModal onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Specific/), { target: { value: 'Ship faster' } });
    fireEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Another page')).not.toBeInTheDocument();
  });
});

describe('New user form', () => {
  it('stays open on a backdrop click once something is typed', () => {
    const onClose = vi.fn();
    renderWithSidebar(<UserFormModal onClose={onClose} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ava' } });
    const bd = document.querySelector('.modal-backdrop') as HTMLElement;
    fireEvent.mouseDown(bd);
    fireEvent.click(bd);
    expect(onClose).not.toHaveBeenCalled();
  });
});
