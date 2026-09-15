-- CreateTable
CREATE TABLE "AlertGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "groupType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "marketplace" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingSnapshot" (
    "id" SERIAL NOT NULL,
    "listingId" INTEGER NOT NULL,
    "title" TEXT,
    "mainImageUrl" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "bulletPoints" JSONB,
    "description" TEXT,
    "dimensions" TEXT,
    "listedPrice" DECIMAL(10,2),
    "currency" TEXT,
    "buyboxWinnerSellerId" TEXT,
    "buyboxPrice" DECIMAL(10,2),
    "offerCount" INTEGER,
    "isSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressionReason" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSetting" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "alertType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'off',

    CONSTRAINT "AlertSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER,
    "listingId" INTEGER,
    "alertType" TEXT NOT NULL,
    "category" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "message" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertGroup_name_key" ON "AlertGroup"("name");

-- CreateIndex
CREATE INDEX "AlertGroup_createdById_idx" ON "AlertGroup"("createdById");

-- CreateIndex
CREATE INDEX "AlertGroup_updatedById_idx" ON "AlertGroup"("updatedById");

-- CreateIndex
CREATE INDEX "Listing_groupId_idx" ON "Listing"("groupId");

-- CreateIndex
CREATE INDEX "Listing_createdById_idx" ON "Listing"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_marketplace_asin_key" ON "Listing"("marketplace", "asin");

-- CreateIndex
CREATE INDEX "ListingSnapshot_listingId_capturedAt_idx" ON "ListingSnapshot"("listingId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "AlertSetting_groupId_idx" ON "AlertSetting"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSetting_groupId_alertType_key" ON "AlertSetting"("groupId", "alertType");

-- CreateIndex
CREATE INDEX "AlertLog_createdAt_idx" ON "AlertLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AlertLog_listingId_createdAt_idx" ON "AlertLog"("listingId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AlertGroup" ADD CONSTRAINT "AlertGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertGroup" ADD CONSTRAINT "AlertGroup_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AlertGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingSnapshot" ADD CONSTRAINT "ListingSnapshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSetting" ADD CONSTRAINT "AlertSetting_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AlertGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AlertGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
