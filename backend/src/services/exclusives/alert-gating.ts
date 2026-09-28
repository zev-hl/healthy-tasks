import type { ExclusivesAlertMode, ExclusivesAlertType } from '@healthy-tasks/shared';

export type AlertSettingsMap = Partial<Record<ExclusivesAlertType, ExclusivesAlertMode>>;

// In Phase 1 both `daily` and `immediate` mean "on"; `off` (or a missing
// setting) means the group isn't watching that alert type.
export const isAlertOn = (mode: ExclusivesAlertMode | undefined): boolean =>
  mode === 'daily' || mode === 'immediate';

// Keep only the alerts the watching group has switched on.
export function gateAlerts<T extends { alertType: ExclusivesAlertType }>(
  alerts: T[],
  settings: AlertSettingsMap,
): T[] {
  return alerts.filter((a) => isAlertOn(settings[a.alertType]));
}
