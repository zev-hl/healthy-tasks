-- Nov 2026 plan, Stage 2: reminders at an exact time with a note (E4), and
-- task snooze (E1, E2).

-- Reminders: an exact time replaces "N minutes before the start date".
ALTER TABLE "Reminder" ADD COLUMN "remindAt" TIMESTAMP(3);
ALTER TABLE "Reminder" ADD COLUMN "note" TEXT;
ALTER TABLE "Reminder" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'reminder';

-- Each existing reminder keeps the moment it would have gone off; one on a
-- task with no start date (it never could) goes off at the time it was made.
UPDATE "Reminder" r
   SET "remindAt" = COALESCE(t."startAt" - make_interval(mins => r."leadMinutes"), r."createdAt")
  FROM "Task" t
 WHERE t.id = r."taskId";
UPDATE "Reminder" SET "remindAt" = "createdAt" WHERE "remindAt" IS NULL;

ALTER TABLE "Reminder" ALTER COLUMN "remindAt" SET NOT NULL;
ALTER TABLE "Reminder" DROP COLUMN "leadMinutes";
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_kind_check" CHECK ("kind" IN ('reminder', 'snooze'));
CREATE INDEX "Reminder_remindAt_idx" ON "Reminder"("remindAt");

-- Snooze.
ALTER TABLE "Task" ADD COLUMN "snoozedUntil" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "snoozedById" TEXT;
ALTER TABLE "Task" ADD CONSTRAINT "Task_snoozedById_fkey"
  FOREIGN KEY ("snoozedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_snoozedUntil_idx" ON "Task"("snoozedUntil");
