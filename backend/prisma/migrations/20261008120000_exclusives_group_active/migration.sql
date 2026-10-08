-- Active/Inactive toggle for Alert Groups (backlog item 1-3).
--
-- A group that is switched off is skipped by the sweep, so its ASINs are not
-- fetched from Amazon at all. Everything else about the group stays put: its
-- listings, its alert settings and its past alerts are untouched.
--
-- Additive only, and defaulted to true, so every group that exists today stays
-- active and nothing changes until someone flips a switch.
ALTER TABLE "AlertGroup" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- The sweep filters listings by their group's flag on every pass, and the list
-- screen reads it for every row.
CREATE INDEX "AlertGroup_isActive_idx" ON "AlertGroup"("isActive");
