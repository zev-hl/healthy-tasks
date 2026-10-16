import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { GoalDto, TaskUserRef } from '@healthy-tasks/shared';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'sup', role: 'Manager' } }),
}));

vi.mock('../api/client', () => ({
  api: {
    listTeamGoals: vi.fn(),
    getUserHierarchy: vi.fn(),
    getGoal: vi.fn(),
    approveGoal: vi.fn(),
  },
  exportTeamGoalsToExcel: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const { api } = await import('../api/client');
const { TeamGoalsPage } = await import('./TeamGoalsPage');
const { renderWithDataRouter } = await import('../test/render');
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const ref = (id: string, firstName: string): TaskUserRef => ({
  id,
  email: `${id}@test.local`,
  firstName,
  lastName: 'Test',
  title: null,
});

const PENDING: GoalDto = {
  id: 7,
  ownerId: 'emp',
  owner: ref('emp', 'Ava'),
  createdById: 'emp',
  createdBy: ref('emp', 'Ava'),
  specific: 'Ship 100 orders a day',
  metricType: 'Count',
  unitLabel: 'orders',
  targetValue: 100,
  deadline: '2026-12-31T00:00:00.000Z',
  risks: null,
  mitigations: null,
  notes: null,
  resultValue: null,
  resultsFinalizedAt: null,
  resolution: null,
  supervisorComments: null,
  rejectionComments: null,
  status: 'PendingApproval',
  submittedAt: '2026-10-01T00:00:00.000Z',
  approvedAt: null,
  approvedById: null,
  approvedBy: null,
  underReviewAt: null,
  resolvedAt: null,
  resolvedById: null,
  resolvedBy: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const APPROVED: GoalDto = {
  ...PENDING,
  status: 'Approved',
  approvedAt: '2026-10-12T00:00:00.000Z',
  approvedById: 'sup',
  approvedBy: ref('sup', 'Sam'),
  updatedAt: '2026-10-12T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  m(api.getUserHierarchy).mockResolvedValue([]);
  m(api.getGoal).mockResolvedValue(PENDING);
  m(api.approveGoal).mockResolvedValue(APPROVED);
});

describe('TeamGoalsPage — the open goal', () => {
  it('stays open after an action moves it out of the filtered list', async () => {
    // First load shows the pending goal; after Approve the reload no longer
    // includes it (as with a "Pending approval" status filter).
    m(api.listTeamGoals).mockResolvedValueOnce([PENDING]).mockResolvedValue([]);
    renderWithDataRouter(<TeamGoalsPage />);

    fireEvent.click(await screen.findByText('Ship 100 orders a day'));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(api.listTeamGoals).toHaveBeenCalledTimes(2));
    // The detail is still on screen, now showing the approved goal.
    expect(screen.getByText('Ship 100 orders a day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
