-- Phase 12: SMART Goals.
-- An employee-owned goal, independent of the Task system, with a
-- Draft -> PendingApproval -> Approved -> UnderReview -> Resolved lifecycle.
-- Either the employee or their supervisor drafts it; the supervisor approves.

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('Draft', 'PendingApproval', 'Approved', 'UnderReview', 'Resolved');

-- CreateEnum
CREATE TYPE "GoalMetricType" AS ENUM ('Count', 'Percentage', 'Frequency', 'Currency', 'Other');

-- CreateEnum
CREATE TYPE "GoalResolution" AS ENUM ('Exceeded', 'Met', 'Missed', 'PartiallyMet', 'InProgress');

-- CreateTable
CREATE TABLE "Goal" (
    "id" SERIAL NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "specific" TEXT NOT NULL,
    "metricType" "GoalMetricType" NOT NULL,
    "unitLabel" TEXT,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "risks" TEXT,
    "mitigations" TEXT,
    "notes" TEXT,
    "resultValue" DOUBLE PRECISION,
    "resultsFinalizedAt" TIMESTAMP(3),
    "resolution" "GoalResolution",
    "supervisorComments" TEXT,
    "rejectionComments" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'Draft',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "underReviewAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_ownerId_idx" ON "Goal"("ownerId");

-- CreateIndex
CREATE INDEX "Goal_createdById_idx" ON "Goal"("createdById");

-- CreateIndex
CREATE INDEX "Goal_status_idx" ON "Goal"("status");

-- CreateIndex
CREATE INDEX "Goal_deadline_idx" ON "Goal"("deadline");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
