-- Stage 2 (L2): the running timer lives on the server, one per person.
CREATE TABLE "RunningTimer" (
    "userId" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunningTimer_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "RunningTimer_taskId_idx" ON "RunningTimer"("taskId");

ALTER TABLE "RunningTimer" ADD CONSTRAINT "RunningTimer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunningTimer" ADD CONSTRAINT "RunningTimer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
