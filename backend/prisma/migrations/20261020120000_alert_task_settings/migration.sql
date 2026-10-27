-- Alert Tasks (HLAI-112): the setup behind the Alert Tasks screen.
--
-- One row per Exclusives alert type once it has been saved: the template that
-- type's tasks are made from, and who fills each of that template's roles, the
-- same for every alert group. `alertType` holds one of the shared
-- EXCLUSIVES_ALERT_TYPES as text, checked in the app like AlertSetting.
-- `roleAssignments` is [{ role, assigneeId }], people only.
--
-- Deleting the template empties `templateId` (ON DELETE SET NULL), so that type
-- makes no tasks until another is picked. `savedById` is the Admin who last
-- changed the row; the tasks it makes show them as their creator.
--
-- Additive only: no rows until an Admin saves the screen.

-- CreateTable
CREATE TABLE "AlertTaskSetting" (
    "id" SERIAL NOT NULL,
    "alertType" TEXT NOT NULL,
    "templateId" INTEGER,
    "roleAssignments" JSONB NOT NULL DEFAULT '[]',
    "savedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertTaskSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertTaskSetting_alertType_key" ON "AlertTaskSetting"("alertType");

-- CreateIndex
CREATE INDEX "AlertTaskSetting_templateId_idx" ON "AlertTaskSetting"("templateId");

-- CreateIndex
CREATE INDEX "AlertTaskSetting_savedById_idx" ON "AlertTaskSetting"("savedById");

-- AddForeignKey
ALTER TABLE "AlertTaskSetting" ADD CONSTRAINT "AlertTaskSetting_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertTaskSetting" ADD CONSTRAINT "AlertTaskSetting_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
