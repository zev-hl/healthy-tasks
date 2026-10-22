import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TaskHistoryEntryDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: { getTaskHistory: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../api/client');
const { TaskHistory } = await import('./TaskHistory');

const entry = (over: Partial<TaskHistoryEntryDto>): TaskHistoryEntryDto => ({
  id: over.field ?? 'x',
  taskId: 7,
  field: 'name',
  changeType: 'added',
  previousValue: null,
  newValue: null,
  detail: null,
  changedAt: '2026-10-19T12:30:00.000Z',
  user: {
    id: 'u-admin',
    firstName: 'System',
    lastName: 'Administrator',
    email: 'a@test.local',
    title: null,
  },
  ...over,
});

describe('TaskHistory', () => {
  it('says when a task was made automatically from an alert (HLAI-112)', async () => {
    (api.getTaskHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      entry({ field: 'alert', detail: 'a Buy Box Won alert (Wasif - US)' }),
      entry({ field: 'template', detail: 'Buy Box Recovery (WasiU_BW_262920830)' }),
    ]);
    render(<TaskHistory taskId={7} version={0} />);
    expect(
      await screen.findByText('Made automatically from a Buy Box Won alert (Wasif - US)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Added template: Buy Box Recovery (WasiU_BW_262920830)'),
    ).toBeInTheDocument();
  });
});
