-- Phase 13: Task-Level Access Control
-- Adds the Private flag to a task. While private, mention-only access is
-- suspended and visibility shrinks to {Admin, Assignee, Assignee supervisor
-- chain}. Defaults to false so every existing task stays non-private.
ALTER TABLE "Task" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
