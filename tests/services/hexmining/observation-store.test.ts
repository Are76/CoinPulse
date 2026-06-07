// HexMining Phase 4 — observation persistence service contract tests
//
// Verifies the write contract for RawHexDailyDataObservation persistence:
//
//   1. validateCanonicalPayload rejects numeric JSON values anywhere in the
//      payload structure (§11.8 bigint-safe encoding policy).
//   2. computePayloadHash produces a deterministic 64-char SHA-256 hex digest.
//   3. persistHexDailyDataObservation always writes sourceFamily=HEXMINING —
//      callers cannot override it (enforced by both the input type and the service).
//   4. persistHexDailyDataObservation derives payloadHash from canonicalPayload —
//      callers cannot supply a pre-computed hash.
//   5. Optional fields default correctly (warnings → [], rpcEndpointLabel → null).
//   6. persistHexDailyDataObservationInvalidation writes only the reference id —
//      the original observation row is never mutated (append-only guarantee).
//   7. Compile-time guards: type-level conditionals confirm that sourceFamily
//      and payloadHash are absent from the caller's input type.
//
// No live database, no RPC, no viem, no API routes. Pure in-memory mock DB.
//
// See docs/v2-hexmining-roadmap.md §11.8–11.10 for the full policy.

import { describe, expect, it, vi } from "vitest";

import { SourceFamily } from "@prisma/client";

import {
  computePayloadHash,
  persistHexDailyDataObservation,
  persistHexDailyDataObservationInvalidation,
  validateCanonicalPayload,
  type CreateRawHexDailyDataObservationInput,
  type CreateRawHexDailyDataObservationInvalidationInput,
} from "@/services/hexmining/observation-store";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

// Captures the data written to each table in a typed array so tests can
// inspect exactly what the service persists without relying on vi.fn's
// inferred tuple type for mock.calls.

type ObsCreateArg = { data: Record<string, unknown> };
type InvCreateArg = { data: Record<string, unknown> };

function createMockDb() {
  let idCounter = 0;
  const obsCalls: ObsCreateArg[] = [];
  const invCalls: InvCreateArg[] = [];

  const db = {
    rawHexDailyDataObservation: {
      create: vi.fn((args: ObsCreateArg) => {
        obsCalls.push(args);
        return Promise.resolve({ id: `obs_${++idCounter}` });
      }),
    },
    rawHexDailyDataObservationInvalidation: {
      create: vi.fn((args: InvCreateArg) => {
        invCalls.push(args);
        return Promise.resolve({ id: `inv_${++idCounter}` });
      }),
    },
  };

  return { db, obsCalls, invCalls };
}

// ─── Minimal valid observation input ─────────────────────────────────────────

const BASE_OBS: CreateRawHexDailyDataObservationInput = {
  chainId: 369,
  rangeStartDay: 1000,
  rangeEndDay: 1099,
  observedAtBlock: BigInt("23456789"),
  observedAt: new Date("2026-06-06T00:00:00.000Z"),
  payloadVersion: "v1",
  canonicalPayload: JSON.stringify([
    { dayPayoutTotal: "123456789012345678", dayStakeSharesTotal: "9876543210", dayUnclaimedSatoshisTotal: "0" },
  ]),
};

// ─── 1. validateCanonicalPayload ──────────────────────────────────────────────

