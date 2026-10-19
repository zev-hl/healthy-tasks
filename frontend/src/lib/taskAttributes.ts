import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  TASK_ATTRIBUTE_KEYS,
  TASK_ATTRIBUTE_LABELS,
  type ExclusivesAlertType,
  type TaskAlertGroupRef,
  type TaskAttributeKey,
  type TaskSearchFilters,
} from '@healthy-tasks/shared';

/**
 * A task's special attributes (HLAI-118) for display: the task page's
 * attribute line, and the task list's Attributes column and its "+" window.
 */
export interface TaskAttributeValues {
  alertGroup: TaskAlertGroupRef | null;
  alertType: ExclusivesAlertType | null;
}

/** The value of one attribute as text, or null when it is not set. */
export function taskAttributeText(key: TaskAttributeKey, task: TaskAttributeValues): string | null {
  switch (key) {
    case 'alertGroup':
      return task.alertGroup?.name ?? null;
    case 'alertType':
      return task.alertType ? EXCLUSIVES_ALERT_TYPE_LABELS[task.alertType] : null;
  }
}

/** Every attribute in display order, with its label and value (null = not set). */
export function taskAttributeList(
  task: TaskAttributeValues,
): { key: TaskAttributeKey; label: string; value: string | null }[] {
  return TASK_ATTRIBUTE_KEYS.map((key) => ({
    key,
    label: TASK_ATTRIBUTE_LABELS[key],
    value: taskAttributeText(key, task),
  }));
}

// --- The task list's attribute filter ----------------------------------------
// Per attribute, a ticked list of its values plus "(not set)"; any mix of them
// (none, some or all) is allowed. These map that list onto TaskSearchFilters.

/** The "(not set)" option's value in an attribute's ticked list. */
export const NOT_SET = '__not_set__';

/** The ticked values of one attribute's filter, "(not set)" first when ticked. */
export function attributeFilterSelected(key: TaskAttributeKey, f: TaskSearchFilters): string[] {
  switch (key) {
    case 'alertGroup':
      return [...(f.includeNoAlertGroup ? [NOT_SET] : []), ...(f.alertGroupIds ?? []).map(String)];
    case 'alertType':
      return [...(f.includeNoAlertType ? [NOT_SET] : []), ...(f.alertTypes ?? [])];
  }
}

/** The filter change for ticking exactly these values of one attribute. */
export function attributeFilterPatch(
  key: TaskAttributeKey,
  values: string[],
): Partial<TaskSearchFilters> {
  const notSet = values.includes(NOT_SET) ? true : undefined;
  const picked = values.filter((v) => v !== NOT_SET);
  switch (key) {
    case 'alertGroup':
      return { alertGroupIds: picked.map(Number), includeNoAlertGroup: notSet };
    case 'alertType':
      return { alertTypes: picked as ExclusivesAlertType[], includeNoAlertType: notSet };
  }
}

/** The filter change that removes one attribute's filter. */
export function attributeFilterCleared(key: TaskAttributeKey): Partial<TaskSearchFilters> {
  return attributeFilterPatch(key, []);
}

/** One chip per attribute with a filter on it: "Alert Type · 3". */
export function attributeFilterChips(
  f: TaskSearchFilters,
): { key: TaskAttributeKey; label: string }[] {
  return TASK_ATTRIBUTE_KEYS.flatMap((key) => {
    const count = attributeFilterSelected(key, f).length;
    return count > 0 ? [{ key, label: `${TASK_ATTRIBUTE_LABELS[key]} · ${count}` }] : [];
  });
}
