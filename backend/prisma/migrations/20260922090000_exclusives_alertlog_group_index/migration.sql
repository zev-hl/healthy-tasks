-- HLAI-71 Chunk 7a: the Groups list counts alerts per group for the last 24
-- hours, and Chunk 7b filters the log by group (the Groups -> Log link).
-- AlertLog had no index on groupId at all, so both were sequential scans.
CREATE INDEX "AlertLog_groupId_createdAt_idx" ON "AlertLog"("groupId", "createdAt" DESC);
