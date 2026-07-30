-- Sophisticated recurrence (Google-style): a yearly interval, plus weekly
-- by-weekday selection ("repeat on" specific days). Empty weekdays = the
-- anchor's own weekday (prior behavior), so existing rows are unaffected.

-- AlterEnum
ALTER TYPE "RecurrenceUnit" ADD VALUE 'Year';

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "TaskRecurrence" ADD COLUMN "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
