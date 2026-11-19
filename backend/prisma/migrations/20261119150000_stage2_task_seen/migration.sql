-- Nov 2026 plan, Stage 2 (H1): when each person last opened each task, for
-- the Dashboard's Unread count.
CREATE TABLE "TaskSeen" (
    "userId" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskSeen_pkey" PRIMARY KEY ("userId","taskId")
);
CREATE INDEX "TaskSeen_taskId_idx" ON "TaskSeen"("taskId");
ALTER TABLE "TaskSeen" ADD CONSTRAINT "TaskSeen_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskSeen" ADD CONSTRAINT "TaskSeen_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
