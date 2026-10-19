-- Task special attributes (HLAI-118): Alert Group and Alert Type.
--
-- Two optional columns on Task. `alertGroupId` links to an Exclusives
-- AlertGroup; deleting the group empties it (ON DELETE SET NULL). `alertType`
-- holds one of the shared EXCLUSIVES_ALERT_TYPES as text, checked in the app
-- like the Exclusives list fields, so a type can be added without a migration.
--
-- Additive only: existing tasks start with both empty. Indexed for the task
-- list's attribute filter.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "alertGroupId" INTEGER,
ADD COLUMN     "alertType" TEXT;

-- CreateIndex
CREATE INDEX "Task_alertGroupId_idx" ON "Task"("alertGroupId");

-- CreateIndex
CREATE INDEX "Task_alertType_idx" ON "Task"("alertType");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_alertGroupId_fkey" FOREIGN KEY ("alertGroupId") REFERENCES "AlertGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
