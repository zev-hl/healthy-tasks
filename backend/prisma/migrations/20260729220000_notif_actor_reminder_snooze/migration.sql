-- Phase 9 follow-on: assigner on notifications + reminder snooze.

-- Who caused an assigned notification (the assigner). Nullable; older rows stay null.
ALTER TABLE "Notification" ADD COLUMN "actorId" TEXT;

-- Hide a due reminder until this time when the user snoozes it.
ALTER TABLE "Reminder" ADD COLUMN "snoozedUntil" TIMESTAMP(3);
