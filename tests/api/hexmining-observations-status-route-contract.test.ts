// Contract tests for GET /api/hexmining/observations/status
//
// Verifies:
//   1. Status "available" with full DTO shape when latest observation exists.
//   2. Status "missing" with null latestObservation when DB has no observation.
//   3. observedAtBlock serialized as base-10 decimal string (§11.8 bigint-safe policy).
//   4. asOf and createdAt are valid ISO timestamp strings.
//   5. HTTP 500 with sanitized error envelope on DB failure; no internal details leak.
//   6. Provenance fields confirm DB-backed read-only source.
//   7. DB query uses chainId 369 and sourceFamily HEXMINING.
//   8. observedAt exposed in DTO as ISO string (RPC read time, distinct from createdAt).
//   9. DB query filters out invalidated observations via invalidations: { none: {} }.
//  10. Invalidated latest observation is not returned as "available".

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HexMiningObservationStatusDto } from "@/services/api/hexmining-observations";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type ObsRow = {
  id: string;
  rangeStartDay: number;
  rangeEndDay: number;
  observedAtBlock: bigint;
  observedAt: Date;
  rpcEndpointLabel: string | null;
  payloadHash: string;
  createdAt: Date;
};

const SAMPLE_OBS: ObsRow = {
  id: "obs_cuid_abc123",
  rangeStartDay: 1000,
  rangeEndDay: 1099,
  observedAtBlock: BigInt("23456789"),
  observedAt: new Date("2026-06-05T23:00:00.000Z"),
  rpcEndpointLabel: "pulsechain-primary",
  payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  createdAt: new Date("2026-06-06T00:00:00.000Z"),
};

// ─── Mock DB factory ──────────────────────────────────────────────────────────

function createMemoryDb(obs: ObsRow | null = null) {
  return new Proxy(
    {
      rawHexDailyDataObservation: {
        async findFirst() {
          return obs;
        },
      },
    },
    {
      get(target, property, receiver) {
        if (property in target) {
          return Reflect.get(target, property, receiver);
        }
        throw new Error(`unexpected-db-access:${String(property)}`);
      },
    },
  );
}

// ─── Module-level mock ────────────────────────────────────────────────────────

