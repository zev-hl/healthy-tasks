-- Failed emails (BullMQ email queue, Phase 2a).
--
-- One row per email the email worker could not send: `retrying` while the queue
-- still has automatic tries left, `failed` once it has none. Only the worker
-- writes here; an email that succeeds on a later try has its row deleted, and a
-- weekly cleanup deletes the `failed` rows.
--
-- Additive only: a new, empty table. Nothing reads or writes it until the
-- worker starts recording failures.

-- CreateTable
CREATE TABLE "FailedEmail" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT NOT NULL,
    "nextRetryAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FailedEmail_emailId_key" ON "FailedEmail"("emailId");

-- The weekly cleanup deletes by status.
CREATE INDEX "FailedEmail_status_idx" ON "FailedEmail"("status");

-- Only the two states the worker uses.
ALTER TABLE "FailedEmail" ADD CONSTRAINT "FailedEmail_status_check" CHECK ("status" IN ('retrying', 'failed'));

-- A row exists only after a try has failed.
ALTER TABLE "FailedEmail" ADD CONSTRAINT "FailedEmail_attempts_check" CHECK ("attempts" >= 1);

-- failedAt says when it ran out of tries, so it is set exactly for `failed`.
ALTER TABLE "FailedEmail" ADD CONSTRAINT "FailedEmail_failedAt_check" CHECK (("status" = 'failed') = ("failedAt" IS NOT NULL));
