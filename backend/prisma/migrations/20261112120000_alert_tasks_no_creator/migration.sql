-- A task made from an Exclusives alert has no person as its creator: it is
-- shown as "Alert-assigned". Who last saved that alert type's setup stays on
-- AlertTaskSetting.savedById.
ALTER TABLE "Task" ALTER COLUMN "creatorId" DROP NOT NULL;

-- Existing alert tasks were stamped with the Admin who saved the setup. Clear
-- that from what was written when each task was made, in this order (the
-- assignment notices are matched to the creator before it is cleared):

-- 1. Their assignment notices, made in the same moment as the task.
UPDATE "Notification" n
SET "actorId" = NULL
FROM "Task" t
JOIN "TemplateOccurrence" o ON o."id" = t."templateOccurrenceId"
WHERE n."taskId" = t."id"
  AND o."origin" = 'alert'
  AND n."type" = 'assigned'
  AND n."actorId" = t."creatorId"
  AND abs(extract(epoch FROM (n."createdAt" - t."createdAt"))) < 60;

-- 2. Their "made from a template" and "made from an alert" history lines.
UPDATE "TaskHistory" h
SET "userId" = NULL
FROM "Task" t
JOIN "TemplateOccurrence" o ON o."id" = t."templateOccurrenceId"
WHERE h."taskId" = t."id"
  AND o."origin" = 'alert'
  AND h."field" IN ('template', 'alert')
  AND h."userId" = t."creatorId";

-- 3. The creator itself.
UPDATE "Task" t
SET "creatorId" = NULL
FROM "TemplateOccurrence" o
WHERE o."id" = t."templateOccurrenceId"
  AND o."origin" = 'alert';
