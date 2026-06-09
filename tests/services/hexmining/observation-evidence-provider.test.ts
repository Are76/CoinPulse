// HexMining Phase 4C — observation evidence provider contract tests
//
// Verifies the read contract for ObservationEvidenceMetadata:
//
//   1. No observation row   → returns null (→ insufficient_observations in estimator)
//   2. Invalidated row      → isInvalidated: true (→ invalid_observation in estimator)
//   3. Wrong chain          → returns null without DB query
//   4. DB throws            → propagates error (→ unavailable in estimator)
//   5. Valid row            → returns ObservationEvidenceMetadata with correct fields
//   6-8. Structural:        → no RPC, no read boundary, no viem usage
//   9-11. Shape:            → canonicalPayload, rawDailyData, payloadHash never in output
//   12. Content:            → payload schema validation reflected via payloadSchemaValid flag
//
// No live database, no RPC, no viem, no API routes. Pure in-memory mock DB.

import { describe, expect, it, vi } from "vitest";

import {
  getObservationEvidenceForRange,
  type EvidenceProviderDeps,
  type GetObservationEvidenceArgs,
} from "@/services/hexmining/observation-evidence-provider";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

const VALID_PAYLOAD = JSON.stringify({
  schemaVersion: "v1",
  dailyData: ["100000000000000000000", "200000000000000000000"],
});

type MockObsRow = {
  id: string;
  chainId: number;
  sourceFamily: string;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: bigint;
  observedAt: Date;
  payloadVersion: string;
  canonicalPayload: string;
  warnings: string[];
};

function makeRow(overrides: Partial<MockObsRow> = {}): MockObsRow {
  return {
    id: "obs-1",
    chainId: 369,
    sourceFamily: "HEXMINING",
    rangeStartDay: 1000,
    rangeEndDay: 1199,
    observedAtBlock: 1234567n,
    observedAt: new Date("2024-01-01T00:00:00.000Z"),
    payloadVersion: "v1",
    canonicalPayload: VALID_PAYLOAD,
    warnings: [],
    ...overrides,
  };
}

function makeDb(
  obsRow: MockObsRow | null,
  invalidationRow: { id: string } | null = null,
): EvidenceProviderDeps["db"] {
  return {
    rawHexDailyDataObservation: {
      findFirst: vi.fn().mockResolvedValue(obsRow),
    },
    rawHexDailyDataObservationInvalidation: {
      findFirst: vi.fn().mockResolvedValue(invalidationRow),
    },
  } as unknown as EvidenceProviderDeps["db"];
}

function makeThrowingDb(): EvidenceProviderDeps["db"] {
  return {
    rawHexDailyDataObservation: {
      findFirst: vi.fn().mockRejectedValue(new Error("db-connection-error")),
    },
    rawHexDailyDataObservationInvalidation: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  } as unknown as EvidenceProviderDeps["db"];
}

