import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { Link } from 'react-router-dom';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ActiveUserDto,
  type DepartmentDto,
  type ExclusivesAlertTaskSetupDto,
  type TemplateDto,
  type TemplateSummaryDto,
} from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    listActiveUsers: vi.fn(),
    listDepartments: vi.fn(),
    getDutyHoldings: vi.fn(),
    getExclusivesAlertTaskSetup: vi.fn(),
    saveExclusivesAlertTaskSetup: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const { api, ApiError } = await import('../api/client');
const { ExclusivesAlertTasksPage } = await import('./ExclusivesAlertTasksPage');
const { renderWithDataRouter } = await import('../test/render');

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const listTemplates = mock(api.listTemplates);
const getTemplate = mock(api.getTemplate);
const listActiveUsers = mock(api.listActiveUsers);
const listDepartments = mock(api.listDepartments);
const getDutyHoldings = mock(api.getDutyHoldings);
const getSetup = mock(api.getExclusivesAlertTaskSetup);
const saveSetup = mock(api.saveExclusivesAlertTaskSetup);

// --- Fixtures ----------------------------------------------------------------

/** A template's roles and tasks: [role, duty id or null] per task. */
const detail = (id: number, name: string, tasks: [string, string | null][]) =>
  ({
    id,
    name,
    roles: [...new Set(tasks.map(([role]) => role))],
    nodes: tasks.map(([role, dutyId], i) => ({ id: id * 10 + i, assigneeRole: role, dutyId })),
  }) as unknown as TemplateDto;

const TEMPLATES: Record<number, TemplateDto> = {
  1: detail(1, 'Listing Suppression Resolution', [['Listing Specialist', 'd-listing']]),
  3: detail(3, 'Price Review', [
    ['Analyst', null],
    ['Reviewer', null],
  ]),
  4: detail(4, 'Price Review v2', [
    ['Analyst', null],
    ['Approver', null],
  ]),
  5: detail(5, 'Plain checklist', []),
};

const person = (id: string, firstName: string, lastName: string) =>
  ({ id, firstName, lastName, email: `${id}@test.local`, title: null }) as ActiveUserDto;

const DEPARTMENTS = [
  {
    id: 'dep-ecom',
    name: 'E-commerce',
    color: '#0b5f54',
    archived: false,
    peopleCount: 1,
    duties: [
      {
        id: 'd-listing',
        departmentId: 'dep-ecom',
        name: 'Listing management',
        description: null,
        archived: false,
        peopleCount: 1,
        openTaskCount: 0,
      },
    ],
  },
] as unknown as DepartmentDto[];

/** Nothing set up yet, as the server answers before the first save. */
const emptySetup = (): ExclusivesAlertTaskSetupDto => ({
  settings: EXCLUSIVES_ALERT_TYPES.map((alertType) => ({
    alertType,
    templateId: null,
    roleAssignments: [],
  })),
  updatedAt: null,
});

// --- Helpers -----------------------------------------------------------------

/** Let every pending request answer. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** The screen on a data router (its leave warning needs one), with a link away. */
async function renderPage() {
  renderWithDataRouter(
    <>
      <Link to="/elsewhere">Elsewhere</Link>
      <ExclusivesAlertTasksPage />
    </>,
    {
      extraRoutes: [
        { path: '/elsewhere', element: <p>Another page</p> },
        { path: '/admin/templates', element: <p>The Templates page</p> },
      ],
    },
  );
  await settle();
}

const rowOf = (label: string) =>
  screen
    .getAllByRole('row')
    .find((r) => within(r).queryByText(label, { selector: '.status-pill' })) as HTMLElement;
const saveButton = () => screen.getByRole('button', { name: /^Save/ });
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });
const personSelect = (role: string, typeLabel: string) =>
  screen.getByRole('combobox', { name: `Person for ${role} (${typeLabel})` }) as HTMLSelectElement;

/** Open a row's template dropdown, click one of its options, and let its roles load. */
async function pickTemplate(typeLabel: string, option: string) {
  fireEvent.click(
    within(rowOf(typeLabel)).getByRole('button', {
      name: new RegExp(`^Template for ${typeLabel}:`),
    }),
  );
  fireEvent.click(screen.getByRole('option', { name: option }));
  await settle();
}

function pickPerson(role: string, typeLabel: string, userId: string) {
  fireEvent.change(personSelect(role, typeLabel), { target: { value: userId } });
}

