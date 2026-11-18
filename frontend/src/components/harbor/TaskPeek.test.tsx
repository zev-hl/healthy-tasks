import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TaskDetailDto } from '@healthy-tasks/shared';

vi.mock('../../api/client', () => ({
  api: { getTask: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../../api/client');
const { PeekRow } = await import('./TaskPeek');
const getTask = api.getTask as unknown as ReturnType<typeof vi.fn>;

const person = { id: 'u1', email: 'a@x.test', firstName: 'Ada', lastName: 'Admin', title: null };
const task = {
  id: 7,
  name: 'Recover the Buy Box',
  description: '<p>Check the price first.</p>',
  creator: person,
  createdAt: '2026-11-10T12:00:00.000Z',
  startAt: null,
  duty: null,
  tags: ['pricing'],
  isBlockedBy: [{ id: 3, name: 'Restock', status: 'Open', accessible: true }],
  children: [],
  attachments: [],
  comments: [
    {
      id: 'c1',
      author: person,
      body: '<p>Price dropped <img src="x" onerror="alert(1)"> again</p>',
      createdAt: '2026-11-11T12:00:00.000Z',
    },
  ],
} as unknown as TaskDetailDto;

describe('PeekRow', () => {
  it('opens the details in place and closes them again', async () => {
    getTask.mockResolvedValue(task);
    render(
      <MemoryRouter>
        <PeekRow id={7} name="Recover the Buy Box">
          <span>Recover the Buy Box</span>
        </PeekRow>
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('button', { name: 'Show details of Recover the Buy Box' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(await screen.findByText('Check the price first.')).toBeInTheDocument();
    expect(screen.getByText('#3 Restock')).toBeInTheDocument();
    expect(screen.getByText('pricing')).toBeInTheDocument();
    // The latest comment shows as plain text only.
    expect(screen.getByText(/Price dropped again/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/tasks/7');
    fireEvent.click(screen.getByRole('button', { name: 'Hide details of Recover the Buy Box' }));
    expect(screen.queryByText('Check the price first.')).toBeNull();
  });
});
