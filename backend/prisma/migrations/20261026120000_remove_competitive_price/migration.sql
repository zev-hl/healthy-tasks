-- Competitive Price alerts (HLAI-124) taken back out (26 Oct 2026).
--
-- The previous migration added three columns to ListingSnapshot; this one drops
-- them, so every database ends the same whether or not it ever ran HLAI-124 (one
-- that never did adds them and drops them again here).
--
-- It also removes what the three alert types left behind. The app no longer knows
-- them, and reading them back breaks it: an alert of one of them crashes the
-- Alert Log and its group's alerts panel, a setup row with a template makes tasks
-- labelled "undefined", group settings still count in the Groups list, and a saved
-- All Tasks filter naming one is refused on every load. Tasks made from those
-- alerts are kept, with their Alert Type cleared.

-- Their alerts: the log rows (a task made from one keeps going; only the alert goes).
DELETE FROM "AlertLog"
WHERE "alertType" IN ('CompetitivePriceBelowOurs', 'CompetitivePriceIncreased', 'CompetitivePriceChanged');

-- Each group's setting for them.
DELETE FROM "AlertSetting"
WHERE "alertType" IN ('CompetitivePriceBelowOurs', 'CompetitivePriceIncreased', 'CompetitivePriceChanged');

-- Their Alert Task Setup rows (template and people).
DELETE FROM "AlertTaskSetting"
WHERE "alertType" IN ('CompetitivePriceBelowOurs', 'CompetitivePriceIncreased', 'CompetitivePriceChanged');

-- Tasks tagged with one: Alert Type cleared, so "(not set)" finds them again.
UPDATE "Task"
SET "alertType" = NULL
WHERE "alertType" IN ('CompetitivePriceBelowOurs', 'CompetitivePriceIncreased', 'CompetitivePriceChanged');

-- Saved All Tasks filters: the three taken out of the Alert Type choice (an empty
-- choice means no Alert Type filter).
UPDATE "UserScreenPref"
SET "state" = jsonb_set(
  "state",
  '{filters,alertTypes}',
  COALESCE(
    (
      SELECT jsonb_agg(t)
      FROM jsonb_array_elements("state" -> 'filters' -> 'alertTypes') AS t
      WHERE t #>> '{}' NOT IN ('CompetitivePriceBelowOurs', 'CompetitivePriceIncreased', 'CompetitivePriceChanged')
    ),
    '[]'::jsonb
  )
)
WHERE "screen" = 'task-search'
  AND jsonb_typeof("state" -> 'filters' -> 'alertTypes') = 'array'
  AND ("state" -> 'filters' -> 'alertTypes') ?| ARRAY['CompetitivePriceBelowOurs', 'CompetitivePriceIncreased', 'CompetitivePriceChanged'];

-- AlterTable
ALTER TABLE "ListingSnapshot" DROP COLUMN "competitivePrice",
DROP COLUMN "ourLandedPrice",
DROP COLUMN "competitiveRecorded";