/** What the last Save sent for one alert type. */
const sentFor = (type: string) =>
  (
    saveSetup.mock.calls.at(-1)![0].settings as { alertType: string; roleAssignments: unknown }[]
  ).find((s) => s.alertType === type);

let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  confirmSpy = vi.fn(() => false);
  vi.spyOn(window, 'confirm').mockImplementation(confirmSpy);
  listTemplates.mockResolvedValue(
    Object.values(TEMPLATES).map((t) => ({ id: t.id, name: t.name }) as TemplateSummaryDto),
  );
  getTemplate.mockImplementation(async (id: number) => {
    if (TEMPLATES[id]) return TEMPLATES[id];
    throw new ApiError(404, 'Template not found');
  });
  listActiveUsers.mockResolvedValue([
    person('u-sara', 'Sara', 'Khan'),
    person('u-efraim', 'Efraim', 'Green'),
  ]);
  listDepartments.mockResolvedValue(DEPARTMENTS);
  getDutyHoldings.mockResolvedValue({ 'u-efraim': ['d-listing'] });
  getSetup.mockResolvedValue(emptySetup());
  saveSetup.mockImplementation(async (body) => ({
    settings: body.settings,
    updatedAt: '2026-10-20T14:00:00.000Z',
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Step 1: rows, templates, Save / Cancel --------------------------------------

describe('ExclusivesAlertTasksPage', () => {
  it('lists the twelve alert types, one per row, in order', async () => {
    await renderPage();
    const labels = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelector('.status-pill')?.textContent);
    expect(labels).toEqual(EXCLUSIVES_ALERT_TYPES.map((t) => EXCLUSIVES_ALERT_TYPE_LABELS[t]));
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Alert Type',
      'Template',
      'Role Assignment',
    ]);
  });

  it('offers every template by name, with "— None —" first', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Template for Buy Box Lost:/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '— None —',
      'Listing Suppression Resolution',
      'Plain checklist',
      'Price Review',
      'Price Review v2',
    ]);
  });

  it('Save and Cancel stay off until something changes', async () => {
    await renderPage();
    expect(saveButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();

    await pickTemplate('Listing Suppressed', 'Listing Suppression Resolution');
    expect(saveButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Back to how it was: nothing to save again.
    await pickTemplate('Listing Suppressed', '— None —');
    expect(saveButton()).toBeDisabled();
  });

  it('the same template can go on several alert types', async () => {
    await renderPage();
    await pickTemplate('Buy Box Lost', 'Price Review');
    await pickTemplate('Price Changed', 'Price Review');
    expect(
      within(rowOf('Buy Box Lost')).getByRole('button', { name: /Price Review/ }),
    ).toBeInTheDocument();
    expect(
      within(rowOf('Price Changed')).getByRole('button', { name: /Price Review/ }),
    ).toBeInTheDocument();
  });

  it('Cancel puts back what was saved', async () => {
    await renderPage();
    await pickTemplate('Buy Box Lost', 'Price Review');
    pickPerson('Analyst', 'Buy Box Lost', 'u-sara');
    fireEvent.click(cancelButton());
    expect(
      screen.getByRole('button', { name: 'Template for Buy Box Lost: — None —' }),
    ).toBeVisible();
    expect(within(rowOf('Buy Box Lost')).getByText('Pick a template first')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(saveSetup).not.toHaveBeenCalled();
  });

  it('Save sends every alert type at once, then has nothing left to save', async () => {
    await renderPage();
    await pickTemplate('Listing Suppressed', 'Listing Suppression Resolution');
    fireEvent.click(saveButton());
    await settle();

    expect(saveSetup).toHaveBeenCalledTimes(1);
    const body = saveSetup.mock.calls[0]![0];
    expect(body.expectedUpdatedAt).toBeNull();
    expect(body.settings).toHaveLength(12);
    expect(body.settings[0]).toEqual({
      alertType: 'ListingSuppressed',
      templateId: 1,
      roleAssignments: [],
    });
    expect(body.settings.slice(1).every((s: { templateId: null }) => s.templateId === null)).toBe(
      true,
    );
    expect(screen.getByText('Saved.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('shows what was saved before, and a template that no longer exists', async () => {
    getSetup.mockResolvedValue({
      ...emptySetup(),
      settings: emptySetup().settings.map((s) =>
        s.alertType === 'BuyBoxLost'
          ? { ...s, templateId: 3, roleAssignments: [{ role: 'Analyst', assigneeId: 'u-sara' }] }
          : s.alertType === 'BuyBoxWon'
            ? { ...s, templateId: 99 }
            : s,
      ),
      updatedAt: '2026-10-19T12:00:00.000Z',
    });
    await renderPage();
    expect(
      screen.getByRole('button', { name: 'Template for Buy Box Lost: Price Review' }),
    ).toBeInTheDocument();
    expect(personSelect('Analyst', 'Buy Box Lost').value).toBe('u-sara');
    expect(
      screen.getByRole('button', { name: 'Template for Buy Box Won: Template no longer exists' }),
    ).toBeInTheDocument();
    expect(
      within(rowOf('Buy Box Won')).getByText("Could not load this template's roles."),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('a failed save says so and keeps the changes', async () => {
    saveSetup.mockRejectedValue(new ApiError(409, 'Someone else saved first. Reload to see it.'));
    await renderPage();
    await pickTemplate('Buy Box Lost', 'Price Review');
    fireEvent.click(saveButton());
    await settle();
    expect(screen.getByText('Someone else saved first. Reload to see it.')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('says the setup is not on the server yet', async () => {
    await renderPage();
    expect(screen.getByText(/Not saved to the server yet/)).toBeInTheDocument();
  });

  // --- Step 2: the Role Assignment column ------------------------------------------

  it('asks for a template on rows without one', async () => {
    await renderPage();
    expect(within(rowOf('Buy Box Lost')).getByText('Pick a template first')).toBeInTheDocument();
    await pickTemplate('Buy Box Lost', 'Price Review');
    expect(within(rowOf('Buy Box Lost')).queryByText('Pick a template first')).toBeNull();
  });

  it("lists each of the template's roles with a person dropdown", async () => {
    await renderPage();
    await pickTemplate('Price Changed', 'Price Review');
    const row = within(rowOf('Price Changed'));
    expect(row.getByText('Analyst')).toHaveClass('dd-role-chip');
    expect(row.getByText('Reviewer')).toHaveClass('dd-role-chip');
    expect(row.getAllByText('1 task · needs 0 duties')).toHaveLength(2);

    const select = personSelect('Analyst', 'Price Changed');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '— Leave unassigned —',
      'Efraim Green',
      'Sara Khan',
    ]);
    expect(select.value).toBe('');
    expect(row.getAllByText('Tasks will be unassigned')).toHaveLength(2);
  });

  it('says so when a template has no roles', async () => {
    await renderPage();
    await pickTemplate('Title Changed', 'Plain checklist');
    expect(
      within(rowOf('Title Changed')).getByText('No roles: its tasks will be unassigned'),
    ).toBeInTheDocument();
  });

  it('a person picked for a role is saved with the row', async () => {
    await renderPage();
    await pickTemplate('Price Changed', 'Price Review');
    expect(saveButton()).toBeEnabled();
    pickPerson('Reviewer', 'Price Changed', 'u-sara');
    pickPerson('Analyst', 'Price Changed', 'u-efraim');
    fireEvent.click(saveButton());
    await settle();
    expect(sentFor('PriceChanged')).toEqual({
      alertType: 'PriceChanged',
      templateId: 3,
      roleAssignments: [
        { role: 'Analyst', assigneeId: 'u-efraim' },
        { role: 'Reviewer', assigneeId: 'u-sara' },
      ],
    });
  });

  it('marks someone missing a duty the role needs, and Save waits until it is fixed', async () => {
    await renderPage();
    await pickTemplate('Listing Suppressed', 'Listing Suppression Resolution');
    const row = within(rowOf('Listing Suppressed'));
    expect(row.getByText('1 task · needs 1 duty')).toBeInTheDocument();
    const select = personSelect('Listing Specialist', 'Listing Suppressed');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '— Leave unassigned —',
      'Efraim Green',
      '⚠ Sara Khan',
    ]);

    pickPerson('Listing Specialist', 'Listing Suppressed', 'u-sara');
    expect(row.getByText('⚠ Doesn’t hold E-commerce › Listing management')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute(
      'title',
      'Someone picked can’t fill their role yet: see the ⚠ below',
    );

    pickPerson('Listing Specialist', 'Listing Suppressed', 'u-efraim');
    expect(row.getByText('✓ Holds every duty needed')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('a new template keeps the people for roles of the same name, and drops the rest', async () => {
    await renderPage();
    await pickTemplate('Buy Box Lost', 'Price Review');
    pickPerson('Analyst', 'Buy Box Lost', 'u-sara');
    pickPerson('Reviewer', 'Buy Box Lost', 'u-efraim');

    await pickTemplate('Buy Box Lost', 'Price Review v2');
    expect(personSelect('Analyst', 'Buy Box Lost').value).toBe('u-sara');
    expect(personSelect('Approver', 'Buy Box Lost').value).toBe('');
    expect(screen.queryByRole('combobox', { name: /Person for Reviewer/ })).toBeNull();

    fireEvent.click(saveButton());
    await settle();
    expect(sentFor('BuyBoxLost')).toEqual({
      alertType: 'BuyBoxLost',
      templateId: 4,
      roleAssignments: [{ role: 'Analyst', assigneeId: 'u-sara' }],
    });
  });

  it('flags a saved person who is no longer active', async () => {
    getSetup.mockResolvedValue({
      ...emptySetup(),
      settings: emptySetup().settings.map((s) =>
        s.alertType === 'BrandChanged'
          ? { ...s, templateId: 3, roleAssignments: [{ role: 'Analyst', assigneeId: 'u-gone' }] }
          : s,
      ),
      updatedAt: '2026-10-19T12:00:00.000Z',
    });
    await renderPage();
    const select = personSelect('Analyst', 'Brand Changed');
    expect(select.value).toBe('u-gone');
    expect(select.selectedOptions[0]!.textContent).toBe('A deactivated person');
    expect(
      within(rowOf('Brand Changed')).getByText('⚠ No longer active: pick someone else'),
    ).toBeInTheDocument();

    // Any other change can't be saved until it is fixed.
    await pickTemplate('Title Changed', 'Plain checklist');
    expect(saveButton()).toBeDisabled();
    pickPerson('Analyst', 'Brand Changed', 'u-sara');
    expect(saveButton()).toBeEnabled();
  });

  it('shows the roles are loading until the template answers', async () => {
    let answer: (t: TemplateDto) => void = () => {};
    getTemplate.mockImplementation(() => new Promise<TemplateDto>((r) => (answer = r)));
    await renderPage();
    await pickTemplate('Price Changed', 'Price Review');
    expect(within(rowOf('Price Changed')).getByText('Loading roles…')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await act(async () => answer(TEMPLATES[3]!));
    expect(within(rowOf('Price Changed')).getByText('Analyst')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });
  // --- Step 3: leaving, loading, errors, no templates --------------------------------

  it('asks before leaving with changes not saved, and staying keeps them', async () => {
    await renderPage();
    await pickTemplate('Buy Box Lost', 'Price Review');
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));

    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unsaved changes. Leave this page and discard them?',
    );
    expect(screen.queryByText('Another page')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Template for Buy Box Lost: Price Review' }),
    ).toBeInTheDocument();
  });

  it('leaves without asking when nothing changed, or after Save', async () => {
    await renderPage();
    await pickTemplate('Buy Box Lost', 'Price Review');
    fireEvent.click(saveButton());
    await settle();
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await screen.findByText('Another page')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('shows it is loading until everything has arrived', async () => {
    let answer: (s: ExclusivesAlertTaskSetupDto) => void = () => {};
    getSetup.mockImplementation(
      () => new Promise<ExclusivesAlertTaskSetupDto>((r) => (answer = r)),
    );
    await renderPage();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Listing Suppressed')).toBeNull();

    await act(async () => answer(emptySetup()));
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByText('Listing Suppressed')).toBeInTheDocument();
  });

  it('says when it could not load, and Try again loads it', async () => {
    getSetup.mockRejectedValueOnce(new ApiError(500, 'The server is not answering.'));
    await renderPage();
    expect(screen.getByText('The server is not answering.')).toBeInTheDocument();
    expect(screen.queryByText('Listing Suppressed')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.queryByText('The server is not answering.')).toBeNull();
    expect(screen.getByText('Listing Suppressed')).toBeInTheDocument();
  });

  it('with no templates yet, points to the Templates page', async () => {
    listTemplates.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText(/There are no templates yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Templates' }));
    expect(await screen.findByText('The Templates page')).toBeInTheDocument();
  });
});
