-- Stage 2 (L2): the timer's stretches, saved with their task and the task's duty.
CREATE TABLE "TimedStretch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "dutyId" TEXT,
    "date" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimedStretch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimedStretch_minutes_check" CHECK ("minutes" BETWEEN 1 AND 1440),
    CONSTRAINT "TimedStretch_order_check" CHECK ("endedAt" > "startedAt")
);

CREATE INDEX "TimedStretch_userId_date_idx" ON "TimedStretch"("userId", "date");
CREATE INDEX "TimedStretch_taskId_idx" ON "TimedStretch"("taskId");
CREATE INDEX "TimedStretch_dutyId_idx" ON "TimedStretch"("dutyId");

ALTER TABLE "TimedStretch" ADD CONSTRAINT "TimedStretch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimedStretch" ADD CONSTRAINT "TimedStretch_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimedStretch" ADD CONSTRAINT "TimedStretch_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
