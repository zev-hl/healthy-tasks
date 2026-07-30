-- Phase 10 review workflow: temporary reviewer assignment bookkeeping on Task.
-- All three columns are populated only while status = 'Review' and cleared when
-- the task leaves Review (via the Reviewed or Recall-from-Review actions).

-- Who sent the task to Review (audit/context only).
ALTER TABLE "Task" ADD COLUMN "reviewInitiatorId" TEXT;
-- The assignee at the moment it entered Review (restored when review ends).
ALTER TABLE "Task" ADD COLUMN "priorAssigneeId" TEXT;
-- The status the task held immediately before entering Review (restored later).
ALTER TABLE "Task" ADD COLUMN "priorStatus" "TaskStatus";

CREATE INDEX "Task_reviewInitiatorId_idx" ON "Task"("reviewInitiatorId");
CREATE INDEX "Task_priorAssigneeId_idx" ON "Task"("priorAssigneeId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_reviewInitiatorId_fkey" FOREIGN KEY ("reviewInitiatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_priorAssigneeId_fkey" FOREIGN KEY ("priorAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
