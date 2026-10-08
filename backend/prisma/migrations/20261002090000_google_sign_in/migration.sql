-- Google sign-in (Chunk 1): record Google's permanent account id the first time
-- someone signs in that way.
--
-- Additive only. Nothing is dropped, nothing is backfilled, and password
-- sign-in is untouched — both ways in remain open.
--
-- Nullable because it stays empty for anyone who only ever uses a password,
-- and unique so one Google account can never be linked to two users.
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
