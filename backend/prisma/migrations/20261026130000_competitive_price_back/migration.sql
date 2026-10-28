-- Competitive Price alerts (HLAI-124) brought back (26 Oct 2026).
--
-- `20261023120000_competitive_price` first added these columns and
-- `20261026120000_remove_competitive_price` dropped them when the feature was taken
-- out; this adds them again, the same as the first time.
--
-- `competitiveRecorded` starts false on every row, so the first check after this
-- release has no earlier competitive price to compare with: it lists the listings
-- already below ours once, and every snapshot saved from then on sets it.

-- AlterTable
ALTER TABLE "ListingSnapshot" ADD COLUMN     "competitivePrice" DECIMAL(10,2),
ADD COLUMN     "ourLandedPrice" DECIMAL(10,2),
ADD COLUMN     "competitiveRecorded" BOOLEAN NOT NULL DEFAULT false;
