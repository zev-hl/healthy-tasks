-- Department Duties.
--
-- Departments own Duties; people hold Duties (UserDuty); tasks and template
-- nodes can carry a Duty; people log minutes per Duty per day (TimeEntry) and
-- mark each day Completed (TimeDay). Additive only: every new column is
-- nullable and every existing row is untouched, so nothing changes until an
-- Admin creates the first department.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'dutyMismatch';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "dutyId" TEXT;

-- AlterTable
ALTER TABLE "TaskTemplateNode" ADD COLUMN     "dutyId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Duty" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Duty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDuty" (
    "userId" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDuty_pkey" PRIMARY KEY ("userId","dutyId")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dutyId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeDay" (
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeDay_pkey" PRIMARY KEY ("userId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_nameKey_key" ON "Department"("nameKey");

-- CreateIndex
CREATE INDEX "Duty_departmentId_idx" ON "Duty"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Duty_departmentId_nameKey_key" ON "Duty"("departmentId", "nameKey");

-- CreateIndex
CREATE INDEX "UserDuty_dutyId_idx" ON "UserDuty"("dutyId");

-- CreateIndex
CREATE INDEX "TimeEntry_date_idx" ON "TimeEntry"("date");

-- CreateIndex
CREATE INDEX "TimeEntry_dutyId_idx" ON "TimeEntry"("dutyId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_userId_date_dutyId_key" ON "TimeEntry"("userId", "date", "dutyId");

-- CreateIndex
CREATE INDEX "TimeDay_date_idx" ON "TimeDay"("date");

-- CreateIndex
CREATE INDEX "Task_dutyId_idx" ON "Task"("dutyId");

-- CreateIndex
CREATE INDEX "TaskTemplateNode_dutyId_idx" ON "TaskTemplateNode"("dutyId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateNode" ADD CONSTRAINT "TaskTemplateNode_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Duty" ADD CONSTRAINT "Duty_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDuty" ADD CONSTRAINT "UserDuty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDuty" ADD CONSTRAINT "UserDuty_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeDay" ADD CONSTRAINT "TimeDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariants Prisma can't express. The service layer enforces each of these
-- with a friendly message first; these are the backstop against direct SQL and
-- future code paths (same two-layer pattern as user_supervisor_role_check).
-- ---------------------------------------------------------------------------

-- A day can't hold more than 24 hours on one duty, and an entry is never empty
-- (clearing an entry deletes the row).
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_minutes_check" CHECK ("minutes" BETWEEN 1 AND 1440);

-- Hex swatch colors only.
ALTER TABLE "Department" ADD CONSTRAINT "Department_color_check" CHECK ("color" ~ '^#[0-9a-fA-F]{6}$');

-- nameKey is ALWAYS derived from name: lower-cased, trimmed, inner whitespace
-- collapsed. Uniqueness ("packing" vs "Packing " in the same department) rides
-- on the unique indexes over nameKey above.
CREATE OR REPLACE FUNCTION set_catalog_name_key() RETURNS TRIGGER AS $$
BEGIN
  NEW."name" := regexp_replace(btrim(NEW."name"), '\s+', ' ', 'g');
  IF NEW."name" = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  NEW."nameKey" := lower(NEW."name");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER department_name_key
BEFORE INSERT OR UPDATE ON "Department"
FOR EACH ROW EXECUTE FUNCTION set_catalog_name_key();

CREATE TRIGGER duty_name_key
BEFORE INSERT OR UPDATE ON "Duty"
FOR EACH ROW EXECUTE FUNCTION set_catalog_name_key();

-- A duty never moves between departments: that would silently rewrite every
-- past time report filed under it. Archive it and create a new one instead.
CREATE OR REPLACE FUNCTION check_duty_department_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."departmentId" IS DISTINCT FROM OLD."departmentId" THEN
    RAISE EXCEPTION 'A duty cannot be moved to another department';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER duty_department_immutable
BEFORE UPDATE ON "Duty"
FOR EACH ROW EXECUTE FUNCTION check_duty_department_immutable();
