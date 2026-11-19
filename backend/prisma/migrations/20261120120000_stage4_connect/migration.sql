-- Nov 2026 plan, Stage 4: our Connect.
-- K3: a reminder goes to Connect once. Reminders already due are marked as
-- sent, so linking Connect never sends a pile of old ones.
ALTER TABLE "Reminder" ADD COLUMN "connectSentAt" TIMESTAMP(3);
UPDATE "Reminder" SET "connectSentAt" = CURRENT_TIMESTAMP WHERE "remindAt" <= CURRENT_TIMESTAMP;

-- K2: the Connect call an event books or rang.
ALTER TABLE "Event" ADD COLUMN "connectCallId" TEXT;
ALTER TABLE "Event" ADD COLUMN "connectCallKind" TEXT;
ALTER TABLE "Event" ADD COLUMN "connectJoinUrl" TEXT;
ALTER TABLE "Event" ADD CONSTRAINT "Event_connectCallKind_check"
  CHECK ("connectCallKind" IS NULL OR "connectCallKind" IN ('convene', 'ring'));

-- K5: the task's group chat in Connect.
ALTER TABLE "Task" ADD COLUMN "connectConversationId" TEXT;
