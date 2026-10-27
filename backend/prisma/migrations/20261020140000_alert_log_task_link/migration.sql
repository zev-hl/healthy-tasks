-- Alert Tasks (HLAI-112): tasks made from Exclusives alerts — go-live.
--
-- Each alert remembers the top task made from it (`taskId`; emptied if that task
-- is deleted) and when it was dealt with (`taskHandledAt`: its task made, or no
-- task due). An alert is only ever picked up while `taskHandledAt` is empty, and
-- it is set in the same transaction as the task, so an alert never makes two.
--
-- Go-live: every alert already in the log is marked dealt with here, so only
-- alerts found after this migration runs (on each server: local, staging,
-- production) make tasks.

-- AlterTable
ALTER TABLE "AlertLog" ADD COLUMN     "taskId" INTEGER,
ADD COLUMN     "taskHandledAt" TIMESTAMP(3);

-- Go-live: alerts from before now never make tasks.
UPDATE "AlertLog" SET "taskHandledAt" = CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "AlertLog_taskId_idx" ON "AlertLog"("taskId");

-- CreateIndex
CREATE INDEX "AlertLog_taskHandledAt_idx" ON "AlertLog"("taskHandledAt");

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
