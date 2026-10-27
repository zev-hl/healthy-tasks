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
