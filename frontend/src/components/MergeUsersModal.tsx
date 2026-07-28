import { useMemo, useState } from 'react';
import {
  MERGE_FIELDS,
  type MergeField,
  type MergeFieldChoices,
  type MergeUsersRequest,
  type Role,
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

interface Props {
  users: UserDto[];
  onClose: () => void;
  onMerged: (message: string) => void;
}

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

export function MergeUsersModal({ users, onClose, onMerged }: Props) {
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  // Only non-merged accounts can participate in a merge.
  const selectable = useMemo(() => users.filter((u) => u.mergedIntoId === null), [users]);

  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [survivorSide, setSurvivorSide] = useState<'A' | 'B'>('A');
  const [choices, setChoices] = useState<Record<MergeField, Side>>(() =>
    Object.fromEntries(MERGE_FIELDS.map((f) => [f, 'survivor'])) as Record<MergeField, Side>,
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
      return v ? (usersById.get(v)?.email ?? '(unknown)') : '— None —';
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

  const userLabel = (u: UserDto) =>
    `${u.email}${u.firstName || u.lastName ? ` — ${u.firstName} ${u.lastName}`.trimEnd() : ''}${u.isActive ? '' : ' (inactive)'}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Merge accounts</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Combine two accounts that represent the same person. All tasks, comments, mentions,
          attachments, and history from the non-surviving account move to the survivor; supervisees
          are repointed; the non-surviving account is deactivated and flagged as merged. This is hard
          to reverse.
        </p>

        {error && <div className="alert error">{error}</div>}

        <div style={{ display: 'flex', gap: '1rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="merge-a">Account 1</label>
            <select id="merge-a" value={aId} onChange={(e) => setAId(e.target.value)}>
              <option value="">— Select —</option>
              {selectable
                .filter((u) => u.id !== bId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="merge-b">Account 2</label>
            <select id="merge-b" value={bId} onChange={(e) => setBId(e.target.value)}>
              <option value="">— Select —</option>
              {selectable
                .filter((u) => u.id !== aId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {bothChosen && a && b && (
          <>
            <div className="field">
              <label>Which account survives?</label>
              <div className="btn-row" style={{ marginTop: '0.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="radio"
                    name="survivor"
                    checked={survivorSide === 'A'}
                    onChange={() => setSurvivorSide('A')}
                  />
                  {a.email}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="radio"
                    name="survivor"
                    checked={survivorSide === 'B'}
                    onChange={() => setSurvivorSide('B')}
                  />
                  {b.email}
                </label>
              </div>
              {!survivorActive && (
                <p className="alert error" style={{ marginTop: '0.5rem' }}>
                  The surviving account must be active. Pick the active account as the survivor.
                </p>
              )}
            </div>

            {differingFields.length > 0 ? (
              <div className="field">
                <label>Resolve differing profile fields</label>
                <table className="merge-fields">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Keep survivor’s</th>
                      <th>Use other’s</th>
                    </tr>
                  </thead>
                  <tbody>
                    {differingFields.map((f) => (
                      <tr key={f}>
                        <td>{FIELD_LABELS[f]}</td>
                        <td>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <input
                              type="radio"
                              name={`field-${f}`}
                              checked={choices[f] === 'survivor'}
                              onChange={() => setChoices((c) => ({ ...c, [f]: 'survivor' }))}
                            />
                            {displayValue(survivor!, f)}
                          </label>
                        </td>
                        <td>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <input
                              type="radio"
                              name={`field-${f}`}
                              checked={choices[f] === 'other'}
                              onChange={() => setChoices((c) => ({ ...c, [f]: 'other' }))}
                            />
                            {displayValue(merged!, f)}
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">The two accounts have identical profile fields — nothing to resolve.</p>
            )}

            <div className="field">
              <label htmlFor="merge-confirm">
                Type <strong>{merged?.email}</strong> to confirm this merge
              </label>
              <input
                id="merge-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={merged?.email}
                autoComplete="off"
              />
            </div>
          </>
        )}

        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="danger" disabled={!canMerge} onClick={handleMerge}>
            {submitting ? 'Merging…' : 'Merge accounts'}
          </button>
        </div>
      </div>
    </div>
  );
}
