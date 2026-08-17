import "server-only";

import { Prisma } from "@prisma/client";
import type { PrismaClient, SourceFamily, SyncRunStatus, SyncTrigger } from "@prisma/client";

import { getDb } from "@/lib/db";
import {
  unknownWarning,
  type StructuredWarningsPayload,
  type SyncWarning,
} from "@/services/sync/sync-warning-codes";

export const WARNING_DETAIL_LIMIT = 200;

export function capWarningDetails(warnings: readonly string[]): string[] {
  if (warnings.length <= WARNING_DETAIL_LIMIT) {
    return [...warnings];
  }
  const omitted = warnings.length - WARNING_DETAIL_LIMIT;
  return [
    ...warnings.slice(0, WARNING_DETAIL_LIMIT),
    `[truncated: ${omitted} additional warning${omitted === 1 ? "" : "s"} not stored]`,
  ];
}

/**
 * Truncation-safe structured-warning persistence shape. Mirrors
 * `capWarningDetails`'s retained-count exactly (same `WARNING_DETAIL_LIMIT`,
 * same "first N, in order" retention policy) but represents truncation as
 * explicit `truncatedCount` metadata rather than a synthetic in-band entry —
 * so a truncation marker can never be misclassified as a real warning code
 * (in particular, never as `RAW_BLOCKS_ALREADY_PERSISTED`). A future
 * consumer can detect incomplete structured classification for a run by
 * checking `truncatedCount > 0` and fail closed accordingly.
 */
export function capStructuredWarnings(
  warnings: readonly SyncWarning[],
): StructuredWarningsPayload {
  if (warnings.length <= WARNING_DETAIL_LIMIT) {
    return { warnings: [...warnings], truncatedCount: 0 };
  }
  return {
    warnings: warnings.slice(0, WARNING_DETAIL_LIMIT),
    truncatedCount: warnings.length - WARNING_DETAIL_LIMIT,
  };
}

/**
 * Resolves the structured-warning payload to persist on `createRun` when the
 * caller did not explicitly supply `structuredWarnings`.
 *
 * A bare `capStructuredWarnings(input.structuredWarnings ?? [])` default is
 * unsafe here: if the caller passed `warningDetails` (legacy warnings did
 * occur) but omitted `structuredWarnings` (classification was never
 * performed for them), collapsing straight to `[]` would persist
 * `{ warnings: [], truncatedCount: 0 }` — a payload that means "classification
 * complete, zero warnings" under the documented contract. That directly
 * contradicts `warningCount > 0` / non-empty `warningDetails` on the same
 * row, and a future consumer trusting `truncatedCount === 0` could treat
 * unclassified legacy warnings as safely classified. See AGENTS.md L149-150.
 *
 * Instead: when `structuredWarnings` is omitted, derive `UNKNOWN` entries
 * from the caller-supplied `warningDetails`, preserving exact legacy order
 * and detail text, then apply the same truncation-safe cap used everywhere
 * else. `UNKNOWN` is the correct fail-closed code here — this call site has
 * no structural knowledge of *why* each legacy warning occurred, only that
 * one occurred. When `warningDetails` is empty (or omitted), there are no
 * legacy warnings to classify, so a known-empty structured payload is safe
 * and unambiguous. `capStructuredWarnings` derives `truncatedCount` from the
 * same `WARNING_DETAIL_LIMIT` and "first N, in order" retention as
 * `capWarningDetails`, so the two never disagree about how much was
 * retained vs. truncated. The synthetic "[truncated: N …]" sentinel that
 * `capWarningDetails` appends to the legacy array is never part of
 * `warningDetails` at this layer — it is only added by `capWarningDetails`
 * itself when persisting the legacy column — so it can never leak into a
 * structured entry here.
 *
 * `warningCount` can also disagree with `warningDetails.length` — a caller
 * may declare a count without attaching detail text for every occurrence
 * (or without attaching any). Deriving `UNKNOWN` entries from
 * `warningDetails` alone in that case would silently persist
 * `{ warnings: [...], truncatedCount: 0 }` for the shortfall, which is
 * exactly the "classification complete, zero [additional] warnings" false
 * signal this function exists to prevent, just triggered by `warningCount`
 * instead of a fully-omitted `warningDetails`. Fabricating placeholder
 * detail text for the shortfall is not an option either: `SyncWarning.detail`
 * is documented (sync-warning-codes.ts) to always be byte-for-byte identical
 * to a real legacy warning string, and inventing text would violate that
 * invariant for entries that do not correspond to real evidence. Instead,
 * the shortfall is represented through `truncatedCount` — already documented
 * as "the exact count of additional real warnings that were not retained,"
 * which is precisely what an uncorroborated `warningCount` excess is. This
 * keeps `warnings` limited to only entries backed by real `warningDetails`
 * text, while `truncatedCount > 0` correctly signals incomplete structured
 * classification for any future consumer that checks it.
 */
