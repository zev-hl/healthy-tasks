-- Task -> Template conversion: template nodes gain default tags + default
-- attachments (template-scoped blobs copied onto tasks at each instantiation).

-- Default tags carried onto the generated task.
ALTER TABLE "TaskTemplateNode" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Default attachments on a template node.
CREATE TABLE "TaskTemplateNodeAttachment" (
    "id" TEXT NOT NULL,
    "templateNodeId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTemplateNodeAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskTemplateNodeAttachment_storageKey_key" ON "TaskTemplateNodeAttachment"("storageKey");
CREATE INDEX "TaskTemplateNodeAttachment_templateNodeId_idx" ON "TaskTemplateNodeAttachment"("templateNodeId");
CREATE INDEX "TaskTemplateNodeAttachment_uploadedById_idx" ON "TaskTemplateNodeAttachment"("uploadedById");

ALTER TABLE "TaskTemplateNodeAttachment"
    ADD CONSTRAINT "TaskTemplateNodeAttachment_templateNodeId_fkey"
    FOREIGN KEY ("templateNodeId") REFERENCES "TaskTemplateNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskTemplateNodeAttachment"
    ADD CONSTRAINT "TaskTemplateNodeAttachment_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