const getDb = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/hexmining/observations/status route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns status available with full DTO when latest observation exists", async () => {
    getDb.mockReturnValue(createMemoryDb(SAMPLE_OBS));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        schemaVersion: "v1",
        chainId: 369,
        sourceFamily: "HEXMINING",
        status: "available",
        asOf: expect.any(String),
        latestObservation: {
          id: SAMPLE_OBS.id,
          rangeStartDay: SAMPLE_OBS.rangeStartDay,
          rangeEndDay: SAMPLE_OBS.rangeEndDay,
          observedAtBlock: "23456789",
          observedAt: SAMPLE_OBS.observedAt.toISOString(),
          rpcEndpointLabel: SAMPLE_OBS.rpcEndpointLabel,
          payloadHash: SAMPLE_OBS.payloadHash,
          createdAt: SAMPLE_OBS.createdAt.toISOString(),
        },
        provenance: {
          source: "rawHexDailyDataObservation",
          storage: "postgres",
        },
        warnings: [],
      },
    });
  });

  it("returns status missing with null latestObservation when no observation exists", async () => {
    getDb.mockReturnValue(createMemoryDb(null));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("missing");
    expect(body.data.latestObservation).toBeNull();
    expect(body.data.schemaVersion).toBe("v1");
    expect(body.data.chainId).toBe(369);
    expect(body.data.sourceFamily).toBe("HEXMINING");
  });

  it("serializes observedAtBlock as a base-10 decimal string (bigint-safe)", async () => {
    const obs: ObsRow = {
      ...SAMPLE_OBS,
      observedAtBlock: BigInt("99999999999999999"),
    };
    getDb.mockReturnValue(createMemoryDb(obs));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    expect(body.data.latestObservation.observedAtBlock).toBe("99999999999999999");
    expect(typeof body.data.latestObservation.observedAtBlock).toBe("string");
  });

  it("asOf is a valid ISO timestamp string", async () => {
    getDb.mockReturnValue(createMemoryDb(null));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    expect(() => new Date(body.data.asOf)).not.toThrow();
    expect(new Date(body.data.asOf).toISOString()).toBe(body.data.asOf);
  });

  it("createdAt is a valid ISO timestamp string when observation exists", async () => {
    getDb.mockReturnValue(createMemoryDb(SAMPLE_OBS));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    const createdAt: string = body.data.latestObservation.createdAt;
    expect(() => new Date(createdAt)).not.toThrow();
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
  });

  it("returns HTTP 500 with safe error envelope on DB failure", async () => {
    getDb.mockReturnValue({
      rawHexDailyDataObservation: {
        findFirst() {
          throw new Error("database connection lost");
        },
      },
    });
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: expect.any(String),
      },
    });
  });

  it("does not leak internal error details in the 500 response", async () => {
    getDb.mockReturnValue({
      rawHexDailyDataObservation: {
        findFirst() {
          throw new Error("database connection lost");
        },
      },
    });
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    expect(JSON.stringify(body)).not.toContain("database connection lost");
  });

  it("provenance fields confirm DB-backed read-only source", async () => {
    getDb.mockReturnValue(createMemoryDb(null));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    expect(body.data.provenance).toEqual({
      source: "rawHexDailyDataObservation",
      storage: "postgres",
    });
  });

  it("DB query uses chainId 369 and sourceFamily HEXMINING", async () => {
    const findFirstCalls: Array<{ where: Record<string, unknown> }> = [];
    getDb.mockReturnValue({
      rawHexDailyDataObservation: {
        async findFirst(args: { where: Record<string, unknown> }) {
          findFirstCalls.push(args);
          return null;
        },
      },
    });
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    await GET();

    expect(findFirstCalls).toHaveLength(1);
    expect(findFirstCalls[0]!.where.chainId).toBe(369);
    expect(findFirstCalls[0]!.where.sourceFamily).toBe("HEXMINING");
  });

  it("DB query invalidations filter is { none: {} }", async () => {
    const findFirstCalls: Array<{ where: Record<string, unknown> }> = [];
    getDb.mockReturnValue({
      rawHexDailyDataObservation: {
        async findFirst(args: { where: Record<string, unknown> }) {
          findFirstCalls.push(args);
          return null;
        },
      },
    });
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    await GET();

    expect(findFirstCalls).toHaveLength(1);
    expect(findFirstCalls[0]!.where.invalidations).toEqual({ none: {} });
  });

  it("observedAt is a valid ISO string in the DTO when observation exists", async () => {
    getDb.mockReturnValue(createMemoryDb(SAMPLE_OBS));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    const observedAt: string = body.data.latestObservation.observedAt;
    expect(typeof observedAt).toBe("string");
    expect(() => new Date(observedAt)).not.toThrow();
    expect(new Date(observedAt).toISOString()).toBe(observedAt);
    expect(observedAt).toBe(SAMPLE_OBS.observedAt.toISOString());
  });

  it("observedAt differs from createdAt (RPC read time is before row insert time)", async () => {
    getDb.mockReturnValue(createMemoryDb(SAMPLE_OBS));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    const { observedAt, createdAt } = body.data.latestObservation;
    expect(observedAt).not.toBe(createdAt);
    expect(new Date(observedAt).getTime()).toBeLessThan(
      new Date(createdAt).getTime(),
    );
  });

  it("status is missing when findFirst returns null (all observations invalidated)", async () => {
    getDb.mockReturnValue(createMemoryDb(null));
    const { GET } = await import(
      "../../app/api/hexmining/observations/status/route"
    );
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("missing");
    expect(body.data.latestObservation).toBeNull();
  });

  it("service-level: returns full DTO with injected now and observation", async () => {
    const fixedNow = new Date("2026-06-07T12:00:00.000Z");
    getDb.mockReturnValue(createMemoryDb(SAMPLE_OBS));
    const { getHexMiningObservationStatus } = await import(
      "@/services/api/hexmining-observations"
    );
    const result = await getHexMiningObservationStatus({ now: fixedNow });

    expect(result).toMatchObject<HexMiningObservationStatusDto>({
      schemaVersion: "v1",
      chainId: 369,
      sourceFamily: "HEXMINING",
      status: "available",
      asOf: "2026-06-07T12:00:00.000Z",
      latestObservation: {
        id: SAMPLE_OBS.id,
        rangeStartDay: SAMPLE_OBS.rangeStartDay,
        rangeEndDay: SAMPLE_OBS.rangeEndDay,
        observedAtBlock: "23456789",
        observedAt: SAMPLE_OBS.observedAt.toISOString(),
        rpcEndpointLabel: SAMPLE_OBS.rpcEndpointLabel,
        payloadHash: SAMPLE_OBS.payloadHash,
        createdAt: SAMPLE_OBS.createdAt.toISOString(),
      },
      provenance: { source: "rawHexDailyDataObservation", storage: "postgres" },
      warnings: [],
    });
  });

  it("service-level: returns missing status with null observation", async () => {
    const fixedNow = new Date("2026-06-07T12:00:00.000Z");
    getDb.mockReturnValue(createMemoryDb(null));
    const { getHexMiningObservationStatus } = await import(
      "@/services/api/hexmining-observations"
    );
    const result = await getHexMiningObservationStatus({ now: fixedNow });

    expect(result.status).toBe("missing");
    expect(result.latestObservation).toBeNull();
    expect(result.asOf).toBe("2026-06-07T12:00:00.000Z");
  });
});
