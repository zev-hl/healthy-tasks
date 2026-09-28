import type { AlertLog } from '@prisma/client';
import type {
  ExclusivesAlertRowDto,
  ExclusivesAlertType,
  ExclusivesMarketplace,
} from '@healthy-tasks/shared';

/**
 * The alert row is already denormalized (asin, title, marketplace and group
 * name are copied onto it when the alert is written), so this is a straight
 * projection — no joins, and nothing to look up.
 */
export function toExclusivesAlertRowDto(alert: AlertLog): ExclusivesAlertRowDto {
  return {
    id: alert.id,
    groupId: alert.groupId,
    groupName: alert.groupName,
    listingId: alert.listingId,
    asin: alert.asin,
    marketplace: alert.marketplace as ExclusivesMarketplace,
    title: alert.title,
    alertType: alert.alertType as ExclusivesAlertType,
    category: alert.category,
    message: alert.message,
    previousValue: alert.previousValue,
    newValue: alert.newValue,
    createdAt: alert.createdAt.toISOString(),
  };
}
