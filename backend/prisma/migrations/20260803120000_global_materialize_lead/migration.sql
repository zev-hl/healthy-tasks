-- Global materialization lead time (Admin-controlled), replacing the per-template
-- and per-task leadTimeDays overrides.

-- New singleton settings table (id = 1). Seed the single row with the prior default.
CREATE TABLE "AppSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "materializeLeadDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppSetting" ("id", "materializeLeadDays", "updatedAt")
VALUES (1, 14, CURRENT_TIMESTAMP);

-- Drop the now-removed per-record lead-time columns.
ALTER TABLE "TaskTemplate" DROP COLUMN "leadTimeDays";
ALTER TABLE "TaskRecurrence" DROP COLUMN "leadTimeDays";
