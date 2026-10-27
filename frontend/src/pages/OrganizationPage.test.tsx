import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { DepartmentDto, OrgDto, OrgPersonDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    getOrg: vi.fn(),
    listDepartments: vi.fn(),
    saveOrg: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

const { api, ApiError } = await import('../api/client');
const { OrganizationPage } = await import('./OrganizationPage');
const { renderWithDataRouter } = await import('../test/render');
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/**
 * HLAI-112: a duty someone's Alert Task Setup role needs can't be taken away on
 * the Organization screen — a warning under it, and Save stays off.
 */

const duty = (id: string, name: string) => ({
  id,
  departmentId: 'dep-pricing',
  name,
  description: null,
  archived: false,
  peopleCount: 1,
  openTaskCount: 0,
  inUse: true,
});

const DEPARTMENTS = [
  {
    id: 'dep-pricing',
    name: 'Pricing & Buy Box',
    color: '#3b6ea5',
    archived: false,
    peopleCount: 1,
    duties: [duty('d-bbr', 'Buy Box Recovery'), duty('d-pm', 'Price Monitoring')],
  },
] as DepartmentDto[];

const ana = (over: Partial<OrgPersonDto> = {}): OrgPersonDto => ({
  id: 'u-ana',
  firstName: 'Ana',
  lastName: 'Khan',
  email: 'ana@test.local',
  title: null,
  role: 'Member',
  supervisorId: null,
  dutyIds: ['d-bbr', 'd-pm'],
  openTaskCountByDuty: {},
  alertTaskPicks: [{ alertType: 'BuyBoxLost', role: 'Pricing Analyst', dutyIds: ['d-bbr'] }],
  canEditDuties: true,
  canChangeSupervisor: true,
  ...over,
});

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function renderPage(org: OrgDto) {
  m(api.getOrg).mockResolvedValue(org);
  renderWithDataRouter(<OrganizationPage />, {
    path: '/admin/organization',
    initialEntries: ['/admin/organization?person=u-ana'],
  });
  await settle();
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const saveButton = () => screen.queryByRole('button', { name: 'Save changes' });

beforeEach(() => {
  vi.clearAllMocks();
  m(api.listDepartments).mockResolvedValue(DEPARTMENTS);
});

describe('OrganizationPage — duties Alert Task Setup needs', () => {
  it('warns under a needed duty as soon as it is unticked, and keeps Save off', async () => {
    await renderPage({ people: [ana()], scope: 'all' });
    expect(box('Buy Box Recovery')).toBeChecked();

    fireEvent.click(box('Buy Box Recovery'));
    expect(screen.queryByText(/would go to Ana Khan/)).toBeNull();
    expect(
      screen.getByText(
        /Alert Task Setup would show a warning on Ana Khan as Pricing Analyst for Buy Box Lost/,
      ),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute('title', expect.stringMatching(/Ana Khan is needed/));
    expect(screen.getByText(/Can’t save: a duty Alert Task Setup needs/)).toBeInTheDocument();

    // Ticking it again clears the warning (and, with nothing else changed, the bar).
    fireEvent.click(box('Buy Box Recovery'));
    expect(screen.queryByText(/Alert Task Setup would show a warning/)).toBeNull();
    expect(saveButton()).toBeNull();
  });

  it('lets a duty go that Alert Task Setup does not need', async () => {
    m(api.saveOrg).mockResolvedValue({ people: [ana({ dutyIds: ['d-bbr'] })], scope: 'all' });
    await renderPage({ people: [ana()], scope: 'all' });

    fireEvent.click(box('Price Monitoring'));
    expect(screen.queryByText(/Alert Task Setup would show a warning/)).toBeNull();
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton()!);
    await settle();
    expect(api.saveOrg).toHaveBeenCalledWith(
      expect.objectContaining({ dutyChanges: [{ userId: 'u-ana', add: [], remove: ['d-pm'] }] }),
    );
  });

  it('tells a Manager an Admin has to change Alert Task Setup', async () => {
    await renderPage({ people: [ana()], scope: 'team' });
    fireEvent.click(box('Buy Box Recovery'));
    expect(screen.getByText(/\(an Admin has to\)/)).toBeInTheDocument();
  });

  it('shows the server’s reason if it refuses the save', async () => {
    // The screen's own copy said nothing was needed; the server knows better.
    m(api.saveOrg).mockRejectedValue(
      new ApiError(
        422,
        'Ana Khan is needed as Pricing Analyst for Buy Box Lost on Alert Task Setup.',
        {
          code: 'ALERT_TASK_DUTY_NEEDED',
        },
      ),
    );
    await renderPage({ people: [ana({ alertTaskPicks: [] })], scope: 'all' });
    fireEvent.click(box('Buy Box Recovery'));
    fireEvent.click(saveButton()!);
    await settle();
    expect(
      screen.getByText(
        'Ana Khan is needed as Pricing Analyst for Buy Box Lost on Alert Task Setup.',
      ),
    ).toBeInTheDocument();
  });
});
