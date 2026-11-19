-- Nov 2026 plan, Stage 2 (D4): voice notes and screen recordings in comments.
ALTER TABLE "Attachment" ADD COLUMN "recording" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "Attachment" ADD COLUMN "transcript" TEXT;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_recording_check"
  CHECK ("recording" IS NULL OR "recording" IN ('voice', 'screen'));
