import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { TaskDetailDto, UserDto } from '@healthy-tasks/shared';

// Every API call answers with an empty list unless a test says otherwise.
vi.mock('../api/client', () => {
  const fns: Record<string | symbol, unknown> = {};
  return {
    api: new Proxy(fns, {
      get: (t, k) => (t[k] ??= vi.fn(() => Promise.resolve([]))),
    }),
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
  };
});

// TipTap is heavy and irrelevant here: a textarea shows what the editor holds.
vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (html: string) => void;
    ariaLabel: string;
  }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// The task page's other sections load their own data; not what is tested here.
vi.mock('./Comments', () => ({ Comments: () => null }));
vi.mock('./AttachmentSection', () => ({ AttachmentSection: () => null }));
vi.mock('./TaskHistory', () => ({ TaskHistory: () => null }));
vi.mock('./TaskReminders', () => ({ TaskReminders: () => null }));
vi.mock('./TaskRecurrencePanel', () => ({ TaskRecurrencePanel: () => null }));

const { api } = await import('../api/client');
const { TaskDetailView } = await import('./TaskDetailView');
const { renderWithDataRouter } = await import('../test/render');
const updateTask = api.updateTask as unknown as ReturnType<typeof vi.fn>;

/**
 * The Description's expand button: the description in a big pop-up, for reading
 * and editing alike.
 */

const me = {
  id: 'u-admin',
  email: 'admin@test.local',
  firstName: 'Ada',
  lastName: 'Admin',
  title: null,
  role: 'Admin',
} as unknown as UserDto;

function makeTask(description: string | null): TaskDetailDto {
  const ref = { id: me.id, email: me.email, firstName: 'Ada', lastName: 'Admin', title: null };
  return {
    id: 7,
    name: 'Recover the Buy Box',
    description,
    creatorId: me.id,
    creator: ref,
    assigneeId: null,
    assignee: null,
    parentId: null,
    priority: 'Medium',
    status: 'Open',
    statusChangedAt: null,
    tags: [],
    startAt: null,
    dueAt: null,
    createdAt: '2026-10-21T12:00:00.000Z',
    updatedAt: '2026-10-21T12:00:00.000Z',
    isPrivate: false,
    reviewInitiatorId: null,
    reviewInitiator: null,
    priorAssigneeId: null,
    priorAssignee: null,
    priorStatus: null,
    instanceLabel: null,
    templateId: null,
    dutyId: null,
    duty: null,
    dutyMismatch: false,
    alertGroup: null,
    alertType: null,
    parent: null,
    children: [],
    blocks: [],
    isBlockedBy: [],
    attachments: [],
    comments: [],
    recurrence: null,
    recurrenceSourceId: null,
    recurrenceSeq: null,
    access: 'full',
    canTogglePrivate: true,
    reminderCount: 0,
  } as unknown as TaskDetailDto;
}

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function renderTask(description: string | null) {
  renderWithDataRouter(<TaskDetailView initialTask={makeTask(description)} currentUser={me} />, {
    path: '/tasks/:id',
    initialEntries: ['/tasks/7'],
  });
  await settle();
}

const expandButton = () => screen.queryByRole('button', { name: 'Expand the description' });
const popup = () => screen.queryByRole('dialog', { name: 'Description' });

beforeEach(() => {
  updateTask.mockClear();
});

