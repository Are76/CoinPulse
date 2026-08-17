import "server-only";

/**
 * Canonical, single-source-of-truth warning code taxonomy for SyncRun.
 *
 * This is additive machine classification layered on top of the existing
 * `warningCount` / `warningDetails` legacy contract — it does not replace or
 * change either. Every warning that flows into a SyncRun (sync ingestion,
 * rebuild, materialization) is represented internally as a `SyncWarning`
 * `{ code, detail }` pair. `detail` is always byte-for-byte identical to the
 * legacy warning string. `code` is assigned ONLY at the exact producer site
 * that has structural knowledge of the condition — never derived from
 * matching `detail` text after the fact.
 *
 * `UNKNOWN` means "a warning occurred, but the structured taxonomy does not
 * yet classify this producer condition." It is NOT a "safe" or "benign"
 * default — it carries no safety implication and must never be treated as
 * such by any future consumer.
 */
export const SYNC_WARNING_CODES = {
  /**
   * Assigned ONLY at the exact producer condition in
   * `ingestWalletTransferArtifacts` (src/services/sync/sync-common.ts) where
   * the number of raw blocks scanned in a window exceeds the number of raw
   * blocks newly persisted by that same call, because
   * `persistRawBlocks(..., { skipDuplicates: true })` skipped rows whose
   * exact canonical `(chainId, blockNumber, blockHash)` identity already
   * existed. This is a benign replay signal, not an error — but PR A does
   * not change how it is counted, stored, or gated. No other producer
   * (skipped non-ERC20 logs, skip-dex/skip-lp/skip-stake candidates,
   * rebuild, or materialization warnings) may ever be assigned this code.
   */
  RAW_BLOCKS_ALREADY_PERSISTED: "RAW_BLOCKS_ALREADY_PERSISTED",
  /**
   * Every warning producer not explicitly classified above. This is the
   * required fail-closed default for every other current warning family:
   * skipped non-transfer / unrelated-wallet / non-ERC20 log warnings,
   * skip-dex / skip-lp / skip-stake candidate warnings, rebuild warnings,
   * and materialization warnings.
   */
  UNKNOWN: "UNKNOWN",
} as const;

export type SyncWarningCode =
  (typeof SYNC_WARNING_CODES)[keyof typeof SYNC_WARNING_CODES];

/** A single structured warning: the legacy detail string plus its assigned code. */
export type SyncWarning = {
  code: SyncWarningCode;
  detail: string;
};

export function unknownWarning(detail: string): SyncWarning {
  return { code: SYNC_WARNING_CODES.UNKNOWN, detail };
}

export function rawBlocksAlreadyPersistedWarning(detail: string): SyncWarning {
  return { code: SYNC_WARNING_CODES.RAW_BLOCKS_ALREADY_PERSISTED, detail };
}

/**
 * Appends `detail` to a legacy `string[]` warning list and its parallel
 * `SyncWarning[]` structured list in lockstep, so the two can never drift out
 * of order or count. `detail` is written exactly once (here) — callers never
 * duplicate the literal string across the two arrays.
 */
export function pushWarning(
  warnings: string[],
  structuredWarnings: SyncWarning[],
  code: SyncWarningCode,
  detail: string,
): void {
  warnings.push(detail);
  structuredWarnings.push({ code, detail });
}

/**
 * The truncation-safe persisted shape for `SyncRun.structuredWarnings`.
 *
 * `warnings` holds only the same semantic entries retained by the legacy
 * `capWarningDetails` cap (never the synthetic "[truncated: N …]" legacy
 * detail — that sentinel is metadata about storage, not a real warning, and
 * must never be assigned any semantic code including UNKNOWN).
 * `truncatedCount` is the exact count of additional real warnings that were
 * not retained — 0 when nothing was truncated. A future consumer that needs
 * to know whether structured classification is complete for a run can check
 * `truncatedCount === 0` and fail closed otherwise.
 */
export type StructuredWarningsPayload = {
  warnings: SyncWarning[];
  truncatedCount: number;
};
