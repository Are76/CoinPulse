import type { SourceFamily } from "@prisma/client";

/**
 * Single source of truth for the source families that the sync pipeline
 * currently handles end-to-end (ingest + normalize + persist).
 *
 * Validation, orchestrator, and debug status all derive their lists from
 * here so that adding a new family only requires one change.
 */
export const SUPPORTED_SYNC_SOURCE_FAMILIES = [
  "TRANSFERS",
  "DEX",
  "LP",
  "STAKING",
] as const satisfies readonly SourceFamily[];

export type SupportedSyncSourceFamily = (typeof SUPPORTED_SYNC_SOURCE_FAMILIES)[number];
