import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import {
  MERGE_FIELDS,
  ROLES,
  type CreateUserRequest,
  type EmailChangeSummary,
  type MergeField,
  type MergeFieldChoices,
  type MergeUsersRequest,
  type Role,
  type UpdateUserRequest,
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { confirmDiscard, useUnsavedChangesWarning } from '../../lib/useUnsavedChangesWarning';
import { Avatar, userLabel } from '../ui/Avatar';
import { Btn, Card, Segmented, cx } from '../harbor/ui';
import { Select, type SelectOption } from '../harbor/Select';

/**
 * The Users screen's side panels (Harbor: no pop-ups): add a user, edit one,
 * and merge two accounts. Each sits beside the table and keeps the same rules
 * the dialogs had — buttons wait for a change, and leaving with typed work asks
 * first.
 */

const ROLE_HINT: Record<Role, string> = {
  Member: 'Works on their own tasks',
  Manager: 'Can supervise people',
  Admin: 'Manages everything',
};

/** The shell every panel shares: a title row with ×, a body, and a footer. */
function Panel({
  eyebrow,
  title,
  lead,
  onClose,
  footer,
  children,
  label,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <Card className="hb-gpanel hb-upanel">
      <section aria-label={label}>
        <div className="hb-gpanel-head">
          {lead}
          <div className="hb-stack">
            <span className="hb-gpanel-eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="hb-icon-btn hb-icon-btn-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="hb-gpanel-body">{children}</div>
        <div className="hb-gpanel-foot">{footer}</div>
      </section>
    </Card>
  );
}

function supervisorOptions(list: UserDto[], exceptId?: string): SelectOption<string>[] {
  return [
    { value: '', label: 'None' },
    ...list
      .filter((s) => s.id !== exceptId)
      .map((s) => ({
        value: s.id,
        label: userLabel(s),
        hint: s.role,
        lead: <Avatar user={s} size="xs" decorative />,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

function RoleField({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="hb-tpl-field">
      <span className="hb-tpl-flabel">Role</span>
      <Segmented
        label="Role"
        value={value}
        options={ROLES.map((r) => ({ value: r, label: r }))}
        onChange={onChange}
      />
      <span className="hb-org-note">{ROLE_HINT[value]}.</span>
    </div>
  );
}

/** One labelled text input (the label is the input's accessible name). */
function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  required,
  wide,
  area,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  wide?: boolean;
  area?: boolean;
}) {
  return (
    <label className={cx('hb-tpl-field', wide && 'is-wide')} htmlFor={id}>
      <span className="hb-tpl-flabel">{label}</span>
      {area ? (
        <textarea
          id={id}
          className="hb-tpl-input"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="hb-tpl-input"
          type={type}
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

// --- Add a user -------------------------------------------------------------

/** Create a user. Supervisors are active Managers and Admins (checked again server-side). */
export function UserCreatePanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Reports how the new person signs in, so the caller can say the right thing. */
  onCreated: (signInMethod: 'google' | 'password') => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<Role>('Member');
  const [title, setTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [supervisors, setSupervisors] = useState<UserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Unsaved-work guard: once anything is filled in, Cancel, × and leaving the
  // page all ask first.
  const dirty =
    [email, firstName, lastName, title, jobDescription, supervisorId].some(
      (v) => v.trim() !== '',
    ) || role !== 'Member';
  useUnsavedChangesWarning(dirty && !submitting);
  const dismiss = () => {
    if (confirmDiscard(dirty)) onClose();
  };

  useEffect(() => {
    api
      .listSupervisors()
      .then(setSupervisors)
      .catch(() => setSupervisors([]));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return; // nothing filled in yet
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    setSubmitting(true);
    const body: CreateUserRequest = {
      email,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role,
      title: title || null,
      jobDescription: jobDescription || null,
      supervisorId: supervisorId || null,
    };
    try {
      const res = await api.createUser(body);
      onCreated(res.signInMethod);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Panel
        label="Add user"
        eyebrow="New account"
        title="Add user"
        onClose={dismiss}
        footer={
          <>
            <Btn kind="ghost" onClick={dismiss}>
              Cancel
            </Btn>
            <button
              type="submit"
              className="hb-btn hb-btn-primary"
              disabled={submitting || !dirty}
              title={dirty ? undefined : 'Nothing has changed yet'}
            >
              {submitting ? 'Creating…' : 'Create user'}
            </button>
          </>
        }
      >
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <TextField
          id="new-email"
          label="Email (login id)"
          type="email"
          value={email}
          onChange={setEmail}
          required
        />
        <div className="hb-upanel-two">
          <TextField
            id="new-first-name"
            label="First name"
            value={firstName}
            onChange={setFirstName}
            required
          />
          <TextField
            id="new-last-name"
            label="Last name"
            value={lastName}
            onChange={setLastName}
            required
          />
        </div>
        <RoleField value={role} onChange={setRole} />
        <TextField id="new-title" label="Title" value={title} onChange={setTitle} />
        <div className="hb-tpl-field">
          <span className="hb-tpl-flabel">Supervisor</span>
          <Select
            label="Supervisor"
            value={supervisorId}
            options={supervisorOptions(supervisors)}
            searchPlaceholder="Search people…"
            onChange={setSupervisorId}
          />
          <span className="hb-org-note">Only Managers and Admins can be supervisors.</span>
        </div>
        <TextField
          id="new-job"
          label="Job description"
          value={jobDescription}
          onChange={setJobDescription}
          area
        />
        <p className="hb-org-note">
          They get a welcome email: company addresses sign in with Google, others get a link to set
          a password.
        </p>
      </Panel>
    </form>
  );
}

// --- Edit a user ----------------------------------------------------------------

/**
 * What the admin is told after saving. A changed sign-in address emails both
 * addresses (see the server's account-emails.ts), so say who was told what.
 */
export function savedMessage(email: string, change?: EmailChangeSummary): string {
  if (!change) return `Saved changes to ${email}.`;
  const { from, to } = change;
  if (change.inactive) {
    return (
      `Saved. Both ${to} and ${from} were emailed about the new sign-in address. ` +
      'The account is inactive, so they can sign in once it is reactivated.'
    );
  }
  if (change.resetLink) {
    return (
      `Saved. ${to} was emailed a link to set a password (it is also shown below, in case ` +
      `the email does not arrive), and ${from} was told about the change.`
    );
  }
  if (change.signInMethod === 'google') {
    return `Saved. ${to} was emailed to sign in with Google from now on, and ${from} was told about the change.`;
  }
  return (
    `Saved. ${to} was emailed that their sign-in address changed (their password stays ` +
    `the same), and ${from} was told about the change.`
  );
}

/**
 * Edit a user. "Save changes" waits until a field differs, sends only the
 * changed fields, and closes on success; on error it stays and says why.
 */
export function UserEditPanel({
  user,
  supervisors,
  onClose,
  onSaved,
}: {
  user: UserDto;
  /** Eligible supervisors (active Managers/Admins). */
  supervisors: UserDto[];
  onClose: () => void;
  /** `resetLink`: the set-password link, when the new address needs a password. */
  onSaved: (message: string, resetLink?: string) => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [role, setRole] = useState<Role>(user.role);
  const [title, setTitle] = useState(user.title ?? '');
  const [jobDescription, setJobDescription] = useState(user.jobDescription ?? '');
  const [supervisorId, setSupervisorId] = useState(user.supervisorId ?? '');
  const [isActive, setIsActive] = useState(user.isActive);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function buildPatch(): UpdateUserRequest {
    const patch: UpdateUserRequest = {};
    if (email.trim() !== user.email) patch.email = email.trim();
    if (firstName.trim() !== user.firstName) patch.firstName = firstName.trim();
    if (lastName.trim() !== user.lastName) patch.lastName = lastName.trim();
    if (role !== user.role) patch.role = role;
    if ((title.trim() || null) !== (user.title ?? null)) patch.title = title.trim() || null;
    if ((jobDescription.trim() || null) !== (user.jobDescription ?? null))
      patch.jobDescription = jobDescription.trim() || null;
    if ((supervisorId || null) !== (user.supervisorId ?? null))
      patch.supervisorId = supervisorId || null;
    if (isActive !== user.isActive) patch.isActive = isActive;
    return patch;
  }

  const patch = buildPatch();
  const dirty = Object.keys(patch).length > 0;

  // Unsaved-work guard: with changes pending, Cancel, × and leaving the page all ask first.
  useUnsavedChangesWarning(dirty && !saving);
  const dismiss = () => {
    if (confirmDiscard(dirty)) onClose();
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.updateUser(user.id, patch);
      onSaved(savedMessage(saved.email, saved.emailChange), saved.emailChange?.resetLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  const emailChanged = email.trim() !== user.email;

  return (
    <form onSubmit={onSubmit}>
      <Panel
        label="Edit user"
        eyebrow={user.email}
        title={userLabel(user)}
        lead={<Avatar user={user} px={40} decorative />}
        onClose={dismiss}
        footer={
          <>
            <Btn kind="ghost" onClick={dismiss}>
              Cancel
            </Btn>
            <button type="submit" className="hb-btn hb-btn-primary" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <TextField
          id="edit-email"
          label="Email (login id)"
          type="email"
          value={email}
          onChange={setEmail}
          required
        />
        {emailChanged && (
          <span className="hb-org-note">
            Both addresses are emailed, and they are signed out everywhere until they sign in with
            the new one.
          </span>
        )}
        <div className="hb-upanel-two">
          <TextField
            id="edit-first"
            label="First name"
            value={firstName}
            onChange={setFirstName}
            required
          />
          <TextField
            id="edit-last"
            label="Last name"
            value={lastName}
            onChange={setLastName}
            required
          />
        </div>
        <RoleField value={role} onChange={setRole} />
        <TextField id="edit-title" label="Title" value={title} onChange={setTitle} />
        <div className="hb-tpl-field">
          <span className="hb-tpl-flabel">Supervisor</span>
          <Select
            label="Supervisor"
            value={supervisorId}
            options={supervisorOptions(supervisors, user.id)}
            searchPlaceholder="Search people…"
            onChange={setSupervisorId}
          />
          <span className="hb-org-note">Only Managers and Admins can be supervisors.</span>
        </div>
        <TextField
          id="edit-job"
          label="Job description"
          value={jobDescription}
          onChange={setJobDescription}
          area
        />
        <div className="hb-tpl-field">
          <span className="hb-tpl-flabel">Status</span>
          <Segmented
            label="Status"
            value={isActive ? 'active' : 'inactive'}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Deactivated' },
            ]}
            onChange={(v) => setIsActive(v === 'active')}
          />
          {!isActive && user.isActive && (
            <span className="hb-org-note is-warn">
              They are signed out at once and can’t sign in until reactivated. Their tasks and
              history stay.
            </span>
          )}
        </div>
      </Panel>
    </form>
  );
}

// --- Merge two accounts -------------------------------------------------------------

const FIELD_LABELS: Record<MergeField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  title: 'Title',
  jobDescription: 'Job description',
  role: 'Role',
  supervisorId: 'Supervisor',
};

/** Which account's value to keep for a differing field. */
type Side = 'survivor' | 'other';

/**
 * Merge two accounts that are the same person, in three steps: pick both,
 * pick which one stays (and which value to keep where they differ), then type
 * the other address to confirm. Hard to reverse, so the button stays off
 * until all three are done.
 */
export function MergeUsersPanel({
  users,
  onClose,
  onMerged,
}: {
  users: UserDto[];
  onClose: () => void;
  onMerged: (message: string) => void;
}) {
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  // Only non-merged accounts can take part in a merge.
  const selectable = useMemo(() => users.filter((u) => u.mergedIntoId === null), [users]);

  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [survivorSide, setSurvivorSide] = useState<'A' | 'B'>('A');
  const [choices, setChoices] = useState<Record<MergeField, Side>>(
    () => Object.fromEntries(MERGE_FIELDS.map((f) => [f, 'survivor'])) as Record<MergeField, Side>,
  );
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const a = aId ? usersById.get(aId) : undefined;
  const b = bId ? usersById.get(bId) : undefined;
  const survivor = survivorSide === 'A' ? a : b;
  const merged = survivorSide === 'A' ? b : a;
  const bothChosen = Boolean(a && b && aId !== bId);

  function rawValue(user: UserDto, field: MergeField): string | null {
    const v = user[field];
    return v === undefined ? null : (v as string | null);
  }
  function displayValue(user: UserDto, field: MergeField): string {
    const v = rawValue(user, field);
    if (field === 'supervisorId') {
      const s = v ? usersById.get(v) : undefined;
      return v ? (s ? userLabel(s) : '(unknown)') : 'None';
    }
    return v && v !== '' ? v : '—';
  }

  const differingFields = useMemo<MergeField[]>(() => {
    if (!bothChosen || !survivor || !merged) return [];
    return MERGE_FIELDS.filter((f) => rawValue(a!, f) !== rawValue(b!, f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothChosen, survivor, merged, a, b]);

  function chosenValue(field: MergeField): string | null {
    if (!survivor || !merged) return null;
    const side = choices[field];
    const isDifferent = differingFields.includes(field);
    const source = isDifferent && side === 'other' ? merged : survivor;
    return rawValue(source, field);
  }
  function buildFieldChoices(): MergeFieldChoices {
    return {
      firstName: (chosenValue('firstName') ?? '') as string,
      lastName: (chosenValue('lastName') ?? '') as string,
      title: chosenValue('title'),
      jobDescription: chosenValue('jobDescription'),
      role: (chosenValue('role') ?? survivor!.role) as Role,
      supervisorId: chosenValue('supervisorId'),
    };
  }

  const confirmMatches =
    Boolean(merged) && confirm.trim().toLowerCase() === merged!.email.toLowerCase();
  const survivorActive = Boolean(survivor?.isActive);
  const canMerge = bothChosen && survivorActive && confirmMatches && !submitting;
  const dirty = !!aId || !!bId;
  const dismiss = () => {
    if (confirmDiscard(dirty)) onClose();
  };

  async function handleMerge() {
    if (!survivor || !merged) return;
    setError(null);
    setSubmitting(true);
    const body: MergeUsersRequest = {
      survivingId: survivor.id,
      mergedId: merged.id,
      confirmEmail: confirm.trim().toLowerCase(),
      fieldChoices: buildFieldChoices(),
    };
    try {
      await api.mergeUsers(body);
      onMerged(`Merged ${merged.email} into ${survivor.email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Merge failed');
    } finally {
      setSubmitting(false);
    }
  }

  const accountOptions = (except: string): SelectOption<string>[] =>
    selectable
      .filter((u) => u.id !== except)
      .map((u) => ({
        value: u.id,
        label: userLabel(u),
        hint: `${u.email}${u.isActive ? '' : ' · inactive'}`,
        lead: <Avatar user={u} size="xs" decorative />,
      }))
      .sort((x, y) => x.label.localeCompare(y.label));

  const accountCard = (u: UserDto, side: 'A' | 'B') => {
    const on = survivorSide === side;
    return (
      <button
        type="button"
        className={cx('hb-merge-card', on && 'is-on')}
        aria-pressed={on}
        onClick={() => setSurvivorSide(side)}
      >
        <Avatar user={u} px={32} decorative />
        <span className="hb-stack">
          <b>{userLabel(u)}</b>
          <span className="hb-sub">{u.email}</span>
          {!u.isActive && <span className="hb-sub late">Inactive</span>}
        </span>
        <span className="hb-merge-tag">{on ? 'Stays' : 'Merged in'}</span>
      </button>
    );
  };

  return (
    <Panel
      label="Merge accounts"
      eyebrow="Two accounts, one person"
      title="Merge accounts"
      onClose={dismiss}
      footer={
        <>
          <Btn kind="ghost" onClick={dismiss}>
            Cancel
          </Btn>
          <Btn kind="danger" disabled={!canMerge} onClick={() => void handleMerge()}>
            {submitting ? 'Merging…' : 'Merge accounts'}
          </Btn>
        </>
      }
    >
      <div className="hb-gnote is-warn">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>
          Tasks, comments, mentions, attachments and history move to the account that stays; the
          people it supervised are moved too. The other account is deactivated and marked merged.
          This is hard to undo.
        </span>
      </div>
      {error && (
        <div className="hb-alert" role="alert">
          {error}
        </div>
      )}

      <div className="hb-gstep">
        <span className="hb-gstep-n">1</span>
        <div className="hb-gstep-grid two">
          <div className="hb-tpl-field">
            <span className="hb-tpl-flabel">Account 1</span>
            <Select
              label="Account 1"
              value={aId || null}
              placeholder="Choose…"
              options={accountOptions(bId)}
              searchPlaceholder="Search people…"
              onChange={setAId}
            />
          </div>
          <div className="hb-tpl-field">
            <span className="hb-tpl-flabel">Account 2</span>
            <Select
              label="Account 2"
              value={bId || null}
              placeholder="Choose…"
              options={accountOptions(aId)}
              searchPlaceholder="Search people…"
              onChange={setBId}
            />
          </div>
        </div>
      </div>

      {bothChosen && a && b && (
        <>
          <div className="hb-gstep">
            <span className="hb-gstep-n">2</span>
            <div className="hb-tpl-field">
              <span className="hb-tpl-flabel">Which account stays?</span>
              <div className="hb-merge-cards">
                {accountCard(a, 'A')}
                {accountCard(b, 'B')}
              </div>
              {!survivorActive && (
                <span className="hb-org-note is-bad">
                  The account that stays must be active. Pick the active one.
                </span>
              )}
              {differingFields.length > 0 ? (
                <div className="hb-merge-fields">
                  <span className="hb-tpl-flabel">Where they differ, keep…</span>
                  {differingFields.map((f) => (
                    <div key={f} className="hb-merge-field">
                      <span className="hb-merge-fname">{FIELD_LABELS[f]}</span>
                      <Segmented
                        small
                        label={FIELD_LABELS[f]}
                        value={choices[f]}
                        options={[
                          { value: 'survivor', label: displayValue(survivor!, f) },
                          { value: 'other', label: displayValue(merged!, f) },
                        ]}
                        onChange={(v) => setChoices((c) => ({ ...c, [f]: v }))}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <span className="hb-org-note">
                  <Check size={13} aria-hidden="true" /> Their profile details are the same —
                  nothing to choose.
                </span>
              )}
            </div>
          </div>

          <div className="hb-gstep">
            <span className="hb-gstep-n">3</span>
            <label className="hb-tpl-field" htmlFor="merge-confirm">
              <span className="hb-tpl-flabel">
                Type <strong>{merged?.email}</strong> to confirm
              </span>
              <input
                id="merge-confirm"
                className="hb-tpl-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={merged?.email}
                autoComplete="off"
              />
              {merged && survivor && (
                <span className="hb-org-note">
                  {merged.email} <ArrowRight size={12} aria-hidden="true" /> {survivor.email}
                </span>
              )}
            </label>
          </div>
        </>
      )}
    </Panel>
  );
}