describe("validateCanonicalPayload", () => {
  // ── valid payloads ──────────────────────────────────────────────────────────

  it("accepts an empty array payload", () => {
    expect(() => validateCanonicalPayload("[]")).not.toThrow();
  });

  it("accepts a payload with decimal-string numeric values (canonical form)", () => {
    const payload = JSON.stringify([
      { dayPayoutTotal: "123456789012345678", dayStakeSharesTotal: "9876543210", dayUnclaimedSatoshisTotal: "0" },
    ]);
    expect(() => validateCanonicalPayload(payload)).not.toThrow();
  });

  it("accepts payloads containing boolean values", () => {
    expect(() => validateCanonicalPayload(JSON.stringify([{ active: true }]))).not.toThrow();
  });

  it("accepts payloads containing null values", () => {
    expect(() => validateCanonicalPayload(JSON.stringify([{ field: null }]))).not.toThrow();
  });

  it("accepts payloads containing nested objects with only string values", () => {
    const payload = JSON.stringify([{ meta: { source: "pulsechain-primary", version: "v1" } }]);
    expect(() => validateCanonicalPayload(payload)).not.toThrow();
  });

  // ── invalid payloads: numeric values ───────────────────────────────────────

  it("rejects a payload with a top-level numeric value in an object", () => {
    const payload = JSON.stringify([{ dayPayoutTotal: 123456789 }]);
    expect(() => validateCanonicalPayload(payload)).toThrow(
      "Non-canonical payload: numeric JSON values are not allowed. Use decimal-string encoding.",
    );
  });

  it("rejects a payload with a numeric value in a nested object", () => {
    const payload = JSON.stringify([{ meta: { count: 5 } }]);
    expect(() => validateCanonicalPayload(payload)).toThrow(
      "Non-canonical payload: numeric JSON values are not allowed.",
    );
  });

  it("rejects a payload with a numeric value in a nested array", () => {
    const payload = JSON.stringify([{ values: [1, 2, 3] }]);
    expect(() => validateCanonicalPayload(payload)).toThrow(
      "Non-canonical payload: numeric JSON values are not allowed.",
    );
  });

  it("rejects a payload that is a bare JSON number", () => {
    expect(() => validateCanonicalPayload("42")).toThrow(
      "Non-canonical payload: numeric JSON values are not allowed.",
    );
  });

  it("rejects a payload containing 0 as a number (not the string \"0\")", () => {
    const payload = JSON.stringify([{ dayUnclaimedSatoshisTotal: 0 }]);
    expect(() => validateCanonicalPayload(payload)).toThrow(
      "Non-canonical payload: numeric JSON values are not allowed.",
    );
  });

  // ── invalid payloads: malformed JSON ───────────────────────────────────────

  it("rejects malformed JSON", () => {
    expect(() => validateCanonicalPayload("not json")).toThrow(
      "Non-canonical payload: invalid JSON.",
    );
  });

  it("rejects empty string (not valid JSON)", () => {
    expect(() => validateCanonicalPayload("")).toThrow(
      "Non-canonical payload: invalid JSON.",
    );
  });
});

// ─── 2. computePayloadHash ──────────────────────────────────────────────────

describe("computePayloadHash", () => {
  it("returns a 64-character lowercase hex string (SHA-256 digest)", () => {
    const hash = computePayloadHash("[]");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same payload always produces the same hash", () => {
    const payload = JSON.stringify([{ dayPayoutTotal: "123" }]);
    expect(computePayloadHash(payload)).toBe(computePayloadHash(payload));
  });

  it("produces different hashes for different payloads", () => {
    expect(computePayloadHash("[]")).not.toBe(computePayloadHash("[{}]"));
    expect(computePayloadHash(JSON.stringify([{ dayPayoutTotal: "111" }]))).not.toBe(
      computePayloadHash(JSON.stringify([{ dayPayoutTotal: "222" }])),
    );
  });

  it("is sensitive to character-level differences", () => {
    expect(computePayloadHash('{"a":"1"}')).not.toBe(computePayloadHash('{"a":"2"}'));
  });
});

// ─── 2. persistHexDailyDataObservation — sourceFamily enforcement ─────────────

describe("persistHexDailyDataObservation — sourceFamily enforcement", () => {
  it("always writes sourceFamily=HEXMINING regardless of other fields", async () => {
    const { db, obsCalls } = createMockDb();
    await persistHexDailyDataObservation(BASE_OBS, db);

    expect(obsCalls[0]!.data.sourceFamily).toBe(SourceFamily.HEXMINING);
    expect(obsCalls[0]!.data.sourceFamily).toBe("HEXMINING");
  });

  it("compile-time guard: sourceFamily is absent from CreateRawHexDailyDataObservationInput", () => {
    // Resolves to `true` iff sourceFamily is NOT in the input type.
    // If sourceFamily were ever added, this becomes `never` and the
    // assignment fails at compile time.
    type Guard = "sourceFamily" extends keyof CreateRawHexDailyDataObservationInput
      ? never
      : true;
    const guard: Guard = true;
    expect(guard).toBe(true);
  });
});

// ─── 3. persistHexDailyDataObservation — payloadHash derivation ───────────────

