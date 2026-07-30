-- Phase 11: Task Templates & Recurring Tasks.
-- Reusable (non-live) template trees, their between-node dependencies, a record
-- of each materialized instantiation (occurrence), and a singleton health row
-- for the recurrence scheduler. Ghosts (future, not-yet-materialized occurrences)
-- are computed on the fly and never stored.

-- CreateEnum
CREATE TYPE "TemplateRecurrenceType" AS ENUM ('None', 'Fixed', 'RelativeToCompletion');

-- CreateEnum
CREATE TYPE "RecurrenceUnit" AS ENUM ('Day', 'Week', 'Month');

-- CreateEnum
CREATE TYPE "RecurrenceEndType" AS ENUM ('Never', 'OnDate', 'AfterOccurrences');

-- CreateEnum
CREATE TYPE "TemplateOccurrenceOrigin" AS ENUM ('manual', 'scheduled');

-- AlterTable: template provenance on generated tasks. instanceLabel is kept as
-- its own filterable field (also prefixed onto the task name at instantiation).
ALTER TABLE "Task" ADD COLUMN     "instanceLabel" TEXT;
ALTER TABLE "Task" ADD COLUMN     "templateId" INTEGER;
ALTER TABLE "Task" ADD COLUMN     "templateNodeId" INTEGER;
ALTER TABLE "Task" ADD COLUMN     "templateOccurrenceId" INTEGER;

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "recurrenceType" "TemplateRecurrenceType" NOT NULL DEFAULT 'None',
    "intervalCount" INTEGER,
    "intervalUnit" "RecurrenceUnit",
    "anchorDate" TIMESTAMP(3),
    "endType" "RecurrenceEndType" NOT NULL DEFAULT 'Never',
    "endDate" TIMESTAMP(3),
    "maxOccurrences" INTEGER,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "labelPrefix" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplateNode" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "parentNodeId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultPriority" "TaskPriority" NOT NULL DEFAULT 'Medium',
    "startOffsetDays" INTEGER,
    "dueOffsetDays" INTEGER,
    "assigneeRole" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTemplateNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplateDependency" (
    "id" SERIAL NOT NULL,
    "blockerNodeId" INTEGER NOT NULL,
    "blockedNodeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTemplateDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateOccurrence" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "seq" INTEGER,
    "origin" "TemplateOccurrenceOrigin" NOT NULL,
    "instanceLabel" TEXT,
    "anchorStart" TIMESTAMP(3) NOT NULL,
    "rootTaskId" INTEGER,
    "materializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastTickAt" TIMESTAMP(3),
    "lastAlertAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_templateId_idx" ON "Task"("templateId");

-- CreateIndex
CREATE INDEX "Task_templateNodeId_idx" ON "Task"("templateNodeId");

-- CreateIndex
CREATE INDEX "Task_templateOccurrenceId_idx" ON "Task"("templateOccurrenceId");

-- CreateIndex
CREATE INDEX "Task_instanceLabel_idx" ON "Task"("instanceLabel");

-- CreateIndex
CREATE INDEX "TaskTemplate_createdById_idx" ON "TaskTemplate"("createdById");

-- CreateIndex
CREATE INDEX "TaskTemplate_recurrenceType_idx" ON "TaskTemplate"("recurrenceType");

-- CreateIndex
CREATE INDEX "TaskTemplateNode_templateId_idx" ON "TaskTemplateNode"("templateId");

-- CreateIndex
CREATE INDEX "TaskTemplateNode_parentNodeId_idx" ON "TaskTemplateNode"("parentNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplateDependency_blockerNodeId_blockedNodeId_key" ON "TaskTemplateDependency"("blockerNodeId", "blockedNodeId");

-- CreateIndex
CREATE INDEX "TaskTemplateDependency_blockerNodeId_idx" ON "TaskTemplateDependency"("blockerNodeId");

-- CreateIndex
CREATE INDEX "TaskTemplateDependency_blockedNodeId_idx" ON "TaskTemplateDependency"("blockedNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateOccurrence_rootTaskId_key" ON "TemplateOccurrence"("rootTaskId");

-- CreateIndex
CREATE INDEX "TemplateOccurrence_templateId_idx" ON "TemplateOccurrence"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateOccurrence_templateId_seq_key" ON "TemplateOccurrence"("templateId", "seq");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_templateNodeId_fkey" FOREIGN KEY ("templateNodeId") REFERENCES "TaskTemplateNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_templateOccurrenceId_fkey" FOREIGN KEY ("templateOccurrenceId") REFERENCES "TemplateOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateNode" ADD CONSTRAINT "TaskTemplateNode_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateNode" ADD CONSTRAINT "TaskTemplateNode_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "TaskTemplateNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateDependency" ADD CONSTRAINT "TaskTemplateDependency_blockerNodeId_fkey" FOREIGN KEY ("blockerNodeId") REFERENCES "TaskTemplateNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateDependency" ADD CONSTRAINT "TaskTemplateDependency_blockedNodeId_fkey" FOREIGN KEY ("blockedNodeId") REFERENCES "TaskTemplateNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateOccurrence" ADD CONSTRAINT "TemplateOccurrence_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateOccurrence" ADD CONSTRAINT "TemplateOccurrence_rootTaskId_fkey" FOREIGN KEY ("rootTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Task-level recurrence: a regular task can be set to recur (it is occurrence #1;
-- generated future instances point back via recurrenceSourceId + recurrenceSeq).
ALTER TABLE "Task" ADD COLUMN     "recurrenceSourceId" INTEGER;
ALTER TABLE "Task" ADD COLUMN     "recurrenceSeq" INTEGER;

-- CreateTable
CREATE TABLE "TaskRecurrence" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "recurrenceType" "TemplateRecurrenceType" NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "intervalUnit" "RecurrenceUnit" NOT NULL,
    "anchorDate" TIMESTAMP(3) NOT NULL,
    "endType" "RecurrenceEndType" NOT NULL DEFAULT 'Never',
    "endDate" TIMESTAMP(3),
    "maxOccurrences" INTEGER,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskRecurrence_taskId_key" ON "TaskRecurrence"("taskId");

-- CreateIndex
CREATE INDEX "Task_recurrenceSourceId_idx" ON "Task"("recurrenceSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurrenceSourceId_recurrenceSeq_key" ON "Task"("recurrenceSourceId", "recurrenceSeq");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceSourceId_fkey" FOREIGN KEY ("recurrenceSourceId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