function resolveCreateStructuredWarnings(input: {
  structuredWarnings?: readonly SyncWarning[];
  warningDetails?: readonly string[];
  warningCount?: number;
}): StructuredWarningsPayload {
  if (input.structuredWarnings !== undefined) {
    return capStructuredWarnings(input.structuredWarnings);
  }

  const legacyDetails = input.warningDetails ?? [];
  const capped = capStructuredWarnings(legacyDetails.map((detail) => unknownWarning(detail)));

  const unexplainedCount = Math.max(0, (input.warningCount ?? 0) - legacyDetails.length);
  if (unexplainedCount === 0) {
    return capped;
  }

  return {
    warnings: capped.warnings,
    truncatedCount: capped.truncatedCount + unexplainedCount,
  };
}

type SyncStateClient = PrismaClient | Prisma.TransactionClient;
type CursorStoreClient = PrismaClient;

export type SyncRunRecord = {
  id: string;
};

export type SyncCursorRecord = {
  fromBlock: bigint;
  toBlock: bigint;
  blockHash: string | null;
};

export type SyncRunStore = {
  createRun(input: {
    walletId: string;
    chainId: number;
    trigger: SyncTrigger;
    status: SyncRunStatus;
    stage: string;
    sourceFamilies: SourceFamily[];
    startBlock: bigint;
    endBlock: bigint;
    latestSafeBlock?: bigint;
    policyLabel: string;
    warningCount?: number;
    warningDetails?: readonly string[];
    /**
     * Structured classification, in the same order as `warningDetails`. When
     * omitted and `warningDetails` is empty (or also omitted), a fresh run
     * with no warnings persists a KNOWN empty structured payload. When
     * omitted but `warningDetails` is non-empty, the store derives `UNKNOWN`
     * entries from `warningDetails` rather than persisting a false empty
     * classification — see `resolveCreateStructuredWarnings`. If `warningCount`
     * exceeds `warningDetails.length`, the unexplained shortfall is folded
     * into `truncatedCount` rather than fabricated as placeholder detail
     * text, so the persisted payload never claims complete classification it
     * cannot back with real evidence. Persisted `null` is reserved for
     * historical rows written before this field existed; this store never
     * writes `null` for a new row.
     */
    structuredWarnings?: readonly SyncWarning[];
    errorMessage?: string;
    failedSourceFamily?: SourceFamily;
    failedFromBlock?: bigint;
    failedToBlock?: bigint;
  }): Promise<SyncRunRecord>;
  updateRun(input: {
    runId: string;
    status?: SyncRunStatus;
    stage?: string;
    startBlock?: bigint;
    latestSafeBlock?: bigint;
    warningCount?: number;
    warningDetails?: readonly string[];
    /**
     * Structured classification, in the same order as `warningDetails`. When
     * `undefined`, the column is left unchanged — mirrors how `warningDetails`
     * is already handled below (an intermediate stage update that does not
     * touch warnings at all must not clobber whatever was last persisted).
     */
    structuredWarnings?: readonly SyncWarning[];
    errorMessage?: string | null;
    endBlock?: bigint;
    failedSourceFamily?: SourceFamily | null;
    failedFromBlock?: bigint | null;
    failedToBlock?: bigint | null;
  }): Promise<void>;
};

export type SyncCursorStore = {
  getCursor(input: {
    walletId: string;
    chainId: number;
    sourceFamily: SourceFamily;
  }): Promise<SyncCursorRecord | null>;
  upsertCursor(input: {
    walletId: string;
    chainId: number;
    sourceFamily: SourceFamily;
    fromBlock: bigint;
    toBlock: bigint;
    blockHash: string | null;
  }): Promise<void>;
};

