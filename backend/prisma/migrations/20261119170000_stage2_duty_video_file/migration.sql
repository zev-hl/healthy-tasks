-- Nov 2026 plan, Stage 2 (I4): a duty's video can be an uploaded file.
ALTER TABLE "Duty" ADD COLUMN "videoKey" TEXT;
ALTER TABLE "Duty" ADD COLUMN "videoName" TEXT;
