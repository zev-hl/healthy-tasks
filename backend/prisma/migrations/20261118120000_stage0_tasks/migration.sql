-- Nov 2026 plan, Stage 0: projects, soft delete, last activity, duty pages,
-- template departments.

-- AlterTable
ALTER TABLE "Duty" ADD COLUMN     "sop" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "isProject" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN     "departmentId" TEXT;

-- CreateIndex
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");

-- CreateIndex
CREATE INDEX "Task_lastActivityAt_idx" ON "Task"("lastActivityAt");

-- CreateIndex
CREATE INDEX "TaskTemplate_departmentId_idx" ON "TaskTemplate"("departmentId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A project is always a top-level task.
ALTER TABLE "Task" ADD CONSTRAINT "Task_project_is_top_level"
  CHECK ("isProject" = false OR "parentId" IS NULL);

-- Backfill: the last activity is the later of the task's own last change and
-- its newest comment.
UPDATE "Task" t SET "lastActivityAt" = GREATEST(
  t."updatedAt",
  COALESCE((SELECT MAX(c."createdAt") FROM "Comment" c WHERE c."taskId" = t.id), t."updatedAt")
);
