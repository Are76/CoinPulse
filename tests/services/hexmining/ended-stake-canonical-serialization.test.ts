// HexMining ended-stake canonical serialization — closure/regression tests
//
// Purpose: prove that a *canonical persisted* RawEndedHexStakeObservation is read
// back exactly through the REAL store (persist + read) and REAL reader, and then
// serialized unchanged through the REAL GET /api/hexmining/ended-stakes route.
//
// Unlike ended-stake-reader.test.ts (which hands the reader hand-crafted
// PersistedEndedHexStakeObservation objects), these tests exercise the full
// store → reader → route path against a shared in-memory Prisma-like client so
// that:
//   - the store's persist path (including the PR #335 in-place upgrade of a
//     previously-incomplete row) actually runs,
//   - the store's read ordering contract actually runs,
//   - the route's JSON serialization (`Response.json`) actually runs,
// and the exact digit-only stakeShares / lockedDay values survive every hop with
// no Number/parseInt/parseFloat coercion and no zero-coercion.
//
// The only mocking boundary is the database client itself. No live DB, no RPC,
// no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  persistEndedHexStakeObservation,
  type PersistEndedHexStakeObservationInput,
} from "@/services/hexmining/ended-stake-observation-store";
import { readEndedHexStakes } from "@/services/hexmining/ended-stake-reader";

// ─── In-memory Prisma-like client (the sole mocking boundary) ──────────────────
//
// Backs the real store's findFirst/update/create/findMany calls with faithful
// filtering and multi-key ordering so the store and reader run unchanged.

type StoredRow = {
  id: string;
  chainId: number;
  walletAddress: string;
  stakeId: string;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  yieldHex: string | null;
  penaltyHex: string | null;
  endTxHash: string;
  endBlockNumber: bigint;
  startTxHash: string | null;
  startBlockNumber: bigint | null;
  discoveryMethod: string;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
  createdAt: Date;
};

type OrderKey = "endBlockNumber" | "endTxHash" | "stakeId" | "id";

function compareByOrderBy(
  a: StoredRow,
  b: StoredRow,
  orderBy: Array<Record<string, "asc" | "desc">>,
): number {
  for (const clause of orderBy) {
    const [key, dir] = Object.entries(clause)[0] as [OrderKey, "asc" | "desc"];
    const av = a[key];
    const bv = b[key];
    let cmp = 0;
    if (typeof av === "bigint" && typeof bv === "bigint") {
      cmp = av < bv ? -1 : av > bv ? 1 : 0;
    } else {
      cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
    }
    if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
  }
  return 0;
}

class InMemoryDb {
  rows: StoredRow[] = [];
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `obs-generated-${this.seq}`;
  }

  readonly rawEndedHexStakeObservation = {
    findFirst: async (args: {
      where: {
        chainId: number;
        walletAddress: string;
        stakeId: string;
      };
      select: {
        id: true;
        isComplete: true;
        endBlockNumber: true;
        endTxHash: true;
      };
    }) => {
      const { where } = args;
      const found = this.rows.find(
        (r) =>
          r.chainId === where.chainId &&
          r.walletAddress === where.walletAddress &&
          r.stakeId === where.stakeId,
      );
      return found
        ? {
            id: found.id,
            isComplete: found.isComplete,
            endBlockNumber: found.endBlockNumber,
            endTxHash: found.endTxHash,
          }
        : null;
    },

    update: async (args: {
      where: { id: string };
      data: {
        lockedDay: number | null;
        stakeShares: string | null;
        isComplete: boolean;
        warnings: string[];
      };
    }) => {
      const row = this.rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`no row for id ${args.where.id}`);
      row.lockedDay = args.data.lockedDay;
      row.stakeShares = args.data.stakeShares;
      row.isComplete = args.data.isComplete;
      row.warnings = args.data.warnings;
      return { id: row.id };
    },

    create: async (args: { data: Omit<StoredRow, "id" | "createdAt"> }) => {
      const row: StoredRow = {
        ...args.data,
        id: this.nextId(),
        createdAt: new Date("2026-06-29T00:00:00Z"),
      };
      this.rows.push(row);
      return { id: row.id };
    },

    findMany: async (args: {
      where: { chainId: number; walletAddress: string };
      orderBy: Array<Record<string, "asc" | "desc">>;
    }) => {
      return this.rows
        .filter(
          (r) =>
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress,
        )
        .sort((a, b) => compareByOrderBy(a, b, args.orderBy))
        .map((r) => ({ ...r }));
    },
  };
}

