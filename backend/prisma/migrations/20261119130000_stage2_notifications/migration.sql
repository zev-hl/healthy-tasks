-- Nov 2026 plan, Stage 2: notification settings per event and channel, sound,
-- browser push (E7), and the new task events (E3).

ALTER TYPE "NotificationType" ADD VALUE 'updateRequested';
ALTER TYPE "NotificationType" ADD VALUE 'statusChanged';
ALTER TYPE "NotificationType" ADD VALUE 'commented';
ALTER TYPE "NotificationType" ADD VALUE 'dueSoon';
ALTER TYPE "NotificationType" ADD VALUE 'overdue';
ALTER TYPE "NotificationType" ADD VALUE 'snoozed';

ALTER TABLE "Notification" ADD COLUMN "note" TEXT;
ALTER TABLE "Notification" ADD COLUMN "detail" TEXT;

ALTER TABLE "NotificationPreference" ADD COLUMN "channels" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "NotificationPreference" ADD COLUMN "soundOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPreference" ADD COLUMN "sound" TEXT NOT NULL DEFAULT 'chime';
ALTER TABLE "NotificationPreference" ADD COLUMN "pushOn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Due soon / overdue notices go once per due date.
ALTER TABLE "Task" ADD COLUMN "dueSoonNoticeFor" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "overdueNoticeFor" TIMESTAMP(3);
