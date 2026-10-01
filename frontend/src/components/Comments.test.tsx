import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { TaskDetailDto, UserDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    createComment: vi.fn(),
    deleteComment: vi.fn(),
    presignCommentDraftAttachment: vi.fn(),
    getMentionCandidates: vi.fn().mockResolvedValue([]),
  },
  uploadToStorage: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
    get fullMessage(): string {
      return this.message;
    }
  },
}));

// The real editor is TipTap, which is heavy and irrelevant here. A textarea
// reports the same thing: text going in.
vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({
    onChange,
    ariaLabel,
  }: {
    onChange: (html: string) => void;
    ariaLabel: string;
  }) => <textarea aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />,
}));

const { api, uploadToStorage, ApiError } = await import('../api/client');
const { Comments } = await import('./Comments');
const { renderWithRouter } = await import('../test/render');

const createComment = api.createComment as unknown as ReturnType<typeof vi.fn>;
const presign = api.presignCommentDraftAttachment as unknown as ReturnType<typeof vi.fn>;
const upload = uploadToStorage as unknown as ReturnType<typeof vi.fn>;

const currentUser = { id: 'u1', email: 'me@test.local', role: 'Admin' } as unknown as UserDto;
const task = { id: 7, access: 'full', comments: [] } as unknown as TaskDetailDto;

/** The same task, carrying one comment of mine so the Delete button is there. */
const taskWithComment = {
  id: 7,
  access: 'full',
  comments: [
    {
      id: 'c1',
      body: '<p>Mine</p>',
      author: { id: 'u1', email: 'me@test.local' },
      createdAt: '2026-10-01T10:00:00.000Z',
      editedAt: null,
      attachments: [],
    },
  ],
} as unknown as TaskDetailDto;

/**
 * A stand-in for a file picked from disk. lastModified is pinned because the
 * composer treats name + size + lastModified as a file's identity, and a live
 * clock would make two picks of the "same" file look different.
 */
function file(name: string, type = 'application/pdf', size = 1024): File {
  const f = new File(['x'], name, { type, lastModified: 1_700_000_000_000 });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** Open the composer and return the hidden file input behind "Attach File". */
function openComposer() {
  renderWithRouter(<Comments task={task} currentUser={currentUser} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a comment…' }));
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

const settle = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  vi.clearAllMocks();
  createComment.mockResolvedValue(task);
  presign.mockImplementation((_taskId: number, meta: { filename: string }) =>
    Promise.resolve({
      uploadUrl: 'https://storage.test/put',
      storageKey: `comments/7/u1/abc/${meta.filename}`,
    }),
  );
  upload.mockResolvedValue(undefined);
});

describe('Comments delete confirmation', () => {
  it('asks in an in-app dialog, not the browser box, and only deletes on confirm', async () => {
    const deleteComment = api.deleteComment as unknown as ReturnType<typeof vi.fn>;
    deleteComment.mockResolvedValue(taskWithComment);
    renderWithRouter(
      <Comments task={taskWithComment} currentUser={currentUser} onChanged={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await settle();

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Delete this comment?')).toBeInTheDocument();
    expect(deleteComment).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(deleteComment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await settle();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith('c1'));
  });
});

describe('Comments composer', () => {
  it('offers Attach File straight away, with the comment box still empty', () => {
    openComposer();
    expect(screen.getByRole('button', { name: /Attach File/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
  });

  it('enables Comment once a file is chosen, with no text at all', async () => {
    const input = openComposer();
    fireEvent.change(input, { target: { files: [file('report.pdf')] } });
    await settle();

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled();
  });

  it('posts a file with no text as one call, after uploading it', async () => {
    const input = openComposer();
    fireEvent.change(input, { target: { files: [file('report.pdf')] } });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(createComment).toHaveBeenCalled());

    expect(upload).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledWith(7, {
      body: undefined,
      attachments: [
        {
          filename: 'report.pdf',
          contentType: 'application/pdf',
          size: 1024,
          storageKey: 'comments/7/u1/abc/report.pdf',
        },
      ],
    });
  });

  it('sends text and files together', async () => {
    const input = openComposer();
    fireEvent.change(screen.getByLabelText('New comment'), { target: { value: '<p>Here</p>' } });
    fireEvent.change(input, { target: { files: [file('a.pdf'), file('b.png', 'image/png')] } });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(createComment).toHaveBeenCalled());

    const [, body] = createComment.mock.calls[0] as [number, { body: string; attachments: [] }];
    expect(body.body).toBe('<p>Here</p>');
    expect(body.attachments).toHaveLength(2);
  });

  it('removes a chosen file again', async () => {
    const input = openComposer();
    fireEvent.change(input, { target: { files: [file('gone.pdf')] } });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Remove gone.pdf' }));
    await settle();

    expect(screen.queryByText('gone.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
  });

  it('says so when the same file is picked twice', async () => {
    const input = openComposer();
    fireEvent.change(input, { target: { files: [file('same.pdf')] } });
    await settle();
    fireEvent.change(input, { target: { files: [file('same.pdf')] } });
    await settle();

    expect(screen.getByText(/already attached to this comment/)).toBeInTheDocument();
    expect(screen.getAllByText('same.pdf')).toHaveLength(1);
  });

  it('refuses a file type that is not allowed', async () => {
    const input = openComposer();
    fireEvent.change(input, { target: { files: [file('virus.exe', 'application/x-msdownload')] } });
    await settle();

    expect(screen.getByText(/Unsupported file type/)).toBeInTheDocument();
    expect(screen.queryByText('virus.exe')).not.toBeInTheDocument();
  });

  it('stops at five files', async () => {
    const input = openComposer();
    const six = [0, 1, 2, 3, 4, 5].map((i) => file(`f${i}.pdf`));
    fireEvent.change(input, { target: { files: six } });
    await settle();

    expect(screen.getByText(/at most 5 files/)).toBeInTheDocument();
    expect(screen.getByText('f4.pdf')).toBeInTheDocument();
    expect(screen.queryByText('f5.pdf')).not.toBeInTheDocument();
  });

  it('says so when the upload fails, and does not post the comment', async () => {
    upload.mockRejectedValue(new ApiError(403, 'Upload failed (403)'));
    const input = openComposer();
    fireEvent.change(input, { target: { files: [file('doomed.pdf')] } });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(screen.getByText(/Upload failed/)).toBeInTheDocument());

    expect(createComment).not.toHaveBeenCalled();
    // The file stays in the list so the person can simply try again.
    expect(screen.getByText('doomed.pdf')).toBeInTheDocument();
  });
});