// Shared instance returned by the mocked getDb() so the route path (which cannot
// take an injected client) reads the same rows the store wrote.
let db: InMemoryDb;

vi.mock("@/lib/db", () => ({
  getDb: () => db,
}));

// ─── Fixture constants ─────────────────────────────────────────────────────────

const CHAIN_ID = 369;
const WALLET = "0x1111111111111111111111111111111111111111";
const OBSERVED_AT = new Date("2026-06-14T12:00:00.000Z");

// uint72 maximum (2^72 - 1). A JS Number would silently lose precision on this;
// the canonical string must survive every hop byte-for-byte.
const UINT72_MAX = "4722366482869645213695";

function completeInput(
  overrides: Partial<PersistEndedHexStakeObservationInput> = {},
): PersistEndedHexStakeObservationInput {
  return {
    chainId: CHAIN_ID,
    walletAddress: WALLET,
    stakeId: "942663",
    stakeIndex: 0,
    stakedDays: 5555,
    lockedDay: 2310,
    stakeShares: "1414291579679",
    principalHex: "1000000000000000",
    yieldHex: "20589444841",
    penaltyHex: null,
    endTxHash: "0xabc123",
    endBlockNumber: 21_000_000n,
    startTxHash: "0xdef456",
    startBlockNumber: 18_000_000n,
    discoveryMethod: "raw_stake_action",
    observedAt: OBSERVED_AT,
    isComplete: true,
    warnings: [],
    ...overrides,
  };
}

function incompleteInput(
  overrides: Partial<PersistEndedHexStakeObservationInput> = {},
): PersistEndedHexStakeObservationInput {
  return completeInput({
    stakeId: "999999",
    stakeIndex: null,
    stakedDays: null,
    lockedDay: null,
    stakeShares: null,
    principalHex: null,
    yieldHex: null,
    startTxHash: null,
    startBlockNumber: null,
    endTxHash: "0xincomplete",
    endBlockNumber: 22_000_000n,
    isComplete: false,
    warnings: ["hexmining-ended-stake-lockedday-unknown"],
    ...overrides,
  });
}

