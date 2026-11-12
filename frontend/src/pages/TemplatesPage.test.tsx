import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { TemplateSummaryDto } from '@healthy-tasks/shared';

// Every API call answers with an empty list unless a test says otherwise.
vi.mock('../api/client', () => {
  const fns: Record<string | symbol, unknown> = {};
  return {
    api: new Proxy(fns, {
      get: (t, k) => (t[k] ??= vi.fn(() => Promise.resolve([]))),
    }),
    ApiError: class ApiError extends Error {},
  };
});
// jsdom has no scrolling.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
vi.mock('../components/RichTextEditor', () => ({ RichTextEditor: () => null }));

const { api } = await import('../api/client');
const { TemplatesPage } = await import('./TemplatesPage');
const { renderWithDataRouter } = await import('../test/render');

const tpl = (id: number, name: string, over: Partial<TemplateSummaryDto> = {}) =>
  ({
    id,
    name,
    description: null,
    createdBy: { id: 'u', firstName: 'Ada', lastName: 'Admin' },
    recurrenceType: 'None',
    isActive: true,
    nodeCount: 2,
    occurrenceCount: 0,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }) as TemplateSummaryDto;

describe('TemplatesPage — editing beside the list', () => {
  it('keeps the list as a rail and adds a sub-task by typing its name', async () => {
    (api.listTemplates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      tpl(1, 'Supplier onboarding'),
      tpl(2, 'Warehouse inspection', { recurrenceType: 'Fixed' }),
    ]);
    renderWithDataRouter(<TemplatesPage />, {
      path: '/admin/templates',
      initialEntries: ['/admin/templates'],
    });
    await act(async () => {});
    fireEvent.click(screen.getAllByRole('button', { name: /New template/ })[0]!);

    const rail = screen.getByRole('complementary', { name: 'Templates' });
    expect(within(rail).getByText('Supplier onboarding')).toBeTruthy();
    expect(within(rail).getByText('Repeating')).toBeTruthy();

    const quick = screen.getByLabelText('Quick add a sub-task');
    fireEvent.change(quick, { target: { value: 'Collect W-9' } });
    fireEvent.keyDown(quick, { key: 'Enter' });
    expect(screen.getByDisplayValue('Collect W-9')).toBeTruthy();
    expect((quick as HTMLInputElement).value).toBe('');
  });
});
