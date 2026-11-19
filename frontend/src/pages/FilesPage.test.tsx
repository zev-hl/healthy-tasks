import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

vi.mock('../api/client', () => ({
  api: {
    listFiles: vi.fn(),
    listDepartments: vi.fn(async () => [
      { id: 'd1', name: 'Listings', color: '#36f', archived: false, duties: [], peopleCount: 1 },
    ]),
    listActiveUsers: vi.fn(async () => []),
    getAttachmentDownloadUrl: vi.fn(async () => ({ url: 'https://files.test/x', filename: 'x' })),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../components/harbor/Toast', () => ({ useToast: () => vi.fn() }));

const { api } = await import('../api/client');
const { FilesPage } = await import('./FilesPage');
const { renderWithRouter } = await import('../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const user = { id: 'u1', email: 'ana@x', firstName: 'Ana', lastName: 'Khan', title: null };
const file = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  filename: 'contract.pdf',
  contentType: 'application/pdf',
  size: 2048,
  uploadedBy: user,
  createdAt: '2026-11-18T15:00:00Z',
  taskId: 7,
  commentId: null,
  recording: null,
  durationMs: null,
  transcript: null,
  task: { id: 7, name: 'Supplier contract', isPrivate: false },
  on: 'task',
  department: { id: 'd1', name: 'Listings', color: '#36f' },
  ...over,
});

describe('Files (I3)', () => {
  beforeEach(() => {
    fn(api.listFiles).mockReset();
    // jsdom has no scrollIntoView; the filter menus call it.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('lists files with their task, department and uploader, and pages on', async () => {
    fn(api.listFiles)
      .mockResolvedValueOnce({ files: [file()], next: 'c1' })
      .mockResolvedValueOnce({
        files: [
          file({
            id: 'f2',
            filename: 'n.webm',
            recording: 'voice',
            on: 'comment',
            transcript: 'call about pallets',
            department: null,
          }),
        ],
        next: null,
      });
    renderWithRouter(<FilesPage />);
    await settle();
    expect(screen.getByRole('button', { name: /contract\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#7 Supplier contract' })).toHaveAttribute(
      'href',
      '/tasks/7',
    );
    expect(screen.getByRole('list', { name: 'Files' })).toHaveTextContent('Listings');
    expect(screen.getByText('Ana Khan')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show more' })));
    expect(api.listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
    expect(screen.getByRole('button', { name: /Voice note/ })).toBeInTheDocument();
    expect(screen.getByText(/In a comment on/)).toBeInTheDocument();
    expect(screen.getByText('“call about pallets”')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('asks again with the filter chosen', async () => {
    fn(api.listFiles).mockResolvedValue({ files: [], next: null });
    renderWithRouter(<FilesPage />);
    await settle();
    expect(screen.getByText('No files yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Kind/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Images' }));
    await settle();
    expect(api.listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'image' }));
    expect(screen.getByText('No files match.')).toBeInTheDocument();
  });
});
