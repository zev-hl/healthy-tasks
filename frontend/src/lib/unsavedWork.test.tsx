// Guards against silently losing typed work: leaving the page asks first, a
// modal holding edits asks before Cancel or a click outside closes it, and a
// drag-select released on the backdrop never closes one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { GoalDto, UserDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    listActiveUsers: vi.fn(),
    listDepartments: vi.fn(),
    getDutyHoldings: vi.fn(),
    listSupervisors: vi.fn(),
    createGoal: vi.fn(),
    createUser: vi.fn(),
    getGoal: vi.fn(),
    updateUser: vi.fn(),
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
const { GoalDetailModal } = await import('../components/goals/GoalDetailModal');
const { UserFormModal } = await import('../components/UserFormModal');
const { UserEditModal } = await import('../components/UserEditModal');
const { UNSAVED_CHANGES_MESSAGE } = await import('./useUnsavedChangesWarning');
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

const backdrop = () => document.querySelector('.modal-backdrop') as HTMLElement;
const clickBackdrop = () => {
  fireEvent.mouseDown(backdrop());
  fireEvent.click(backdrop());
};
const clickCancel = () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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

  it('keeps Create task off until something is entered', async () => {
    const onSubmit = vi.fn();
    renderWithSidebar(<TaskForm submitLabel="Create task" onSubmit={onSubmit} />);
    const name = await screen.findByLabelText('Name *');
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
    fireEvent.submit(name.closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: 'Count the pallets' } });
    expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled();
    fireEvent.change(name, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
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
  const typed = (onClose: () => void) => {
    renderWithSidebar(<GoalEditorModal onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Specific/), { target: { value: 'Ship faster' } });
  };

  it('asks on a click outside once something is typed, and stays open on Cancel', () => {
    const onClose = vi.fn();
    typed(onClose);
    clickBackdrop();
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Specific/)).toHaveValue('Ship faster');
  });

  it('asks on its Cancel button too, and closes on OK', () => {
    confirm.mockReturnValue(true);
    const onClose = vi.fn();
    typed(onClose);
    clickCancel();
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click outside or Cancel without asking while still empty', () => {
    const onClose = vi.fn();
    renderWithSidebar(<GoalEditorModal onClose={onClose} onSaved={vi.fn()} />);
    clickBackdrop();
    clickCancel();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps Create goal off until something is filled in', () => {
    renderWithSidebar(<GoalEditorModal onClose={vi.fn()} onSaved={vi.fn()} />);
    const create = () => screen.getByRole('button', { name: 'Create goal' });
    expect(create()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Specific/), { target: { value: 'Ship faster' } });
    expect(create()).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Specific/), { target: { value: '' } });
    expect(create()).toBeDisabled();
  });

  it('keeps Save changes off until the goal is changed', () => {
    const goal = {
      id: 7,
      ownerId: 'u-1',
      specific: 'Ship faster',
      metricType: 'Count',
      unitLabel: null,
      targetValue: 10,
      deadline: '2026-12-31T00:00:00.000Z',
      risks: null,
      mitigations: null,
      notes: null,
      updatedAt: '2026-10-20T12:00:00.000Z',
    } as unknown as GoalDto;
    renderWithSidebar(<GoalEditorModal goal={goal} onClose={vi.fn()} onSaved={vi.fn()} />);
    const save = () => screen.getByRole('button', { name: 'Save changes' });
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Weekly check-in' } });
    expect(save()).toBeEnabled();
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
  it('asks on a click outside once something is typed, and stays open on Cancel', () => {
    const onClose = vi.fn();
    renderWithSidebar(<UserFormModal onClose={onClose} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ava' } });
    clickBackdrop();
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks on its Cancel button too, and closes on OK', () => {
    confirm.mockReturnValue(true);
    const onClose = vi.fn();
    renderWithSidebar(<UserFormModal onClose={onClose} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ava' } });
    clickCancel();
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Cancel without asking while still empty', () => {
    const onClose = vi.fn();
    renderWithSidebar(<UserFormModal onClose={onClose} onCreated={vi.fn()} />);
    clickCancel();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps Create user off until something is filled in', () => {
    renderWithSidebar(<UserFormModal onClose={vi.fn()} onCreated={vi.fn()} />);
    const create = () => screen.getByRole('button', { name: 'Create user' });
    expect(create()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ava' } });
    expect(create()).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: '' } });
    expect(create()).toBeDisabled();

    // Picking a role other than the default counts too.
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Manager' } });
    expect(create()).toBeEnabled();
  });
});

describe('Edit user form', () => {
  const user = {
    id: 'u1',
    email: 'una@example.com',
    firstName: 'Una',
    lastName: 'User',
    role: 'Member',
    title: null,
    jobDescription: null,
    supervisorId: null,
    isActive: true,
  } as unknown as UserDto;

  it('asks on Cancel and on a click outside once something changed', () => {
    const onClose = vi.fn();
    renderWithSidebar(
      <UserEditModal user={user} supervisors={[]} onClose={onClose} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Ana' } });
    clickCancel();
    clickBackdrop();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    clickCancel();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without asking when nothing changed', () => {
    const onClose = vi.fn();
    renderWithSidebar(
      <UserEditModal user={user} supervisors={[]} onClose={onClose} onSaved={vi.fn()} />,
    );
    clickCancel();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('Goal detail: the results panel', () => {
  const person = {
    id: 'me',
    email: 'me@example.com',
    firstName: 'Me',
    lastName: 'Owner',
    title: null,
  };
  const goal = {
    id: 9,
    ownerId: 'me',
    owner: person,
    createdById: 'me',
    createdBy: person,
    specific: 'Ship faster',
    metricType: 'Count',
    unitLabel: null,
    targetValue: 10,
    deadline: '2026-12-31T00:00:00.000Z',
    risks: null,
    mitigations: null,
    notes: null,
    resultValue: null,
    resultsFinalizedAt: null,
    resolution: null,
    supervisorComments: null,
    rejectionComments: null,
    status: 'Approved',
    submittedAt: null,
    approvedAt: null,
    approvedById: null,
    approvedBy: null,
    underReviewAt: null,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  } as unknown as GoalDto;

  async function openResults(onClose: () => void) {
    m(api.getGoal).mockResolvedValue(goal);
    renderWithSidebar(
      <GoalDetailModal goal={goal} supervisorView={false} onClose={onClose} onChanged={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Update results' }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Halfway there' } });
  }

  it('asks on the panel Cancel, and keeps the text when told to stay', async () => {
    await openResults(vi.fn());
    clickCancel();
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(screen.getByLabelText('Notes')).toHaveValue('Halfway there');

    confirm.mockReturnValue(true);
    clickCancel();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  it('asks before a click outside closes the goal', async () => {
    const onClose = vi.fn();
    await openResults(onClose);
    clickBackdrop();
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    clickBackdrop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
