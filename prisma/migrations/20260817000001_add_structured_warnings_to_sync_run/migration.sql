-- Additive, nullable structured-warning classification for SyncRun, layered
-- on top of the existing warningCount/warningDetails legacy contract. Both
-- existing columns are unchanged. No default, no data rewrite, no backfill:
-- every existing row reads back structuredWarnings = NULL, meaning
-- "classification unavailable" for that historical row — never "no
-- warnings" or "safe". See src/services/sync/sync-warning-codes.ts and
-- prisma/schema.prisma for the shape and semantics.
ALTER TABLE "SyncRun" ADD COLUMN "structuredWarnings" JSONB;