describe('TaskDetailView — the expanded description', () => {
  it('has no expand button when there is no description yet', async () => {
    await renderTask(null);
    expect(screen.getByText('No description yet.')).toBeInTheDocument();
    expect(expandButton()).toBeNull();
  });

  it('opens the description in a pop-up, and the shrink button closes it', async () => {
    await renderTask('<p>Check the price first.</p>');
    fireEvent.click(expandButton()!);
    const dialog = within(popup()!);
    expect(dialog.getByText('Check the price first.')).toBeInTheDocument();
    expect(popup()!.querySelector('.rich-text')).not.toBeNull();

    fireEvent.click(dialog.getByRole('button', { name: 'Shrink the description' }));
    expect(popup()).toBeNull();
  });

  it('closes on Escape', async () => {
    await renderTask('<p>Check the price first.</p>');
    fireEvent.click(expandButton()!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(popup()).toBeNull();
  });

  it('edits in the pop-up, keeping the unsaved text when it closes', async () => {
    await renderTask('<p>Check the price first.</p>');
    fireEvent.click(expandButton()!);
    fireEvent.click(within(popup()!).getByRole('button', { name: 'Edit' }));
    const editor = within(popup()!).getByLabelText('Task description');
    fireEvent.change(editor, { target: { value: '<p>Check the price, then the sellers.</p>' } });

    // Shrinking takes the edit back to the card, nothing lost; only one editor.
    fireEvent.click(within(popup()!).getByRole('button', { name: 'Shrink the description' }));
    expect(popup()).toBeNull();
    const editors = screen.getAllByLabelText('Task description');
    expect(editors).toHaveLength(1);
    expect(editors[0]).toHaveValue('<p>Check the price, then the sellers.</p>');

    // And expanding again carries it into the pop-up.
    fireEvent.click(expandButton()!);
    expect(within(popup()!).getByLabelText('Task description')).toHaveValue(
      '<p>Check the price, then the sellers.</p>',
    );
    expect(screen.getAllByLabelText('Task description')).toHaveLength(1);
  });

  it('saves from the pop-up and stays open, showing the saved text', async () => {
    updateTask.mockImplementationOnce(async (_id: number, body: { description: string }) => ({
      ...makeTask(body.description),
      updatedAt: '2026-10-22T12:00:00.000Z',
    }));
    await renderTask('<p>Check the price first.</p>');
    fireEvent.click(expandButton()!);
    fireEvent.click(within(popup()!).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(popup()!).getByLabelText('Task description'), {
      target: { value: '<p>New steps.</p>' },
    });
    fireEvent.click(within(popup()!).getByRole('button', { name: 'Save' }));
    await settle();

    expect(updateTask).toHaveBeenCalledWith(
      7,
      { description: '<p>New steps.</p>' },
      '2026-10-21T12:00:00.000Z',
    );
    expect(within(popup()!).getByText('New steps.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Task description')).toBeNull();
  });
});

describe('TaskDetailView — Linked tasks', () => {
  // jsdom has no scrollIntoView; the menus call it to keep the highlight in view.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    // The parent box loads the parent.
    (api.getTask as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeTask(null));
  });
  const ref = (id: number, name: string) =>
    ({ id, name, status: 'Open', accessible: true }) as const;

  async function renderLinked(over: Partial<TaskDetailDto>) {
    renderWithDataRouter(
      <TaskDetailView initialTask={{ ...makeTask(null), ...over }} currentUser={me} />,
      { path: '/tasks/:id', initialEntries: ['/tasks/7'] },
    );
    await settle();
    return screen.getByRole('heading', { name: 'Linked tasks' }).closest('section')!;
  }

  it('lists every link in one list with its type, and unlinks with ×', async () => {
    const card = await renderLinked({
      parent: ref(1, 'Quarter plan'),
      isBlockedBy: [ref(3, 'Restock')],
      blocks: [ref(11, 'Ship order')],
    });
    const rows = within(card).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.hb-link-type')?.textContent)).toEqual([
      'Parent',
      'Blocked by',
      'Blocks',
    ]);
    // The status shows once, as the pill.
    expect(within(rows[1]!).queryByText('(Open)')).toBeNull();
    const removeDependency = api.removeDependency as unknown as ReturnType<typeof vi.fn>;
    removeDependency.mockResolvedValueOnce(makeTask(null));
    fireEvent.click(within(card).getByRole('button', { name: 'Unlink blocked by #3' }));
    await settle();
    expect(removeDependency).toHaveBeenCalledWith(7, 'blockedBy', 3);
  });

  it('adds with two dropdowns: type, then a task search', async () => {
    const card = await renderLinked({});
    expect(within(card).getByText('Nothing linked yet.')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /^Link type/ }));
    const opts = () => screen.getAllByRole('option').map((o) => o.textContent);
    expect(opts()).toEqual([
      'Blocked bywaits for it',
      'Blocksit waits for this',
      'Parentthis goes under it',
    ]);
    fireEvent.click(screen.getAllByRole('option')[1]!);
    fireEvent.click(within(card).getByRole('button', { name: /Find a task/ }));
    expect(screen.getByRole('dialog', { name: 'Blocks' })).toBeInTheDocument();
  });

  it('leaves Parent out of the types once a parent is set', async () => {
    const card = await renderLinked({ parent: ref(1, 'Quarter plan') });
    fireEvent.click(within(card).getByRole('button', { name: /^Link type/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Blocked bywaits for it',
      'Blocksit waits for this',
    ]);
  });
});

describe('TaskDetailView — parent box', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows the parent's due date, status and description on a sub-task", async () => {
    const getTask = api.getTask as unknown as ReturnType<typeof vi.fn>;
    getTask.mockResolvedValue({
      ...makeTask('<p>Check every <b>supplier</b> price.</p>'),
      id: 1,
      name: 'Quarter plan',
      status: 'InProgress',
      dueAt: '2020-01-02T17:00:00.000Z',
    });
    renderWithDataRouter(
      <TaskDetailView
        initialTask={{
          ...makeTask(null),
          parent: { id: 1, name: 'Quarter plan', status: 'InProgress', accessible: true },
        }}
        currentUser={me}
      />,
      { path: '/tasks/:id', initialEntries: ['/tasks/7'] },
    );
    await settle();
    const box = screen.getByRole('region', { name: 'Parent task' });
    expect(within(box).getByRole('link', { name: '#1 Quarter plan' })).toBeTruthy();
    expect(within(box).getByText('Check every supplier price.')).toBeTruthy();
    expect(box.querySelector('.hb-parentbox-due.is-late')).not.toBeNull();
  });

  it('names a parent you cannot open without loading it', async () => {
    const getTask = api.getTask as unknown as ReturnType<typeof vi.fn>;
    getTask.mockClear();
    renderWithDataRouter(
      <TaskDetailView
        initialTask={{
          ...makeTask(null),
          parent: { id: 1, name: 'Hidden', status: 'Open', accessible: false },
        }}
        currentUser={me}
      />,
      { path: '/tasks/:id', initialEntries: ['/tasks/7'] },
    );
    await settle();
    const box = screen.getByRole('region', { name: 'Parent task' });
    expect(within(box).getByText(/#1, which you can’t open/)).toBeTruthy();
    expect(getTask).not.toHaveBeenCalledWith(1);
  });
});
