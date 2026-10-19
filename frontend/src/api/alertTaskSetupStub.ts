import {
  EXCLUSIVES_ALERT_TYPES,
  type ExclusivesAlertTaskSetupDto,
  type SaveExclusivesAlertTaskSetupRequest,
} from '@healthy-tasks/shared';

/**
 * HLAI-112, built screen first: a stand-in for the server's Alert Tasks
 * endpoints until that part exists. It answers in the real shape, but keeps the
 * setup in this tab's memory, so it lasts until the page is reloaded. When the
 * endpoints arrive, `api` calls them instead and this file goes.
 */
export const ALERT_TASK_SETUP_IS_STUB = true;

let stored: ExclusivesAlertTaskSetupDto = {
  settings: EXCLUSIVES_ALERT_TYPES.map((alertType) => ({
    alertType,
    templateId: null,
    roleAssignments: [],
  })),
  updatedAt: null,
};

/** A copy, so the screen can never change what is "saved" without saving. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function getAlertTaskSetupStub(): Promise<ExclusivesAlertTaskSetupDto> {
  return copy(stored);
}

export async function saveAlertTaskSetupStub(
  body: SaveExclusivesAlertTaskSetupRequest,
): Promise<ExclusivesAlertTaskSetupDto> {
  stored = { settings: copy(body.settings), updatedAt: new Date().toISOString() };
  return copy(stored);
}
