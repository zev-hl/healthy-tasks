-- Nov 2026 plan, Stage 2 (I1): drafts, each with its files.
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Draft_ownerId_idx" ON "Draft"("ownerId");
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DraftFile" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DraftFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DraftFile_storageKey_key" ON "DraftFile"("storageKey");
CREATE INDEX "DraftFile_draftId_idx" ON "DraftFile"("draftId");
ALTER TABLE "DraftFile" ADD CONSTRAINT "DraftFile_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
