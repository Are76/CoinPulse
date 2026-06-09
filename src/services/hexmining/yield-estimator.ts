import "server-only";

const PULSECHAIN_CHAIN_ID = 369;

// ─── Evidence type ────────────────────────────────────────────────────────────

export type ObservationEvidence = {
  observationId: string;
  rangeStartDay: number;
  rangeEndDay: number;
  canonicalPayload: string;
  warnings: string[];
};

// ─── Deps ─────────────────────────────────────────────────────────────────────

export type HexMiningYieldEstimatorDeps = {
  fetchEvidence: (args: {
    chainId: number;
    rangeStartDay: number;
    rangeEndDay: number;
  }) => Promise<ObservationEvidence | null>;
};

// ─── Args ─────────────────────────────────────────────────────────────────────

export type HexMiningYieldEstimateArgs = {
  chainId: number;
  stakeId: string;
  lockedDay: number;
  stakedDays: number;
  currentDay: number;
  rangeStartDay: number;
  rangeEndDay: number;
};

// ─── Result ───────────────────────────────────────────────────────────────────

export type HexMiningYieldEstimateProvenance = {
  chainId: number;
  sourceFamily: "HEXMINING";
  observationId: string | null;
  rangeStartDay: number | null;
  rangeEndDay: number | null;
};

export type HexMiningYieldEstimateResult =
  | {
      status: "estimated";
      schemaVersion: "v1";
      yieldHex: string;
      provenance: HexMiningYieldEstimateProvenance;
      warnings: string[];
    }
  | {
      status: "insufficient_observations" | "invalid_observation" | "unavailable" | "unsupported";
      schemaVersion: "v1";
      yieldHex: null;
      provenance: HexMiningYieldEstimateProvenance;
      warnings: string[];
    };

// ─── Payload validation ───────────────────────────────────────────────────────

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

function validatePayloadShape(canonicalPayload: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalPayload);
  } catch {
    throw new Error("invalid-json");
  }
  rejectNumericJsonValues(parsed);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).schemaVersion !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>).dailyData)
  ) {
    throw new Error("invalid-shape");
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function estimateHexMiningYield(
  args: HexMiningYieldEstimateArgs,
  deps: HexMiningYieldEstimatorDeps,
): Promise<HexMiningYieldEstimateResult> {
  // 1. Chain guard
  if (args.chainId !== PULSECHAIN_CHAIN_ID) {
    return {
      status: "unsupported",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: null,
        rangeStartDay: null,
        rangeEndDay: null,
      },
      warnings: [`hexmining-yield-unsupported-chain-${args.chainId}`],
    };
  }

  // 2. Fetch evidence via injected provider (no RPC)
  let evidence: ObservationEvidence | null;
  try {
    evidence = await deps.fetchEvidence({
      chainId: args.chainId,
      rangeStartDay: args.rangeStartDay,
      rangeEndDay: args.rangeEndDay,
    });
  } catch {
    return {
      status: "unavailable",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: null,
        rangeStartDay: args.rangeStartDay,
        rangeEndDay: args.rangeEndDay,
      },
      warnings: ["hexmining-yield-evidence-provider-failed"],
    };
  }

  // 3. No evidence available
  if (evidence === null) {
    return {
      status: "insufficient_observations",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: null,
        rangeStartDay: args.rangeStartDay,
        rangeEndDay: args.rangeEndDay,
      },
      warnings: ["hexmining-yield-no-observation-evidence"],
    };
  }

  // 4. Validate payload shape
  try {
    validatePayloadShape(evidence.canonicalPayload);
  } catch {
    return {
      status: "invalid_observation",
      schemaVersion: "v1",
      yieldHex: null,
      provenance: {
        chainId: args.chainId,
        sourceFamily: "HEXMINING",
        observationId: evidence.observationId,
        rangeStartDay: evidence.rangeStartDay,
        rangeEndDay: evidence.rangeEndDay,
      },
      warnings: ["hexmining-yield-invalid-observation-payload"],
    };
  }

  // 5. Yield formula deferred to Phase 4C implementation PR
  return {
    status: "insufficient_observations",
    schemaVersion: "v1",
    yieldHex: null,
    provenance: {
      chainId: args.chainId,
      sourceFamily: "HEXMINING",
      observationId: evidence.observationId,
      rangeStartDay: evidence.rangeStartDay,
      rangeEndDay: evidence.rangeEndDay,
    },
    warnings: [...evidence.warnings, "hexmining-yield-calculation-not-implemented"],
  };
}
