-- Nov 2026 plan, Stage 3: events on the calendar (H4a) and each person's own
-- Google Calendar, read-only (H6).
ALTER TYPE "NotificationType" ADD VALUE 'eventInvited';
ALTER TYPE "NotificationType" ADD VALUE 'eventChanged';
ALTER TYPE "NotificationType" ADD VALUE 'eventCanceled';

CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "notes" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "taskId" INTEGER,
    "createdById" TEXT NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Event_kind_check" CHECK ("kind" IN ('meeting', 'call', 'deadline', 'other')),
    CONSTRAINT "Event_order_check" CHECK ("endAt" >= "startAt")
);
CREATE INDEX "Event_startAt_idx" ON "Event"("startAt");
CREATE INDEX "Event_endAt_idx" ON "Event"("endAt");
CREATE INDEX "Event_taskId_idx" ON "Event"("taskId");
CREATE INDEX "Event_createdById_idx" ON "Event"("createdById");
ALTER TABLE "Event" ADD CONSTRAINT "Event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventAttendee" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("eventId", "userId")
);
CREATE INDEX "EventAttendee_userId_idx" ON "EventAttendee"("userId");
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GoogleCalendarLink" (
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "refreshToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "GoogleCalendarLink_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "GoogleCalendarLink" ADD CONSTRAINT "GoogleCalendarLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An event's notices have no task: they point at the event instead.
ALTER TABLE "Notification" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "Notification" ADD COLUMN "eventId" TEXT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_about_check" CHECK ("taskId" IS NOT NULL OR "eventId" IS NOT NULL);
CREATE INDEX "Notification_eventId_idx" ON "Notification"("eventId");