describe("persistHexDailyDataObservation — payloadHash derivation", () => {
  it("writes payloadHash derived from canonicalPayload", async () => {
    const { db, obsCalls } = createMockDb();
    await persistHexDailyDataObservation(BASE_OBS, db);

    expect(obsCalls[0]!.data.payloadHash).toBe(computePayloadHash(BASE_OBS.canonicalPayload));
  });

  it("payloadHash changes when canonicalPayload changes", async () => {
    const payloadA = JSON.stringify([{ dayPayoutTotal: "111" }]);
    const payloadB = JSON.stringify([{ dayPayoutTotal: "222" }]);

    const mockA = createMockDb();
    const mockB = createMockDb();

    await persistHexDailyDataObservation({ ...BASE_OBS, canonicalPayload: payloadA }, mockA.db);
    await persistHexDailyDataObservation({ ...BASE_OBS, canonicalPayload: payloadB }, mockB.db);

    expect(mockA.obsCalls[0]!.data.payloadHash).not.toBe(mockB.obsCalls[0]!.data.payloadHash);
  });

  it("compile-time guard: payloadHash is absent from CreateRawHexDailyDataObservationInput", () => {
    type Guard = "payloadHash" extends keyof CreateRawHexDailyDataObservationInput
      ? never
      : true;
    const guard: Guard = true;
    expect(guard).toBe(true);
  });
});

// ─── 4. persistHexDailyDataObservation — optional field defaults ──────────────

describe("persistHexDailyDataObservation — optional field defaults", () => {
  it("defaults warnings to an empty array when not provided", async () => {
    const { db, obsCalls } = createMockDb();
    await persistHexDailyDataObservation(
      {
        chainId: 369,
        rangeStartDay: 1000,
        rangeEndDay: 1099,
        observedAtBlock: BigInt("23456789"),
        observedAt: new Date("2026-06-06T00:00:00.000Z"),
        payloadVersion: "v1",
        canonicalPayload: BASE_OBS.canonicalPayload,
        // warnings intentionally omitted
      },
      db,
    );
    expect(obsCalls[0]!.data.warnings).toEqual([]);
  });

  it("passes warnings through when provided", async () => {
    const { db, obsCalls } = createMockDb();
    const warnings = ["hexmining-yield-rpc-rate-limited", "hexmining-yield-data-gap-day-500"];
    await persistHexDailyDataObservation({ ...BASE_OBS, warnings }, db);

    expect(obsCalls[0]!.data.warnings).toEqual(warnings);
  });

  it("defaults rpcEndpointLabel to null when not provided", async () => {
    const { db, obsCalls } = createMockDb();
    await persistHexDailyDataObservation(
      {
        chainId: 369,
        rangeStartDay: 1000,
        rangeEndDay: 1099,
        observedAtBlock: BigInt("23456789"),
        observedAt: new Date("2026-06-06T00:00:00.000Z"),
        payloadVersion: "v1",
        canonicalPayload: BASE_OBS.canonicalPayload,
        // rpcEndpointLabel intentionally omitted
      },
      db,
    );
    expect(obsCalls[0]!.data.rpcEndpointLabel).toBeNull();
  });

  it("passes rpcEndpointLabel through when provided", async () => {
    const { db, obsCalls } = createMockDb();
    await persistHexDailyDataObservation(
      { ...BASE_OBS, rpcEndpointLabel: "pulsechain-primary" },
      db,
    );
    expect(obsCalls[0]!.data.rpcEndpointLabel).toBe("pulsechain-primary");
  });

  it("coerces explicit null rpcEndpointLabel to null", async () => {
    const { db, obsCalls } = createMockDb();
    await persistHexDailyDataObservation({ ...BASE_OBS, rpcEndpointLabel: null }, db);
    expect(obsCalls[0]!.data.rpcEndpointLabel).toBeNull();
  });

  it("returns the id generated by the DB layer", async () => {
    const { db } = createMockDb();
    const result = await persistHexDailyDataObservation(BASE_OBS, db);
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("string");
  });

  it("throws and does not call create when canonicalPayload contains a numeric value", async () => {
    const { db, obsCalls } = createMockDb();
    const invalidPayload = JSON.stringify([{ dayPayoutTotal: 123456789 }]);

    await expect(
      persistHexDailyDataObservation({ ...BASE_OBS, canonicalPayload: invalidPayload }, db),
    ).rejects.toThrow("Non-canonical payload: numeric JSON values are not allowed.");

    // create must never be called — the write is blocked before hashing
    expect(obsCalls).toHaveLength(0);
  });

  it("throws and does not call create when canonicalPayload is malformed JSON", async () => {
    const { db, obsCalls } = createMockDb();

    await expect(
      persistHexDailyDataObservation({ ...BASE_OBS, canonicalPayload: "bad json" }, db),
    ).rejects.toThrow("Non-canonical payload: invalid JSON.");

    expect(obsCalls).toHaveLength(0);
  });

  it("does call create for a valid decimal-string payload (validation passes)", async () => {
    const { db, obsCalls } = createMockDb();
    const validPayload = JSON.stringify([{ dayPayoutTotal: "123456789012345678" }]);

    await persistHexDailyDataObservation({ ...BASE_OBS, canonicalPayload: validPayload }, db);

    expect(obsCalls).toHaveLength(1);
    expect(obsCalls[0]!.data.canonicalPayload).toBe(validPayload);
    expect(obsCalls[0]!.data.payloadHash).toBe(computePayloadHash(validPayload));
  });
});

