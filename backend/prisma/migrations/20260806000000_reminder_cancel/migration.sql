-- Reminders overhaul: soft-cancel state on a reminder.

-- Stamped when another user's Save removed this reminder by clearing the task's
-- Start Date or Canceling the task. The owner still sees it as a "Canceled"
-- notice (while they retain task access) until they dismiss it. Terminal: a
-- canceled reminder never fires again and never resurrects.
ALTER TABLE "Reminder" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "Reminder" ADD COLUMN "canceledReason" TEXT;
