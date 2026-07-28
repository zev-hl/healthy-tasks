-- Phase 6: per-user screen preferences + Task sort/filter indexes.

-- CreateTable
CREATE TABLE "UserScreenPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserScreenPref_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserScreenPref_userId_screen_key" ON "UserScreenPref"("userId", "screen");

-- AddForeignKey
ALTER TABLE "UserScreenPref" ADD CONSTRAINT "UserScreenPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: support the Search screen's sort/filter columns.
CREATE INDEX "Task_priority_idx" ON "Task"("priority");
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");
CREATE INDEX "Task_startAt_idx" ON "Task"("startAt");
CREATE INDEX "Task_statusChangedAt_idx" ON "Task"("statusChangedAt");
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");