export function createPrismaSyncRunStore(
  client: SyncStateClient = getDb(),
): SyncRunStore {
  return {
    async createRun(input) {
      const run = await client.syncRun.create({
        data: {
          walletId: input.walletId,
          chainId: input.chainId,
          trigger: input.trigger,
          status: input.status,
          stage: input.stage,
          sourceFamilies: input.sourceFamilies,
          startBlock: input.startBlock,
          endBlock: input.endBlock,
          latestSafeBlock: input.latestSafeBlock,
          policyLabel: input.policyLabel,
          warningCount: input.warningCount ?? 0,
          warningDetails: capWarningDetails(input.warningDetails ?? []),
          structuredWarnings: resolveCreateStructuredWarnings({
            structuredWarnings: input.structuredWarnings,
            warningDetails: input.warningDetails,
            warningCount: input.warningCount,
          }),
          errorMessage: input.errorMessage ?? null,
          failedSourceFamily: input.failedSourceFamily ?? null,
          failedFromBlock: input.failedFromBlock ?? null,
          failedToBlock: input.failedToBlock ?? null,
        },
        select: {
          id: true,
        },
      });

      return run;
    },
    async updateRun(input) {
      await client.syncRun.update({
        where: {
          id: input.runId,
        },
        data: {
          status: input.status,
          stage: input.stage,
          startBlock: input.startBlock,
          latestSafeBlock: input.latestSafeBlock,
          warningCount: input.warningCount,
          warningDetails: input.warningDetails !== undefined
            ? capWarningDetails(input.warningDetails)
            : undefined,
          structuredWarnings: input.structuredWarnings !== undefined
            ? capStructuredWarnings(input.structuredWarnings)
            : undefined,
          errorMessage: input.errorMessage,
          endBlock: input.endBlock,
          failedSourceFamily: input.failedSourceFamily,
          failedFromBlock: input.failedFromBlock,
          failedToBlock: input.failedToBlock,
        },
      });
    },
  };
}

export function createPrismaSyncCursorStore(
  client: CursorStoreClient = getDb(),
): SyncCursorStore {
  return {
    async getCursor(input) {
      return client.syncCursor.findUnique({
        where: {
          walletId_chainId_sourceFamily: {
            walletId: input.walletId,
            chainId: input.chainId,
            sourceFamily: input.sourceFamily,
          },
        },
        select: {
          fromBlock: true,
          toBlock: true,
          blockHash: true,
        },
      });
    },
    async upsertCursor(input) {
      await runCursorTransactionWithRetry(client, async (tx) => {
        const existing = await tx.syncCursor.findUnique({
          where: {
            walletId_chainId_sourceFamily: {
              walletId: input.walletId,
              chainId: input.chainId,
              sourceFamily: input.sourceFamily,
            },
          },
          select: {
            fromBlock: true,
            toBlock: true,
            blockHash: true,
          },
        });
        const merged = mergeCursorWindow({
          existing,
          next: {
            fromBlock: input.fromBlock,
            toBlock: input.toBlock,
            blockHash: input.blockHash,
          },
        });

        if (!existing) {
          await tx.syncCursor.create({
            data: {
              walletId: input.walletId,
              chainId: input.chainId,
              sourceFamily: input.sourceFamily,
              fromBlock: merged.fromBlock,
              toBlock: merged.toBlock,
              blockHash: merged.blockHash,
            },
          });
          return;
        }

        if (!merged.changed) {
          return;
        }

        await tx.syncCursor.update({
          where: {
            walletId_chainId_sourceFamily: {
              walletId: input.walletId,
              chainId: input.chainId,
              sourceFamily: input.sourceFamily,
            },
          },
          data: {
            fromBlock: merged.fromBlock,
            toBlock: merged.toBlock,
            blockHash: merged.blockHash,
          },
        });
      });
    },
  };
}

export function mergeCursorWindow(args: {
  existing: SyncCursorRecord | null;
  next: SyncCursorRecord;
}) {
  if (!args.existing) {
    return {
      ...args.next,
      changed: true,
    };
  }

  if (args.next.toBlock > args.existing.toBlock && !args.next.blockHash) {
    throw new Error("cannot advance sync cursor without a high-water block hash");
  }

  const disconnectedForward = args.next.fromBlock > args.existing.toBlock + 1n;
  const disconnectedBackward = args.next.toBlock + 1n < args.existing.fromBlock;

  if (disconnectedForward || disconnectedBackward) {
    return {
      fromBlock: args.existing.fromBlock,
      toBlock: args.existing.toBlock,
      blockHash: args.existing.blockHash,
      changed: false,
    };
  }

  const mergedTo =
    args.next.toBlock > args.existing.toBlock
      ? args.next.toBlock
      : args.existing.toBlock;
  const mergedBlockHash =
    mergedTo === args.next.toBlock && args.next.toBlock > args.existing.toBlock
      ? (args.next.blockHash ?? args.existing.blockHash)
      : args.existing.blockHash;

  return {
    fromBlock:
      args.next.fromBlock < args.existing.fromBlock
        ? args.next.fromBlock
        : args.existing.fromBlock,
    toBlock: mergedTo,
    blockHash: mergedBlockHash,
    changed:
      mergedTo !== args.existing.toBlock ||
      args.next.fromBlock < args.existing.fromBlock,
  };
}

async function runCursorTransactionWithRetry(
  client: CursorStoreClient,
  operation: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await client.$transaction(
        async (tx) => {
          await operation(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableCursorConflict(error)) {
        throw error;
      }
    }
  }
}

function isRetryableCursorConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2034" || error.code === "P2002")
  );
}
