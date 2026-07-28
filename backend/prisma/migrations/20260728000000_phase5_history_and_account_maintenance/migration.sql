-- Phase 5: task change-history + account maintenance (names, email edit, merge).

-- CreateEnum
CREATE TYPE "TaskHistoryChangeType" AS ENUM ('updated', 'added', 'removed');

-- AlterTable: add First/Last name and the account-merge pointer to User.
-- firstName/lastName are NOT NULL going forward but default to '' so existing
-- rows backfill to blank (an admin fills them in via the Users screen).
ALTER TABLE "User"
  ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mergedIntoId" TEXT;

-- CreateTable
CREATE TABLE "TaskHistory" (
    "id" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "userId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "field" TEXT NOT NULL,
    "changeType" "TaskHistoryChangeType" NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "detail" TEXT,

    CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskHistory_taskId_changedAt_idx" ON "TaskHistory"("taskId", "changedAt");

-- CreateIndex
CREATE INDEX "TaskHistory_userId_idx" ON "TaskHistory"("userId");

-- CreateIndex
CREATE INDEX "User_mergedIntoId_idx" ON "User"("mergedIntoId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
