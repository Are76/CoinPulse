import "server-only";

import {
  persistHexDailyDataObservation,
  validateCanonicalPayload,
  type CreateRawHexDailyDataObservationInput,
} from "@/services/hexmining/observation-store";
import {
  readDailyDataRangeObservation,
  type ReadDailyDataRangeArgs,
} from "@/services/hexmining/daily-data-reader";

// ─── Canonical payload encoding ──────────────────────────────────────────────

// Payload version stored in each RawHexDailyDataObservation row.
export const DAILY_DATA_PAYLOAD_VERSION = "v1";

// Encodes raw viem bigint[] from dailyDataRange into a deterministic,
// bigint-safe JSON string compatible with validateCanonicalPayload (§11.8).
//
// Shape: { "schemaVersion": "v1", "dailyData": ["val0", "val1", ...] }
//
// Each uint72 element from viem is serialized as a base-10 decimal string.
// No numeric JSON values — always passes validateCanonicalPayload.
// Element order is preserved exactly (index N in rawDailyData → index N in output).
// The yield estimator (Phase 4C) unpacks the packed uint72 bits from these strings.
export function encodeDailyDataPayload(rawDailyData: readonly bigint[]): string {
  return JSON.stringify({
    schemaVersion: DAILY_DATA_PAYLOAD_VERSION,
    dailyData: rawDailyData.map((v) => v.toString(10)),
  });
}

// ─── Service types ────────────────────────────────────────────────────────────

export type AcquireAndPersistHexDailyDataArgs = ReadDailyDataRangeArgs;

export type AcquireAndPersistHexDailyDataResult =
  | {
      ok: true;
      observationId: string;
      rangeStartDay: number;
      rangeEndDay: number; // inclusive stored bound
      observedAtBlock: string; // bigint as decimal string
      observedAt: string; // ISO 8601
      warnings: string[];
    }
  | { ok: false; code: string; warnings: string[] };

// Injectable dependencies for testing. Defaults use the real implementations.
export type DailyDataObservationServiceDeps = {
  persistObservation?: (input: CreateRawHexDailyDataObservationInput) => Promise<{ id: string }>;
  validatePayload?: (payload: string) => void;
};

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Acquires a raw dailyDataRange observation via the Phase 4B read boundary,
 * encodes the viem bigint[] result to a deterministic decimal-string canonical
 * payload, validates it, and persists it through the existing persistence service.
 *
 * This is the Phase 4B wiring layer. It does not compute yield — canonical
 * payload interpretation is deferred to Phase 4C.
 */
export async function acquireAndPersistHexDailyDataObservation(
  args: AcquireAndPersistHexDailyDataArgs,
  deps: DailyDataObservationServiceDeps = {},
): Promise<AcquireAndPersistHexDailyDataResult> {
  const persistFn = deps.persistObservation ?? persistHexDailyDataObservation;
  const validateFn = deps.validatePayload ?? validateCanonicalPayload;

  // Step 1: Acquire raw dailyDataRange observation through the read boundary.
  const readResult = await readDailyDataRangeObservation(args);
  if (!readResult.ok) {
    return { ok: false, code: readResult.code, warnings: readResult.warnings };
  }
  const { observation } = readResult;

  // Step 2: Encode rawDailyData bigints to deterministic decimal-string canonical payload.
  const canonicalPayload = encodeDailyDataPayload(observation.rawDailyData);

  // Step 3: Validate canonical payload (§11.8 bigint-safe policy).
  // persistHexDailyDataObservation also validates internally, but catching it
  // here lets the service return a typed failure before reaching persistence.
  try {
    validateFn(canonicalPayload);
  } catch {
    return {
      ok: false,
      code: "hexmining-invalid-canonical-payload",
      warnings: ["hexmining-invalid-canonical-payload"],
    };
  }

  // Step 4: Persist through the existing persistence service.
  // persistHexDailyDataObservation enforces sourceFamily=HEXMINING, derives
  // payloadHash from canonicalPayload, and handles service-layer dedup
  // (findFirst before create — returns existing row id on match).
  // rangeEndDay is the inclusive stored bound, not rpcEndDay.
  let persisted: { id: string };
  try {
    persisted = await persistFn({
      chainId: observation.chainId,
      rangeStartDay: observation.rangeStartDay,
      rangeEndDay: observation.rangeEndDay,
      observedAtBlock: observation.observedAtBlock,
      observedAt: observation.observedAt,
      rpcEndpointLabel: observation.rpcEndpointLabel,
      payloadVersion: DAILY_DATA_PAYLOAD_VERSION,
      canonicalPayload,
      warnings: observation.warnings,
    });
  } catch {
    return {
      ok: false,
      code: "hexmining-persistence-failed",
      warnings: ["hexmining-persistence-failed"],
    };
  }

  return {
    ok: true,
    observationId: persisted.id,
    rangeStartDay: observation.rangeStartDay,
    rangeEndDay: observation.rangeEndDay,
    observedAtBlock: observation.observedAtBlock.toString(),
    observedAt: observation.observedAt.toISOString(),
    warnings: observation.warnings,
  };
}
