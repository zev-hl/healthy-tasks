import { useMemo } from 'react';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  TASK_ATTRIBUTE_LABELS,
  type ExclusivesGroupOptionDto,
  type TaskAlertGroupRef,
} from '@healthy-tasks/shared';
import { Select, type SelectOption } from './harbor/Select';
import { InactiveIcon } from './exclusives/icons';

/**
 * The task's special attributes (HLAI-118) for someone who can edit the task:
 * two chips under the property row, each a searchable Harbor dropdown. Like
 * the other chips, a pick is staged and saved with the page's one Save bar
 * (brief §6.3), so there is no separate pop-up. A group an Admin has switched
 * off stays the value, with the red "inactive" mark, but can't be picked again.
 */
export function TaskAttributeChips({
  savedGroup,
  groups,
  groupId,
  onGroup,
  alertType,
  onType,
  savedType,
}: {
  /** The task's group as saved (shown even when it's inactive). */
  savedGroup: TaskAlertGroupRef | null;
  /** Every group (null while loading). */
  groups: ExclusivesGroupOptionDto[] | null;
  /** Staged group id, '' for not set. */
  groupId: string;
  onGroup: (id: string) => void;
  /** Staged alert type, '' for not set. */
  alertType: string;
  onType: (t: string) => void;
  savedType: string;
}) {
  const ownInactive =
    savedGroup !== null &&
    (!savedGroup.isActive || groups?.find((g) => g.id === savedGroup.id)?.isActive === false);

  const groupOptions = useMemo<SelectOption<string>[]>(() => {
    const list = (groups ?? [])
      .filter((g) => g.isActive)
      .map((g) => ({ value: String(g.id), label: g.name }));
    if (savedGroup && !ownInactive && !list.some((o) => o.value === String(savedGroup.id))) {
      list.unshift({ value: String(savedGroup.id), label: savedGroup.name });
    }
    return [{ value: '', label: 'Not set' }, ...list];
  }, [groups, savedGroup, ownInactive]);

  const typeOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: '', label: 'Not set' },
      ...EXCLUSIVES_ALERT_TYPES.map((t) => ({ value: t, label: EXCLUSIVES_ALERT_TYPE_LABELS[t] })),
    ],
    [],
  );

  // The saved group, switched off: still the value, not among the choices.
  const showingInactive = ownInactive && groupId === String(savedGroup?.id);

  return (
    <div className="hb-attrs" role="group" aria-label="Attributes">
      <Select
        variant="chip"
        label={TASK_ATTRIBUTE_LABELS.alertGroup}
        className={`hb-attr${groupId !== String(savedGroup?.id ?? '') ? ' is-dirty' : ''}${groupId ? ' is-set' : ''}`}
        value={groupId}
        options={groupOptions}
        disabled={groups === null}
        searchPlaceholder="Search groups…"
        renderValue={(o) =>
          showingInactive && savedGroup ? (
            <>
              <span
                className="task-attr-inactive"
                role="img"
                aria-label="Inactive group"
                title="Inactive — this group is switched off"
              >
                <InactiveIcon size={14} />
              </span>
              {savedGroup.name}
            </>
          ) : (
            (o?.label ?? 'Not set')
          )
        }
        onChange={onGroup}
      />
      <Select
        variant="chip"
        label={TASK_ATTRIBUTE_LABELS.alertType}
        className={`hb-attr${alertType !== savedType ? ' is-dirty' : ''}${alertType ? ' is-set' : ''}`}
        value={alertType}
        options={typeOptions}
        searchPlaceholder="Search alert types…"
        onChange={onType}
      />
    </div>
  );
}