// ─── 5. persistHexDailyDataObservationInvalidation — append-only guarantee ───

describe("persistHexDailyDataObservationInvalidation — append-only reference", () => {
  it("stores only the observationId reference — not the observation's payload", async () => {
    const { db, invCalls } = createMockDb();
    await persistHexDailyDataObservationInvalidation(
      { observationId: "obs_cuid_123", reason: "reorg" },
      db,
    );

    const stored = invCalls[0]!;
    expect(stored.data.observationId).toBe("obs_cuid_123");
    expect(stored.data.reason).toBe("reorg");
    // Observation data must not be embedded — only the FK reference is stored
    expect("canonicalPayload" in stored.data).toBe(false);
    expect("rangeStartDay" in stored.data).toBe(false);
    expect("observedAtBlock" in stored.data).toBe(false);
  });

  it("defaults reorgBlockHash to null when not provided", async () => {
    const { db, invCalls } = createMockDb();
    await persistHexDailyDataObservationInvalidation(
      { observationId: "obs_1", reason: "reorg" },
      db,
    );
    expect(invCalls[0]!.data.reorgBlockHash).toBeNull();
  });

  it("defaults supersededByObservationId to null when not provided", async () => {
    const { db, invCalls } = createMockDb();
    await persistHexDailyDataObservationInvalidation(
      { observationId: "obs_1", reason: "reorg" },
      db,
    );
    expect(invCalls[0]!.data.supersededByObservationId).toBeNull();
  });

  it("stores reorgBlockHash when provided", async () => {
    const { db, invCalls } = createMockDb();
    const blockHash =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    await persistHexDailyDataObservationInvalidation(
      { observationId: "obs_1", reason: "reorg", reorgBlockHash: blockHash },
      db,
    );
    expect(invCalls[0]!.data.reorgBlockHash).toBe(blockHash);
  });

  it("stores supersededByObservationId for supersession invalidations", async () => {
    const { db, invCalls } = createMockDb();
    await persistHexDailyDataObservationInvalidation(
      {
        observationId: "old_obs_id",
        reason: "superseded-by-later-read",
        supersededByObservationId: "new_obs_id",
      },
      db,
    );
    expect(invCalls[0]!.data.observationId).toBe("old_obs_id");
    expect(invCalls[0]!.data.supersededByObservationId).toBe("new_obs_id");
    expect(invCalls[0]!.data.reorgBlockHash).toBeNull();
  });

  it("returns the id generated by the DB layer", async () => {
    const { db } = createMockDb();
    const result = await persistHexDailyDataObservationInvalidation(
      { observationId: "obs_1", reason: "reorg" },
      db,
    );
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("string");
  });

  it("compile-time guard: observationId is required on CreateRawHexDailyDataObservationInvalidationInput", () => {
    type Guard = "observationId" extends keyof Required<CreateRawHexDailyDataObservationInvalidationInput>
      ? true
      : never;
    const guard: Guard = true;
    expect(guard).toBe(true);
  });
});
