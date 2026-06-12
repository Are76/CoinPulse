import "server-only";

import { SourceFamily } from "@prisma/client";

import { getDb } from "@/lib/db";

const PULSECHAIN_CHAIN_ID = 369;

// ─── DB interface ─────────────────────────────────────────────────────────────

// canonicalPayload is fetched from DB for internal payload shape validation
// only. It is never included in the returned ObservationEvidenceMetadata.
type ObservationRow = {
  id: string;
  chainId: number;
  sourceFamily: SourceFamily;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: bigint;
  observedAt: Date;
  payloadVersion: string;
  canonicalPayload: string;
  warnings: string[];
};

type EvidenceProviderClient = {
  rawHexDailyDataObservation: {
    findFirst(args: {
      where: {
        chainId: number;
        sourceFamily: SourceFamily;
        rangeStartDay: number;
        rangeEndDay: number;
      };
      select: {
        id: true;
        chainId: true;
        sourceFamily: true;
        rangeStartDay: true;
        rangeEndDay: true;
        observedAtBlock: true;
        observedAt: true;
        payloadVersion: true;
        canonicalPayload: true;
        warnings: true;
      };
      orderBy: { observedAtBlock: "desc" };
    }): Promise<ObservationRow | null>;
  };
  rawHexDailyDataObservationInvalidation: {
    findFirst(args: {
      where: { observationId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

// ─── Public types ─────────────────────────────────────────────────────────────

// Safe observation evidence metadata returned by the provider.
// canonicalPayload, payloadHash, and rawDailyData are never present.
export type ObservationEvidenceMetadata = {
  observationId: string;
  chainId: number;
  sourceFamily: "HEXMINING";
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: string;
  observedAt: string;
  payloadVersion: string;
  payloadSchemaValid: boolean;
  isInvalidated: boolean;
  warnings: string[];
};

// Internal estimator dependency shape. This is intentionally separate from
// ObservationEvidenceMetadata so public provider callers continue to receive
// safe metadata without canonicalPayload.
export type ObservationEvidenceWithPayload = ObservationEvidenceMetadata & {
  canonicalPayload: string;
};

export type GetObservationEvidenceArgs = {
  chainId: number;
  rangeStartDay: number;
  rangeEndDay: number;
};

export type EvidenceProviderDeps = {
  db?: EvidenceProviderClient;
};

// ─── Internal payload validation ─────────────────────────────────────────────

function rejectNumericJsonValues(value: unknown): void {
  if (typeof value === "number") throw new Error("numeric-value");
  if (Array.isArray(value)) {
    for (const item of value) rejectNumericJsonValues(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      rejectNumericJsonValues(v);
    }
  }
}

function isPayloadSchemaValid(canonicalPayload: string): boolean {
  try {
    const parsed = JSON.parse(canonicalPayload);
    rejectNumericJsonValues(parsed);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).schemaVersion === "string" &&
      Array.isArray((parsed as Record<string, unknown>).dailyData)
    );
  } catch {
    return false;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export async function getObservationEvidenceForRange(
  args: GetObservationEvidenceArgs,
  deps: EvidenceProviderDeps = {},
): Promise<ObservationEvidenceMetadata | null> {
  return getObservationEvidence(args, deps, false);
}

export async function getObservationEvidenceWithPayloadForRange(
  args: GetObservationEvidenceArgs,
  deps: EvidenceProviderDeps = {},
): Promise<ObservationEvidenceWithPayload | null> {
  return getObservationEvidence(args, deps, true);
}

async function getObservationEvidence(
  args: GetObservationEvidenceArgs,
  deps: EvidenceProviderDeps,
  includePayload: false,
): Promise<ObservationEvidenceMetadata | null>;
async function getObservationEvidence(
  args: GetObservationEvidenceArgs,
  deps: EvidenceProviderDeps,
  includePayload: true,
): Promise<ObservationEvidenceWithPayload | null>;
async function getObservationEvidence(
  args: GetObservationEvidenceArgs,
  deps: EvidenceProviderDeps,
  includePayload: boolean,
): Promise<
  ObservationEvidenceMetadata | ObservationEvidenceWithPayload | null
> {
  if (args.chainId !== PULSECHAIN_CHAIN_ID) return null;

  const db = deps.db ?? getDb();

  const row = await db.rawHexDailyDataObservation.findFirst({
    where: {
      chainId: args.chainId,
      sourceFamily: SourceFamily.HEXMINING,
      rangeStartDay: args.rangeStartDay,
      rangeEndDay: args.rangeEndDay,
    },
    select: {
      id: true,
      chainId: true,
      sourceFamily: true,
      rangeStartDay: true,
      rangeEndDay: true,
      observedAtBlock: true,
      observedAt: true,
      payloadVersion: true,
      canonicalPayload: true,
      warnings: true,
    },
    orderBy: { observedAtBlock: "desc" },
  });

  if (row === null) return null;

  const invalidation =
    await db.rawHexDailyDataObservationInvalidation.findFirst({
      where: { observationId: row.id },
      select: { id: true },
    });

  const metadata: ObservationEvidenceMetadata = {
    observationId: row.id,
    chainId: row.chainId,
    sourceFamily: "HEXMINING",
    rangeStartDay: row.rangeStartDay,
    rangeEndDay: row.rangeEndDay,
    observedAtBlock: row.observedAtBlock.toString(),
    observedAt: row.observedAt.toISOString(),
    payloadVersion: row.payloadVersion,
    payloadSchemaValid: isPayloadSchemaValid(row.canonicalPayload),
    isInvalidated: invalidation !== null,
    warnings: row.warnings,
  };

  if (!includePayload) return metadata;

  return {
    ...metadata,
    canonicalPayload: row.canonicalPayload,
  };
}