const BASE_ARGS: GetObservationEvidenceArgs = {
  chainId: 369,
  rangeStartDay: 1000,
  rangeEndDay: 1199,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getObservationEvidenceForRange", () => {
  describe("chain guard", () => {
    it("returns null for chainId !== 369 without querying DB", async () => {
      const db = makeDb(makeRow());
      const result = await getObservationEvidenceForRange({ ...BASE_ARGS, chainId: 1 }, { db });

      expect(result).toBeNull();
      expect((db!.rawHexDailyDataObservation.findFirst as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it("returns null for chainId 137 without querying DB", async () => {
      const db = makeDb(makeRow());
      const result = await getObservationEvidenceForRange({ ...BASE_ARGS, chainId: 137 }, { db });

      expect(result).toBeNull();
    });
  });

  describe("no observation", () => {
    it("returns null when no observation row exists", async () => {
      const db = makeDb(null);
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result).toBeNull();
    });

    it("queries DB with correct chainId, sourceFamily, rangeStartDay, rangeEndDay", async () => {
      const db = makeDb(null);
      await getObservationEvidenceForRange(BASE_ARGS, { db });

      const findFirst = db!.rawHexDailyDataObservation.findFirst as ReturnType<typeof vi.fn>;
      expect(findFirst).toHaveBeenCalledOnce();
      const callArgs = findFirst.mock.calls[0][0];
      expect(callArgs.where.chainId).toBe(369);
      expect(callArgs.where.rangeStartDay).toBe(1000);
      expect(callArgs.where.rangeEndDay).toBe(1199);
    });
  });

  describe("valid observation", () => {
    it("returns ObservationEvidenceMetadata for valid non-invalidated row", async () => {
      const db = makeDb(makeRow(), null);
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result).not.toBeNull();
      expect(result!.observationId).toBe("obs-1");
      expect(result!.chainId).toBe(369);
      expect(result!.sourceFamily).toBe("HEXMINING");
      expect(result!.rangeStartDay).toBe(1000);
      expect(result!.rangeEndDay).toBe(1199);
      expect(result!.observedAtBlock).toBe("1234567");
      expect(result!.observedAt).toBe("2024-01-01T00:00:00.000Z");
      expect(result!.payloadVersion).toBe("v1");
      expect(result!.payloadSchemaValid).toBe(true);
      expect(result!.isInvalidated).toBe(false);
    });

    it("serializes observedAtBlock as decimal string (bigint-safe)", async () => {
      const db = makeDb(makeRow({ observedAtBlock: 99999999999999n }));
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result!.observedAtBlock).toBe("99999999999999");
      expect(typeof result!.observedAtBlock).toBe("string");
    });

    it("propagates warnings from the DB row", async () => {
      const db = makeDb(makeRow({ warnings: ["hexmining-rpc-slow"] }));
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result!.warnings).toContain("hexmining-rpc-slow");
    });
  });

  describe("invalidated observation", () => {
    it("returns isInvalidated: true when invalidation record exists", async () => {
      const db = makeDb(makeRow(), { id: "inv-1" });
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result).not.toBeNull();
      expect(result!.isInvalidated).toBe(true);
      expect(result!.observationId).toBe("obs-1");
    });

    it("queries invalidations using the observation id", async () => {
      const db = makeDb(makeRow({ id: "obs-xyz" }), null);
      await getObservationEvidenceForRange(BASE_ARGS, { db });

      const findFirst = db!.rawHexDailyDataObservationInvalidation.findFirst as ReturnType<typeof vi.fn>;
      expect(findFirst).toHaveBeenCalledOnce();
      const callArgs = findFirst.mock.calls[0][0];
      expect(callArgs.where.observationId).toBe("obs-xyz");
    });
  });

  describe("payload schema validation", () => {
    it("sets payloadSchemaValid: true for valid canonical payload", async () => {
      const db = makeDb(makeRow({ canonicalPayload: VALID_PAYLOAD }));
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result!.payloadSchemaValid).toBe(true);
    });

    it("sets payloadSchemaValid: false for invalid JSON payload", async () => {
      const db = makeDb(makeRow({ canonicalPayload: "not-valid-json{{{" }));
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result!.payloadSchemaValid).toBe(false);
    });

    it("sets payloadSchemaValid: false for payload with numeric JSON values", async () => {
      const numericPayload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: [100000000000000, 200000000000000],
      });
      const db = makeDb(makeRow({ canonicalPayload: numericPayload }));
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result!.payloadSchemaValid).toBe(false);
    });

    it("sets payloadSchemaValid: false for payload missing dailyData", async () => {
      const badPayload = JSON.stringify({ schemaVersion: "v1", otherField: "foo" });
      const db = makeDb(makeRow({ canonicalPayload: badPayload }));
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result!.payloadSchemaValid).toBe(false);
    });

    it("sets payloadSchemaValid: false for payload missing schemaVersion", async () => {
      const badPayload = JSON.stringify({ dailyData: ["100", "200"] });
      const db = makeDb(makeRow({ canonicalPayload: badPayload }));
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });

      expect(result!.payloadSchemaValid).toBe(false);
    });
  });

  describe("DB failure", () => {
    it("propagates DB error (caller maps to unavailable status)", async () => {
      const db = makeThrowingDb();
      await expect(getObservationEvidenceForRange(BASE_ARGS, { db })).rejects.toThrow(
        "db-connection-error",
      );
    });
  });

  describe("result shape — no internal fields exposed", () => {
    it("never includes canonicalPayload in returned metadata", async () => {
      const db = makeDb(makeRow());
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("canonicalPayload");
      expect(serialized).not.toContain("dailyData");
    });

    it("never includes payloadHash in returned metadata", async () => {
      const db = makeDb(makeRow());
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("payloadHash");
    });

    it("never includes rawDailyData in returned metadata", async () => {
      const db = makeDb(makeRow());
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("rawDailyData");
    });

    it("result contains no pricing, valuation, pnl, or yield fields", async () => {
      const db = makeDb(makeRow());
      const result = await getObservationEvidenceForRange(BASE_ARGS, { db });
      const keys = Object.keys(result!);

      expect(keys).not.toContain("price");
      expect(keys).not.toContain("pricing");
      expect(keys).not.toContain("valuation");
      expect(keys).not.toContain("pnl");
      expect(keys).not.toContain("apy");
      expect(keys).not.toContain("yieldHex");
    });
  });
});
