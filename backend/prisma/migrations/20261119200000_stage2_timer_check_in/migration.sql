-- Stage 2 (L2): the timer asks "Still working?" after a while, and stops itself
-- when nobody answers. Both numbers are Admin settings.
ALTER TYPE "NotificationType" ADD VALUE 'timerCheckIn';
ALTER TYPE "NotificationType" ADD VALUE 'timerStopped';

ALTER TABLE "RunningTimer" ADD COLUMN "confirmedAt" TIMESTAMP(3);
UPDATE "RunningTimer" SET "confirmedAt" = "startedAt";
ALTER TABLE "RunningTimer" ALTER COLUMN "confirmedAt" SET NOT NULL;
ALTER TABLE "RunningTimer" ADD COLUMN "checkInSentAt" TIMESTAMP(3);

ALTER TABLE "AppSetting" ADD COLUMN "timerCheckInHours" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "AppSetting" ADD COLUMN "timerCheckInGraceMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_timerCheckInHours_check"
  CHECK ("timerCheckInHours" BETWEEN 1 AND 12);
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_timerCheckInGraceMinutes_check"
  CHECK ("timerCheckInGraceMinutes" BETWEEN 5 AND 120);
