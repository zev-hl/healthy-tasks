-- Per-user timezone, chosen by the person on their Profile.
--
-- Additive only. Nullable with no backfill: NULL means "not set", and
-- server-rendered times (reminder emails) keep using BUSINESS_TIMEZONE until
-- the person picks a zone.
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT;