beforeEach(() => {
  db = new InMemoryDb();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── 1. Complete observation round-trips exactly ───────────────────────────────

describe("complete ended-stake observation: store → reader canonical read", () => {
  it("returns lockedDay, stakeShares, isComplete, and warnings exactly", async () => {
    await persistEndedHexStakeObservation(completeInput(), db as never);

    const dto = await readEndedHexStakes(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      db as never,
    );

    expect(dto.totalCount).toBe(1);
    expect(dto.isComplete).toBe(true);
    const stake = dto.stakes[0];
    expect(stake.lockedDay).toBe(2310);
    expect(stake.stakeShares).toBe("1414291579679");
    expect(stake.isComplete).toBe(true);
    expect(stake.warnings).toEqual([]);
  });

  it("preserves a uint72-maximum stakeShares string with full precision", async () => {
    await persistEndedHexStakeObservation(
      completeInput({ stakeShares: UINT72_MAX }),
      db as never,
    );

    const dto = await readEndedHexStakes(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      db as never,
    );

    const stake = dto.stakes[0];
    expect(stake.stakeShares).toBe(UINT72_MAX);
    // A Number round-trip would land on 4722366482869645000000 (precision loss).
    expect(stake.stakeShares).not.toBe(String(Number(UINT72_MAX)));
  });
});

// ─── 2. Previously-incomplete row upgraded by PR #335 ──────────────────────────

describe("PR #335 in-place upgrade: incomplete row becomes complete", () => {
  it("reads the upgraded canonical values and no longer reports incomplete", async () => {
    // Seed the canonical pre-upgrade state: an incomplete row missing START
    // evidence, exactly as it would have been written before START-time evidence
    // existed.
    const first = await persistEndedHexStakeObservation(
      incompleteInput({ stakeId: "700001", endTxHash: "0xend700001" }),
      db as never,
    );
    expect(first.created).toBe(true);
    expect(first.updated).toBe(false);

    // Discovery re-runs with complete START evidence for the SAME dedupe identity
    // (same chainId, wallet, stakeId, endBlockNumber, discoveryMethod).
    const second = await persistEndedHexStakeObservation(
      incompleteInput({
        stakeId: "700001",
        endTxHash: "0xend700001",
        lockedDay: 1810,
        stakeShares: UINT72_MAX,
        isComplete: true,
        warnings: [],
      }),
      db as never,
    );
    expect(second.created).toBe(false);
    expect(second.updated).toBe(true);
    // Dedupe identity unchanged: the upgrade mutates in place, never inserts.
    expect(second.id).toBe(first.id);
    expect(db.rows).toHaveLength(1);

    const dto = await readEndedHexStakes(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      db as never,
    );

    expect(dto.totalCount).toBe(1);
    expect(dto.isComplete).toBe(true);
    const stake = dto.stakes[0];
    expect(stake.isComplete).toBe(true);
    expect(stake.lockedDay).toBe(1810);
    expect(stake.stakeShares).toBe(UINT72_MAX);
    expect(stake.warnings).toEqual([]);
  });

  it("never downgrades or rewrites an already-complete row", async () => {
    const first = await persistEndedHexStakeObservation(
      completeInput({ stakeId: "700002", endTxHash: "0xend700002" }),
      db as never,
    );

    // A re-run that is not complete must not touch the complete row.
    const second = await persistEndedHexStakeObservation(
      incompleteInput({
        stakeId: "700002",
        endTxHash: "0xend700002",
        endBlockNumber: completeInput().endBlockNumber,
      }),
      db as never,
    );

    expect(second.created).toBe(false);
    expect(second.updated).toBe(false);
    expect(second.id).toBe(first.id);

    const dto = await readEndedHexStakes(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      db as never,
    );
    const stake = dto.stakes[0];
    expect(stake.isComplete).toBe(true);
    expect(stake.lockedDay).toBe(2310);
    expect(stake.stakeShares).toBe("1414291579679");
  });
});

// ─── 3. Incomplete observation stays honestly incomplete ───────────────────────

describe("incomplete ended-stake observation: no coercion, warning retained", () => {
  it("keeps nullable evidence null, isComplete false, and warning visible", async () => {
    await persistEndedHexStakeObservation(incompleteInput(), db as never);

    const dto = await readEndedHexStakes(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      db as never,
    );

    const stake = dto.stakes[0];
    expect(stake.isComplete).toBe(false);
    expect(stake.lockedDay).toBeNull();
    expect(stake.stakeShares).toBeNull();
    expect(stake.stakeIndex).toBeNull();
    expect(stake.startTxHash).toBeNull();
    expect(stake.startBlockNumber).toBeNull();
    expect(stake.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
    // Explicitly not zero-coerced.
    expect(stake.lockedDay).not.toBe(0);
    expect(stake.stakeShares).not.toBe("0");
    expect(dto.isComplete).toBe(false);
    expect(dto.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });
});

// ─── 4. Multiple observations: ordering, no duplicates, scoping ────────────────

describe("multiple ended-stake observations: deterministic contract", () => {
  it("orders by endBlockNumber ascending and emits no duplicate DTO rows", async () => {
    await persistEndedHexStakeObservation(
      completeInput({ stakeId: "3", endTxHash: "0xc", endBlockNumber: 25_000_000n }),
      db as never,
    );
    await persistEndedHexStakeObservation(
      completeInput({ stakeId: "1", endTxHash: "0xa", endBlockNumber: 19_000_000n }),
      db as never,
    );
    await persistEndedHexStakeObservation(
      completeInput({ stakeId: "2", endTxHash: "0xb", endBlockNumber: 22_000_000n }),
      db as never,
    );

    const dto = await readEndedHexStakes(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      db as never,
    );

    expect(dto.stakes.map((s) => s.stakeId)).toEqual(["1", "2", "3"]);
    expect(dto.stakes.map((s) => s.endBlockNumber)).toEqual([
      "19000000",
      "22000000",
      "25000000",
    ]);
    const ids = dto.stakes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("scopes reads to the requested chainId and wallet", async () => {
    await persistEndedHexStakeObservation(completeInput(), db as never);
    await persistEndedHexStakeObservation(
      completeInput({ stakeId: "other-chain", chainId: 1, endTxHash: "0xoc" }),
      db as never,
    );
    await persistEndedHexStakeObservation(
      completeInput({
        stakeId: "other-wallet",
        walletAddress: "0x2222222222222222222222222222222222222222",
        endTxHash: "0xow",
      }),
      db as never,
    );

    const dto = await readEndedHexStakes(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      db as never,
    );

    expect(dto.totalCount).toBe(1);
    expect(dto.stakes[0].stakeId).toBe("942663");
    expect(dto.stakes.every((s) => s.chainId === CHAIN_ID)).toBe(true);
    expect(dto.stakes.every((s) => s.walletAddress === WALLET)).toBe(true);
  });
});

// ─── 5. String safety across store → reader → API JSON serialization ───────────

describe("string-safe stakeShares survives the full API serialization path", () => {
  it("returns the exact uint72 string in the route JSON body", async () => {
    await persistEndedHexStakeObservation(
      completeInput({ stakeShares: UINT72_MAX }),
      db as never,
    );

    // Import the REAL route; its reader defaults to the mocked getDb() → `db`.
    const { GET } = await import("../../../app/api/hexmining/ended-stakes/route");
    const url = new URL("http://localhost/api/hexmining/ended-stakes");
    url.searchParams.set("walletAddress", WALLET);
    url.searchParams.set("chainId", String(CHAIN_ID));

    const response = await GET(new Request(url.toString()));
    expect(response.status).toBe(200);

    // Inspect the raw serialized text: a Number coercion anywhere in the path
    // would surface as a bare number or exponential notation, never this string.
    const text = await response.text();
    expect(text).toContain(`"stakeShares":"${UINT72_MAX}"`);
    expect(text).not.toContain("4.722366482869645e");

    const body = JSON.parse(text);
    const stake = body.data.stakes[0];
    expect(typeof stake.stakeShares).toBe("string");
    expect(stake.stakeShares).toBe(UINT72_MAX);
    expect(typeof stake.lockedDay).toBe("number");
  });

  it("serializes an incomplete row's null stakeShares as JSON null, not 0", async () => {
    await persistEndedHexStakeObservation(incompleteInput(), db as never);

    const { GET } = await import("../../../app/api/hexmining/ended-stakes/route");
    const url = new URL("http://localhost/api/hexmining/ended-stakes");
    url.searchParams.set("walletAddress", WALLET);
    url.searchParams.set("chainId", String(CHAIN_ID));

    const response = await GET(new Request(url.toString()));
    const text = await response.text();
    expect(text).toContain('"stakeShares":null');
    expect(text).toContain('"lockedDay":null');

    const body = JSON.parse(text);
    expect(body.data.stakes[0].stakeShares).toBeNull();
    expect(body.data.stakes[0].isComplete).toBe(false);
  });
});
