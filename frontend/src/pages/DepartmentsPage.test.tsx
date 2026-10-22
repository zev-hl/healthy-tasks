import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { DepartmentDto, DutyDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    listDepartments: vi.fn(),
    getPreference: vi.fn(),
    savePreference: vi.fn(),
    createDuty: vi.fn(),
    archiveDuty: vi.fn(),
    deleteDuty: vi.fn(),
    createDepartment: vi.fn(),
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
const { renderWithRouter } = await import('../test/render');
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

beforeEach(() => {
  vi.clearAllMocks();
  m(api.listDepartments).mockResolvedValue(CATALOG);
  m(api.getPreference).mockResolvedValue({ state: { expanded: ['ful'] } });
  m(api.savePreference).mockResolvedValue({ state: {} });
});

describe('DepartmentsPage', () => {
  it('shows the tree with counts, and Archive vs Delete by usage', async () => {
    renderWithRouter(<DepartmentsPage />);
    expect(await screen.findByText('Packing')).toBeInTheDocument();
    expect(screen.getByText('2 departments · 3 duties')).toBeInTheDocument();
    expect(screen.getByText('2 open tasks')).toBeInTheDocument();
    expect(screen.getByText('No one assigned')).toBeInTheDocument();
    // An empty department can be deleted; one with duties only archived.
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: 'Archive' }).length).toBeGreaterThanOrEqual(1);
  });

  it('catches a duplicate duty name (any case or spacing) before it reaches the server', async () => {
    renderWithRouter(<DepartmentsPage />);
    await screen.findByText('Packing');
    fireEvent.click(screen.getByTitle('Add a duty to Fulfillment'));
    fireEvent.change(screen.getByLabelText('New duty name'), { target: { value: '  packing ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add duty' }));
    expect(await screen.findByText('“Packing” already exists in Fulfillment.')).toBeInTheDocument();
    expect(api.createDuty).not.toHaveBeenCalled();
  });

  it('adds a duty and stays ready for the next one', async () => {
    m(api.createDuty).mockResolvedValue(CATALOG);
    renderWithRouter(<DepartmentsPage />);
    await screen.findByText('Packing');
    fireEvent.click(screen.getByTitle('Add a duty to Fulfillment'));
    fireEvent.change(screen.getByLabelText('New duty name'), {
      target: { value: 'Shipping   & labels' },
    });
    fireEvent.keyDown(screen.getByLabelText('New duty name'), { key: 'Enter' });
    await waitFor(() =>
      expect(api.createDuty).toHaveBeenCalledWith('ful', {
        name: 'Shipping & labels',
        description: null,
      }),
    );
    expect(await screen.findByLabelText('New duty name')).toHaveValue('');
  });

  it('search matches duty descriptions and highlights them', async () => {
    renderWithRouter(<DepartmentsPage />);
    await screen.findByText('Packing');
    fireEvent.change(screen.getByLabelText('Search departments or duties'), {
      target: { value: 'put-away' },
    });
    expect(screen.queryByText('Packing')).not.toBeInTheDocument();
    expect(screen.getByText('Receiving')).toBeInTheDocument();
    expect(screen.getByText('put-away').tagName).toBe('MARK');
    expect(screen.getByText('1 of 3 duties')).toBeInTheDocument();
  });

  it('remembers Expand / Collapse all for the user', async () => {
    renderWithRouter(<DepartmentsPage />);
    await screen.findByText('Packing');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByText('Packing')).not.toBeInTheDocument();
    expect(api.savePreference).toHaveBeenLastCalledWith('departments', { expanded: [] });
  });

  it('keeps each form’s button off until something in it changes', async () => {
    renderWithRouter(<DepartmentsPage />);
    await screen.findByText('Packing');
    const button = (name: string) => screen.getByRole('button', { name });

    // A new department: off until a name is typed, and off again once it is cleared.
    fireEvent.click(button('+ New department'));
    expect(button('Create department')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Department name'), { target: { value: 'Returns' } });
    expect(button('Create department')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Department name'), { target: { value: '' } });
    expect(button('Create department')).toBeDisabled();
    fireEvent.click(button('Cancel'));

    // A new duty: Enter does nothing either until something is typed.
    fireEvent.click(screen.getByTitle('Add a duty to Fulfillment'));
    expect(button('Add duty')).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('New duty name'), { key: 'Enter' });
    expect(api.createDuty).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Sorting' } });
    expect(button('Add duty')).toBeEnabled();
    fireEvent.click(button('Cancel'));

    // Renaming a department: Save waits for a change to its name or colour.
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!);
    expect(button('Save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Department name'), {
      target: { value: 'Facilities team' },
    });
    expect(button('Save')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Department name'), { target: { value: 'Facilities' } });
    expect(button('Save')).toBeDisabled();
    fireEvent.click(button('Cancel'));

    // Editing a duty: Save waits for a change to its name or description.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    expect(button('Save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Boxes out' } });
    expect(button('Save')).toBeEnabled();
  });
});
