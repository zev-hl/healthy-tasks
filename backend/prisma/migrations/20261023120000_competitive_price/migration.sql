-- Competitive Price alerts (HLAI-124): each listing's saved snapshot keeps
-- Amazon's competitive price and our price + shipping, read from the pricing
-- answer every check already fetches.
--
-- `competitiveRecorded` is false on every row saved before this release, so the
-- first check after it can tell it has no earlier competitive price to compare;
-- every snapshot saved from then on sets it.

-- AlterTable
ALTER TABLE "ListingSnapshot" ADD COLUMN     "competitivePrice" DECIMAL(10,2),
ADD COLUMN     "ourLandedPrice" DECIMAL(10,2),
ADD COLUMN     "competitiveRecorded" BOOLEAN NOT NULL DEFAULT false;
