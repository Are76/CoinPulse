import "server-only";

import { getDb } from "@/lib/db";

/**
 * Canonical ERC-20 Transfer event signature (topic0).
 *
 * Defined locally because ingestion must not import from the sync layer
 * (dependency direction is sync -> ingestion). Keep in sync with
 * TRANSFER_EVENT_TOPIC0 in src/services/sync/sync-common.ts.
 */
export const ERC20_TRANSFER_EVENT_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const DEFAULT_BATCH_SIZE = 500;

/**
 * Minimal structural client so tests can inject an in-memory double and the
 * production default stays the shared Prisma client.
 */
export type FabricatedTransferRepairClient = {
  rawTokenTransfer: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  rawLog: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

/**
 * All three fields are required together: the RawTokenTransfer <-> RawLog
 * relationship is proven only by the full persisted unique identity
 * (chainId + txHash + logIndex + blockHash). Partial identity targeting is
 * ambiguous and is rejected.
 */
export type ExactTransferIdentity = {
  txHash: string;
  logIndex: number;
  blockHash: string;
};

export type RepairFabricatedTokenTransfersArgs = {
  /** Default false: dry-run/read-only. Mutations require apply: true. */
  apply?: boolean;
  /** Required when apply is true; required whenever identity is supplied. */
  chainId?: number;
  /** Optional exact-row targeting. All fields required together. */
  identity?: ExactTransferIdentity;
  batchSize?: number;
};

export type FabricatedTransferIdentityReport = {
  transferId: string;
  rawLogId: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
};

export type SkippedTransferReason =
  | "missing-backing-log"
  | "inactive-backing-log"
  | "ambiguous-identity";

export type SkippedTransferReport = {
  transferId: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
  reason: SkippedTransferReason;
};

export type FabricatedTransferRepairReport = {
  apply: boolean;
  chainId: number | null;
  scannedActiveTransfers: number;
  genuineTransfers: number;
  provenFabricatedTransfers: number;
  /** Actual rows changed, taken from the updateMany result — 0 in dry-run. */
  changedTransfers: number;
  missingBackingLog: number;
  inactiveBackingLog: number;
  ambiguousIdentity: number;
  /**
   * Rows matching the exact identity filter whose status is already not
   * ACTIVE. Only populated in identity-targeted mode; the batch scan never
   * reads non-ACTIVE rows by design.
   */
  alreadyInvalidatedTransfers: number;
  fabricated: FabricatedTransferIdentityReport[];
  skipped: SkippedTransferReport[];
};

type TransferScanRecord = {
  id: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
};

type BackingLogRecord = {
  id: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
  topic0: string | null;
  status: string;
};

function identityKey(record: {
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
}) {
  return `${record.chainId}|${record.txHash.toLowerCase()}|${record.logIndex}|${record.blockHash.toLowerCase()}`;
}

function toTransferScanRecord(record: Record<string, unknown>): TransferScanRecord {
  return {
    id: record.id as string,
    chainId: record.chainId as number,
    txHash: record.txHash as string,
    logIndex: record.logIndex as number,
    blockHash: record.blockHash as string,
  };
}

function toBackingLogRecord(record: Record<string, unknown>): BackingLogRecord {
  return {
    id: record.id as string,
    chainId: record.chainId as number,
    txHash: record.txHash as string,
    logIndex: record.logIndex as number,
    blockHash: record.blockHash as string,
    topic0: (record.topic0 as string | null | undefined) ?? null,
    status: record.status as string,
  };
}

function validateArgs(args: RepairFabricatedTokenTransfersArgs) {
  if (args.apply === true && typeof args.chainId !== "number") {
    throw new Error(
      "repair-fabricated-token-transfers: apply mode requires an explicit chainId scope; refusing a globally unscoped mutation.",
    );
  }

  if (args.identity !== undefined) {
    const { txHash, logIndex, blockHash } = args.identity;
    const txHashValid = typeof txHash === "string" && txHash.length > 0;
    const logIndexValid = Number.isInteger(logIndex) && logIndex >= 0;
    const blockHashValid = typeof blockHash === "string" && blockHash.length > 0;

    if (!txHashValid || !logIndexValid || !blockHashValid) {
      throw new Error(
        "repair-fabricated-token-transfers: exact identity targeting requires txHash, logIndex, and blockHash together; partial identity is ambiguous.",
      );
    }

    if (typeof args.chainId !== "number") {
      throw new Error(
        "repair-fabricated-token-transfers: exact identity targeting requires chainId; the unique raw identity is chainId + txHash + logIndex + blockHash.",
      );
    }
  }
}

/**
 * Scans ACTIVE RawTokenTransfer rows and marks as REORGED only the rows that
 * are provably fabricated: their exact backing RawLog (matched on the full
 * persisted unique identity chainId + txHash + logIndex + blockHash) is
 * ACTIVE and its topic0 is definitively not the ERC-20 Transfer signature.
 * These rows were produced by the pre-PR-#326 decoder, which decoded
 * non-Transfer events (e.g. HEX StakeStart) as ERC-20 Transfers.
 *
 * Never deletes rows. Never touches RawLog. Reuses the same status mechanism
 * as markRawDataRangeReorged. Conservative by construction:
 * - missing backing RawLog        -> skipped, no mutation
 * - non-ACTIVE backing RawLog     -> skipped, no mutation (reorg-status
 *   inconsistency is a separate concern; a REORGED log is not used as proof)
 * - duplicate identity match      -> skipped, no mutation
 * - Transfer-signature topic0     -> genuine, untouched
 *
 * Idempotent: only ACTIVE transfers are scanned and the update carries an
 * ACTIVE status guard, so a second apply run changes zero rows.
 */
export async function repairFabricatedTokenTransfers(
  args: RepairFabricatedTokenTransfersArgs = {},
  client: FabricatedTransferRepairClient = getDb() as unknown as FabricatedTransferRepairClient,
): Promise<FabricatedTransferRepairReport> {
  validateArgs(args);

  const apply = args.apply === true;
  const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;

  const identityWhere =
    args.identity === undefined
      ? {}
      : {
          txHash: args.identity.txHash.toLowerCase(),
          logIndex: args.identity.logIndex,
          blockHash: args.identity.blockHash.toLowerCase(),
        };

  const baseWhere = {
    status: "ACTIVE",
    ...(typeof args.chainId === "number" ? { chainId: args.chainId } : {}),
    ...identityWhere,
  };

  const report: FabricatedTransferRepairReport = {
    apply,
    chainId: typeof args.chainId === "number" ? args.chainId : null,
    scannedActiveTransfers: 0,
    genuineTransfers: 0,
    provenFabricatedTransfers: 0,
    changedTransfers: 0,
    missingBackingLog: 0,
    inactiveBackingLog: 0,
    ambiguousIdentity: 0,
    alreadyInvalidatedTransfers: 0,
    fabricated: [],
    skipped: [],
  };

  // Identity mode: also report rows already invalidated by a previous run so
  // a second apply is visibly idempotent instead of silently matching nothing.
  if (args.identity !== undefined) {
    const allMatches = await client.rawTokenTransfer.findMany({
      where: {
        ...(typeof args.chainId === "number" ? { chainId: args.chainId } : {}),
        ...identityWhere,
      },
      select: { id: true, status: true },
    });
    report.alreadyInvalidatedTransfers = allMatches.filter(
      (record) => record.status !== "ACTIVE",
    ).length;
  }

  let cursorId: string | null = null;

  for (;;) {
    const batchRaw = await client.rawTokenTransfer.findMany({
      where: {
        ...baseWhere,
        ...(cursorId === null ? {} : { id: { gt: cursorId } }),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        chainId: true,
        txHash: true,
        logIndex: true,
        blockHash: true,
      },
    });

    if (batchRaw.length === 0) {
      break;
    }

    const batch = batchRaw.map(toTransferScanRecord);
    report.scannedActiveTransfers += batch.length;

    const txHashes = [...new Set(batch.map((transfer) => transfer.txHash))];
    const backingLogsRaw = await client.rawLog.findMany({
      where: { txHash: { in: txHashes } },
      select: {
        id: true,
        chainId: true,
        txHash: true,
        logIndex: true,
        blockHash: true,
        topic0: true,
        status: true,
      },
    });

    const backingLogsByIdentity = new Map<string, BackingLogRecord[]>();
    for (const raw of backingLogsRaw) {
      const log = toBackingLogRecord(raw);
      const key = identityKey(log);
      const existing = backingLogsByIdentity.get(key);
      if (existing) {
        existing.push(log);
      } else {
        backingLogsByIdentity.set(key, [log]);
      }
    }

    const fabricatedIdsInBatch: string[] = [];

    for (const transfer of batch) {
      const matches = backingLogsByIdentity.get(identityKey(transfer)) ?? [];

      if (matches.length === 0) {
        report.missingBackingLog += 1;
        report.skipped.push({
          transferId: transfer.id,
          chainId: transfer.chainId,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          blockHash: transfer.blockHash,
          reason: "missing-backing-log",
        });
        continue;
      }

      if (matches.length > 1) {
        report.ambiguousIdentity += 1;
        report.skipped.push({
          transferId: transfer.id,
          chainId: transfer.chainId,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          blockHash: transfer.blockHash,
          reason: "ambiguous-identity",
        });
        continue;
      }

      const backingLog = matches[0];

      if (backingLog.status !== "ACTIVE") {
        report.inactiveBackingLog += 1;
        report.skipped.push({
          transferId: transfer.id,
          chainId: transfer.chainId,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          blockHash: transfer.blockHash,
          reason: "inactive-backing-log",
        });
        continue;
      }

      // The ERC-20 Transfer event is non-anonymous: its signature hash is
      // always topic0. A null topic0 therefore also proves the source event
      // was not an ERC-20 Transfer.
      const isGenuineTransfer =
        backingLog.topic0 !== null &&
        backingLog.topic0.toLowerCase() === ERC20_TRANSFER_EVENT_TOPIC0;

      if (isGenuineTransfer) {
        report.genuineTransfers += 1;
        continue;
      }

      report.provenFabricatedTransfers += 1;
      report.fabricated.push({
        transferId: transfer.id,
        rawLogId: backingLog.id,
        chainId: transfer.chainId,
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        blockHash: transfer.blockHash,
      });
      fabricatedIdsInBatch.push(transfer.id);
    }

    if (apply && fabricatedIdsInBatch.length > 0) {
      // The ACTIVE guard makes the mutation idempotent and safe against rows
      // invalidated between scan and update. The reported changed count comes
      // from the actual update result, never from the candidate count.
      const updated = await client.rawTokenTransfer.updateMany({
        where: {
          id: { in: fabricatedIdsInBatch },
          status: "ACTIVE",
        },
        data: {
          status: "REORGED",
        },
      });
      report.changedTransfers += updated.count;
    }

    if (batchRaw.length < batchSize) {
      break;
    }
    cursorId = batch[batch.length - 1].id;
  }

  return report;
}
