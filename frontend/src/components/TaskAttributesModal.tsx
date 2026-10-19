import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  TASK_ATTRIBUTE_KEYS,
  TASK_ATTRIBUTE_LABELS,
  type ExclusivesAlertType,
  type ExclusivesGroupOptionDto,
  type TaskAttributeKey,
  type TaskDetailDto,
  type UpdateTaskRequest,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useBackdropDismiss } from '../lib/useBackdropDismiss';
import { SearchSelect, type SearchSelectOption } from './SearchSelect';

interface Props {
  task: TaskDetailDto;
  onClose: () => void;
  /** The task as saved, after Save. */
  onSaved: (task: TaskDetailDto) => void;
}

const UNSAVED_MESSAGE = 'You have unsaved changes. Leave this page and discard them?';

const ALERT_TYPE_OPTIONS: SearchSelectOption[] = EXCLUSIVES_ALERT_TYPES.map((t) => ({
  value: t,
  label: EXCLUSIVES_ALERT_TYPE_LABELS[t],
}));

/**
 * The pop-up behind the attributes pencil (HLAI-118): each attribute with a
 * dropdown that can be searched. The picks are held here until Save, which
 * sends the changed ones in one request and closes; Cancel closes it without
 * saving anything. Escape or a click outside close it without saving too; if a
 * pick had changed, the browser asks first: OK closes it, and Cancel keeps it
 * open with the picks, ready to Save.
 */
export function TaskAttributesModal({ task, onClose, onSaved }: Props) {
  const [groups, setGroups] = useState<ExclusivesGroupOptionDto[] | null>(null);
  // The picks, not saved until Save.
  const savedGroupId = task.alertGroup ? String(task.alertGroup.id) : null;
  const [groupId, setGroupId] = useState<string | null>(savedGroupId);
  const [alertType, setAlertType] = useState<ExclusivesAlertType | null>(task.alertType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listExclusivesGroupOptions()
      .then((g) => alive && setGroups(g))
      .catch(() => {
        if (!alive) return;
        setGroups([]);
        setError('Could not load the Alert Groups.');
      });
    return () => {
      alive = false;
    };
  }, []);

  // The task's own group, if an Admin has switched it off (now or since the
  // task was loaded): it stays the current value, but cannot be picked again.
  const own = task.alertGroup;
  const ownInactive =
    own !== null && (!own.isActive || groups?.find((g) => g.id === own.id)?.isActive === false);

  // Only active groups are offered.
  const groupOptions = useMemo<SearchSelectOption[]>(() => {
    const list = (groups ?? [])
      .filter((g) => g.isActive)
      .map((g) => ({ value: String(g.id), label: g.name }));
    // The task's own group stays choosable even if the list has not caught up.
    if (own && !ownInactive && !list.some((o) => o.value === String(own.id))) {
      list.unshift({ value: String(own.id), label: own.name });
    }
    return list;
  }, [groups, own, ownInactive]);

  // Only what differs from the task is sent.
  const changes: UpdateTaskRequest = {
    ...(groupId !== savedGroupId && { alertGroupId: groupId === null ? null : Number(groupId) }),
    ...(alertType !== task.alertType && { alertType }),
  };
  const dirty = Object.keys(changes).length > 0;

  /** Escape or a click outside: close, first asking when picks are not saved. */
  const dismiss = useCallback(() => {
    if (dirty && !window.confirm(UNSAVED_MESSAGE)) return; // Cancel: keep the picks
    onClose();
  }, [dirty, onClose]);
  const backdrop = useBackdropDismiss(dismiss);

  // An open dropdown takes Escape first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateTask(task.id, changes));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the attributes.');
      setSaving(false);
    }
  }

  function field(key: TaskAttributeKey) {
    const label = TASK_ATTRIBUTE_LABELS[key];
    if (key === 'alertGroup') {
      return (
        <SearchSelect
          label={label}
          options={groupOptions}
          value={groupId}
          valueLabel={own && ownInactive ? `${own.name} (inactive)` : undefined}
          disabled={groups === null || saving}
          onChange={setGroupId}
        />
      );
    }
    return (
      <SearchSelect
        label={label}
        options={ALERT_TYPE_OPTIONS}
        value={alertType}
        disabled={saving}
        onChange={(v) => setAlertType(v as ExclusivesAlertType | null)}
      />
    );
  }

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div
        className="modal task-attrs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-attrs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="task-attrs-title" style={{ marginTop: 0 }}>
          Attributes
        </h3>
        {error && <div className="alert error">{error}</div>}
        {TASK_ATTRIBUTE_KEYS.map((key) => (
          <div key={key} className="field">
            <span className="task-attrs-field-label">{TASK_ATTRIBUTE_LABELS[key]}</span>
            {field(key)}
          </div>
        ))}
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
