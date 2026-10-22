-- Alert Tasks (HLAI-112): tasks made from Exclusives alerts are a third kind of
-- template occurrence, beside manual and scheduled ones. They carry no `seq`, so
-- they never count toward a schedule, and the next scheduled fire does not take
-- its people from them.
--
-- Additive only: existing occurrences keep their origin.

-- AlterEnum
ALTER TYPE "TemplateOccurrenceOrigin" ADD VALUE 'alert';
