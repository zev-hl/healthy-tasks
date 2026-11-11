import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { DepartmentDto, DutyDto, OrgPersonDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    listDepartments: vi.fn(),
    getPreference: vi.fn(),
    savePreference: vi.fn(),
    createDuty: vi.fn(),
    archiveDuty: vi.fn(),
    deleteDuty: vi.fn(),
    createDepartment: vi.fn(),
    getOrg: vi.fn(),
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

const { api } = await import('../api/client');
const { DepartmentsPage } = await import('./DepartmentsPage');
const { renderWithDataRouter } = await import('../test/render');
const renderPage = () =>
  renderWithDataRouter(<DepartmentsPage />, {
    path: '/admin/departments',
    initialEntries: ['/admin/departments'],
  });
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const duty = (id: string, name: string, over: Partial<DutyDto> = {}): DutyDto => ({
  id,
  departmentId: 'ful',
  name,
  description: null,
  archived: false,
  peopleCount: 1,
  openTaskCount: 0,
  inUse: true,
  ...over,
});

const CATALOG: DepartmentDto[] = [
  { id: 'fac', name: 'Facilities', color: '#8a8177', archived: false, peopleCount: 0, duties: [] },
  {
    id: 'ful',
    name: 'Fulfillment',
    color: '#b8720a',
    archived: false,
    peopleCount: 3,
    duties: [
      duty('pack', 'Packing', { openTaskCount: 2 }),
      duty('recv', 'Receiving', { description: 'Inbound shipments and put-away' }),
      duty('new', 'Returns sorting', { peopleCount: 0, inUse: false }),
    ],
  },
];

const ana: OrgPersonDto = {
  id: 'u-ana',
  firstName: 'Ana',
  lastName: 'Khan',
  email: 'ana@example.com',
  title: 'Packer',
  role: 'Member',
  supervisorId: null,
  dutyIds: ['pack'],
  openTaskCountByDuty: { pack: 2 },
  alertTaskPicks: [],
  canEditDuties: true,
  canChangeSupervisor: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  m(api.listDepartments).mockResolvedValue(CATALOG);
  m(api.getPreference).mockResolvedValue({ state: { selected: 'ful' } });
  m(api.savePreference).mockResolvedValue({ state: {} });
  // Without the people list the page falls back to counts.
  m(api.getOrg).mockRejectedValue(new Error('no org'));
});

const button = (name: string) => screen.getByRole('button', { name });

describe('DepartmentsPage', () => {
  it('lists departments on the left and the picked one’s duties, with Archive vs Delete by usage', async () => {
    renderPage();
    expect(await screen.findByText('Packing')).toBeInTheDocument();
    expect(screen.getByText('2 departments · 3 duties')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Facilities/ })).toBeInTheDocument();
    expect(screen.getByText('2 open tasks')).toBeInTheDocument();
    expect(screen.getByText('No one assigned')).toBeInTheDocument();
    // A used duty can only be archived; a never-used one deleted.
    expect(screen.getAllByRole('button', { name: 'Archive' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('catches a duplicate duty name (any case or spacing) before it reaches the server', async () => {
    renderPage();
    await screen.findByText('Packing');
    fireEvent.change(screen.getByLabelText('New duty name'), { target: { value: '  packing ' } });
    fireEvent.click(button('Add duty'));
    expect(await screen.findByText('“Packing” already exists in Fulfillment.')).toBeInTheDocument();
    expect(api.createDuty).not.toHaveBeenCalled();
  });

  it('adds a duty on Enter and stays ready for the next one', async () => {
    m(api.createDuty).mockResolvedValue(CATALOG);
    renderPage();
    await screen.findByText('Packing');
    const field = screen.getByLabelText('New duty name');
    expect(button('Add duty')).toBeDisabled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(api.createDuty).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'Shipping   & labels' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(api.createDuty).toHaveBeenCalledWith('ful', {
        name: 'Shipping & labels',
        description: null,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('New duty name')).toHaveValue(''));
  });

  it('search matches duty descriptions and highlights them', async () => {
    renderPage();
    await screen.findByText('Packing');
    fireEvent.change(screen.getByLabelText('Search departments or duties'), {
      target: { value: 'put-away' },
    });
    expect(screen.queryByText('Packing')).not.toBeInTheDocument();
    expect(screen.getByText('Receiving')).toBeInTheDocument();
    expect(screen.getByText('put-away').tagName).toBe('MARK');
    expect(screen.getByText(/1 of 3 duties/)).toBeInTheDocument();
  });

  it('remembers the picked department for the user', async () => {
    renderPage();
    await screen.findByText('Packing');
    fireEvent.click(screen.getByRole('button', { name: /Facilities/ }));
    expect(screen.queryByText('Packing')).not.toBeInTheDocument();
    expect(api.savePreference).toHaveBeenLastCalledWith('departments', { selected: 'fac' });
  });

  it('keeps each form’s button off until something in it changes', async () => {
    renderPage();
    await screen.findByText('Packing');

    // A new department: off until a name is typed, and off again once it is cleared.
    fireEvent.click(screen.getAllByRole('button', { name: 'New department' })[0]!);
    expect(button('Create department')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Department name'), { target: { value: 'Returns' } });
    expect(button('Create department')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Department name'), { target: { value: '' } });
    expect(button('Create department')).toBeDisabled();
    fireEvent.click(button('Cancel'));

    // Renaming the department: Save waits for a change to its name or colour.
    fireEvent.click(button('Rename'));
    expect(button('Save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Department name'), {
      target: { value: 'Fulfillment team' },
    });
    expect(button('Save')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Department name'), {
      target: { value: 'Fulfillment' },
    });
    expect(button('Save')).toBeDisabled();
    fireEvent.click(button('Cancel'));

    // Editing a duty: Save waits for a change to its name or description.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    expect(button('Save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Boxes out' } });
    expect(button('Save')).toBeEnabled();
  });

  it('stages taking a duty away, warns about open tasks, and saves with the Save bar', async () => {
    m(api.getOrg).mockResolvedValue({ people: [ana], scope: 'all' });
    m(api.saveOrg).mockResolvedValue({ people: [{ ...ana, dutyIds: [] }], scope: 'all' });
    renderPage();
    await screen.findByText('Ana Khan');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

    fireEvent.click(button('Take Packing from Ana Khan'));
    expect(screen.getByText(/2 open tasks assigned to Ana use this duty/)).toBeInTheDocument();
    fireEvent.click(button('Save changes'));
    await waitFor(() =>
      expect(api.saveOrg).toHaveBeenCalledWith({
        dutyChanges: [{ userId: 'u-ana', add: [], remove: ['pack'] }],
      }),
    );
  });
});
