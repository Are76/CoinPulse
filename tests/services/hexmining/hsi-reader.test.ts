// HexMining Phase 6 Slice 3 — HSI reader (stake enrichment) contract tests
//
// Verifies enrichHsiStakeObservations, which consumes previously discovered
// (incomplete) RawHsiStakeObservation rows and back-fills the underlying HEX
// stake metadata by reading the Hedron HSI contracts.
//
//   1.  Successful enrichment populates the six stake fields and flips isComplete.
//   2.  Missing stake (hsiToken → zero address) leaves the observation unchanged.
//   3.  Missing stake (zeroed stake struct / stakeId 0) leaves it unchanged.
//   4.  Failed hsiToken resolve read → structured error, observation unchanged.
//   5.  Failed stakeDataFetch read → structured error, observation unchanged.
//   6.  Persistence failure → structured error, observation unchanged.
//   7.  Already-complete observations are skipped, never re-read or re-written.
//   8.  Warning "hexmining-hsi-stake-fields-unknown" is removed after enrichment.
//   9.  Other pre-existing warnings are preserved.
//  10.  bigint/string-safe: uint256 token IDs and uint72 shares/hearts survive.
//  11.  No fabricated values: only struct-returned values are written; failures
//       write nothing.
//  12.  Deterministic: repeated runs and outcome ordering are stable.
//  13.  Unsupported chain short-circuits with zero reads and zero writes.
//  14.  Reads are pinned to each observation's captured observedAtBlock.
//  15.  stakeIndex is the structural HSI index 0 (single wrapped HEX stake).
//
// No live database, no RPC, no network. Pure in-memory mock.

import { describe, expect, it } from "vitest";

import {
  enrichHsiStakeObservations,
  type HsiReaderReadClient,
} from "@/services/hexmining/hsi-reader";
import type { PersistHsiStakeObservationInput } from "@/services/hexmining/hsi-observation-store";

// ─── Constants ────────────────────────────────────────────────────────────────

const HSIM_ADDRESS = "0x8bd3d1472a656e312e94fb1bbdd599b8c51d18e3";
const WALLET = "0xAbCdEf0000000000000000000000000000000001";
const WALLET_LOWER = WALLET.toLowerCase();
const CHAIN_ID = 369;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const UINT256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

// ─── Stored row shape (mirrors RawHsiStakeObservation) ──────────────────────────

type StoredRow = {
  id: string;
  chainId: number;
  walletAddress: string;
  hsiTokenId: string;
  hsiAddress: string;
  stakeId: string | null;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  observedAtBlock: bigint;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
  createdAt: Date;
};

function makeRow(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    id: "row-1",
    chainId: CHAIN_ID,
    walletAddress: WALLET_LOWER,
    hsiTokenId: "42",
    hsiAddress: HSIM_ADDRESS,
    stakeId: null,
    stakeIndex: null,
    stakedDays: null,
    lockedDay: null,
    stakeShares: null,
    principalHex: null,
    observedAtBlock: 21_000_000n,
    observedAt: new Date("2026-07-03T12:00:00Z"),
    isComplete: false,
    warnings: ["hexmining-hsi-stake-fields-unknown"],
    createdAt: new Date("2026-07-03T00:00:00Z"),
    ...overrides,
  };
}

// ─── Mock persistence client ────────────────────────────────────────────────────

function makeMockDb(initial: StoredRow[]) {
  const rows: StoredRow[] = initial.map((r) => ({ ...r }));
  const updateCalls: { id: string; data: Record<string, unknown> }[] = [];

  const client = {
    rawHsiStakeObservation: {
      async findMany(args: {
        where: { chainId: number; walletAddress: string };
        orderBy: Record<string, "asc" | "desc">[];
      }) {
        const filtered = rows.filter(
          (r) =>
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress,
        );
        const fieldOf = (r: StoredRow, field: string): string | bigint => {
          if (field === "observedAtBlock") return r.observedAtBlock;
          if (field === "hsiTokenId") return r.hsiTokenId;
          return r.id;
        };
        return filtered.sort((a, b) => {
          for (const entry of args.orderBy) {
            const [field, dir] = Object.entries(entry)[0] as [string, "asc" | "desc"];
            const av = fieldOf(a, field);
            const bv = fieldOf(b, field);
            let cmp: number;
            if (typeof av === "bigint" && typeof bv === "bigint") {
              cmp = av < bv ? -1 : av > bv ? 1 : 0;
            } else {
              cmp = String(av).localeCompare(String(bv));
            }
            if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
          }
          return 0;
        });
      },
      async update(args: {
        where: { id: string };
        data: {
          stakeId: string;
          stakeIndex: number;
          stakedDays: number;
          lockedDay: number;
          stakeShares: string;
          principalHex: string;
          isComplete: boolean;
          warnings: string[];
        };
        select: { id: true };
      }) {
        updateCalls.push({ id: args.where.id, data: args.data });
        const row = rows.find((r) => r.id === args.where.id);
        if (!row) {
          const err = Object.assign(new Error("Record to update not found"), {
            code: "P2025",
          });
          throw err;
        }
        Object.assign(row, args.data);
        return { id: row.id };
      },
      // Unused by the reader but required to satisfy the StoreClient shape.
      async create(): Promise<{ id: string }> {
        throw new Error("create should not be called by the reader");
      },
      async findFirst(): Promise<{ id: string } | null> {
        return null;
      },
    },
    _rows: rows,
    _updateCalls: updateCalls,
  };

  return client;
}

type Deps = Parameters<typeof enrichHsiStakeObservations>[1];

function asPersistence(db: ReturnType<typeof makeMockDb>): Deps["persistenceClient"] {
  return db as unknown as Deps["persistenceClient"];
}

// ─── Mock read client ────────────────────────────────────────────────────────────

// viem decodes uint40 (stakeId) and uint16 day fields to number, uint72
// hearts/shares to bigint.
type StakeStruct = readonly [number, bigint, bigint, number, number, number, boolean];

function makePublicClient(config: {
  // tokenId -> resolved HSI contract address (or zero address for missing)
  hsiTokenMap?: Record<string, string>;
  hsiTokenError?: unknown;
  // hsi contract address -> stake struct
  stakeMap?: Record<string, StakeStruct>;
  stakeError?: unknown;
  onCall?: (call: { functionName: string; address: string; blockNumber?: bigint }) => void;
}) {
  return {
    async readContract(args: {
      functionName: string;
      address: string;
      args?: unknown[];
      blockNumber?: bigint;
    }) {
      config.onCall?.({
        functionName: args.functionName,
        address: args.address,
        blockNumber: args.blockNumber,
      });
      if (args.functionName === "hsiToken") {
        if (config.hsiTokenError) throw config.hsiTokenError;
        const tokenId = String((args.args as [bigint])[0]);
        return config.hsiTokenMap?.[tokenId] ?? ZERO_ADDRESS;
      }
      if (args.functionName === "stakeDataFetch") {
        if (config.stakeError) throw config.stakeError;
        const struct = config.stakeMap?.[args.address.toLowerCase()];
        if (!struct) throw new Error(`no stake configured for ${args.address}`);
        return struct;
      }
      throw new Error(`Unexpected readContract call: ${args.functionName}`);
    },
  } as unknown as HsiReaderReadClient;
}

const HSI_CONTRACT = "0x1111111111111111111111111111111111111111";

// A representative live stake struct: stakeId, stakedHearts, stakeShares,
// lockedDay, stakedDays, unlockedDay, isAutoStake.
const LIVE_STRUCT: StakeStruct = [942663, 1000000000000000n, 1414291579679n, 2310, 5555, 0, false];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("enrichHsiStakeObservations", () => {
  it("enriches an incomplete observation with the underlying stake metadata", async () => {
    const db = makeMockDb([makeRow()]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scanned).toBe(1);
    expect(result.enriched).toBe(1);
    expect(result.missing).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ hsiTokenId: "42", status: "enriched" });

    const row = db._rows[0];
    expect(row.stakeId).toBe("942663");
    expect(row.stakeIndex).toBe(0);
    expect(row.lockedDay).toBe(2310);
    expect(row.stakedDays).toBe(5555);
    expect(row.stakeShares).toBe("1414291579679");
    expect(row.principalHex).toBe("1000000000000000");
    expect(row.isComplete).toBe(true);
  });

  it("marks the observation complete after successful enrichment", async () => {
    const db = makeMockDb([makeRow({ isComplete: false })]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(db._rows[0].isComplete).toBe(true);
    expect(db._updateCalls[0].data.isComplete).toBe(true);
  });

  it("removes the stake-fields-unknown warning after enrichment", async () => {
    const db = makeMockDb([
      makeRow({ warnings: ["hexmining-hsi-stake-fields-unknown"] }),
    ]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(db._rows[0].warnings).not.toContain("hexmining-hsi-stake-fields-unknown");
    expect(db._rows[0].warnings).toEqual([]);
  });

  it("preserves unrelated warnings while removing the stake-fields-unknown warning", async () => {
    const db = makeMockDb([
      makeRow({
        warnings: ["hexmining-hsi-stake-fields-unknown", "some-other-warning"],
      }),
    ]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(db._rows[0].warnings).toEqual(["some-other-warning"]);
  });

  it("treats a zero-address hsiToken resolution as a missing stake and leaves the row unchanged", async () => {
    const db = makeMockDb([makeRow()]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": ZERO_ADDRESS },
      stakeMap: {},
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missing).toBe(1);
    expect(result.enriched).toBe(0);
    expect(result.outcomes[0]).toMatchObject({
      status: "missing",
      code: "hexmining-hsi-reader-stake-missing",
    });

    const row = db._rows[0];
    expect(row.isComplete).toBe(false);
    expect(row.stakeId).toBeNull();
    expect(row.stakeShares).toBeNull();
    expect(db._updateCalls).toHaveLength(0);
  });

  it("treats a zeroed stake struct (stakeId 0) as a missing stake and writes nothing", async () => {
    const db = makeMockDb([makeRow()]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: [0, 0n, 0n, 0, 0, 0, false] },
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missing).toBe(1);
    expect(db._rows[0].isComplete).toBe(false);
    expect(db._rows[0].stakeId).toBeNull();
    expect(db._updateCalls).toHaveLength(0);
  });

  it("returns a structured error and leaves the row unchanged when hsiToken resolve fails", async () => {
    const db = makeMockDb([makeRow()]);
    const publicClient = makePublicClient({
      hsiTokenError: new Error("execution reverted"),
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ status: "failed" });
    expect((result.outcomes[0] as { code: string }).code).toMatch(
      /^hexmining-hsi-reader-resolve-rpc-/,
    );

    const row = db._rows[0];
    expect(row.isComplete).toBe(false);
    expect(row.stakeId).toBeNull();
    expect(db._updateCalls).toHaveLength(0);
  });

  it("returns a structured error and leaves the row unchanged when stakeDataFetch fails", async () => {
    const db = makeMockDb([makeRow()]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeError: new Error("timeout"),
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failed).toBe(1);
    expect((result.outcomes[0] as { code: string }).code).toMatch(
      /^hexmining-hsi-reader-stakedata-rpc-/,
    );
    expect(db._rows[0].isComplete).toBe(false);
    expect(db._updateCalls).toHaveLength(0);
  });

  it("reports a structured failure and leaves the row unchanged when persistence throws", async () => {
    const db = makeMockDb([makeRow()]);
    // Override update to throw.
    db.rawHsiStakeObservation.update = async () => {
      throw new Error("database connection lost");
    };
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]).toMatchObject({
      status: "failed",
      code: "hexmining-hsi-reader-persist-failed",
    });
    // The row itself was never mutated.
    expect(db._rows[0].isComplete).toBe(false);
    expect(db._rows[0].stakeId).toBeNull();
  });

  it("skips already-complete observations without reading or writing", async () => {
    const complete = makeRow({
      id: "row-complete",
      isComplete: true,
      stakeId: "999",
      stakeIndex: 0,
      stakedDays: 100,
      lockedDay: 10,
      stakeShares: "5",
      principalHex: "7",
      warnings: [],
    });
    const db = makeMockDb([complete]);

    let readCalls = 0;
    const publicClient = makePublicClient({
      onCall: () => {
        readCalls++;
      },
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scanned).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.enriched).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ status: "skipped_already_complete" });
    expect(readCalls).toBe(0);
    expect(db._updateCalls).toHaveLength(0);
  });

  it("is bigint/string-safe for uint256 token IDs and uint72 share/hearts values", async () => {
    const bigShares = "4722366482869645213695"; // ~ 2^72 - 1
    const bigHearts = "4722366482869645213600";
    const db = makeMockDb([makeRow({ hsiTokenId: UINT256_MAX })]);
    const publicClient = makePublicClient({
      hsiTokenMap: { [UINT256_MAX]: HSI_CONTRACT },
      stakeMap: {
        [HSI_CONTRACT]: [123456789, BigInt(bigHearts), BigInt(bigShares), 100, 3000, 0, true],
      },
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enriched).toBe(1);
    const row = db._rows[0];
    expect(row.stakeShares).toBe(bigShares);
    expect(row.principalHex).toBe(bigHearts);
    expect(row.stakeId).toBe("123456789");
    // No precision loss / scientific notation.
    expect(row.stakeShares).not.toContain("e");
  });

  it("does not fabricate values on missing/failed paths (fields stay null)", async () => {
    const db = makeMockDb([
      makeRow({ id: "missing-row", hsiTokenId: "1" }),
      makeRow({ id: "failed-row", hsiTokenId: "2" }),
    ]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "1": ZERO_ADDRESS, "2": HSI_CONTRACT },
      stakeError: new Error("execution reverted"),
    });

    await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    for (const row of db._rows) {
      expect(row.stakeId).toBeNull();
      expect(row.stakeIndex).toBeNull();
      expect(row.stakedDays).toBeNull();
      expect(row.lockedDay).toBeNull();
      expect(row.stakeShares).toBeNull();
      expect(row.principalHex).toBeNull();
      expect(row.isComplete).toBe(false);
    }
    expect(db._updateCalls).toHaveLength(0);
  });

  it("pins every contract read to the observation's captured observedAtBlock", async () => {
    const db = makeMockDb([
      makeRow({ id: "a", hsiTokenId: "1", observedAtBlock: 19_000_000n }),
    ]);
    const blocks: (bigint | undefined)[] = [];
    const publicClient = makePublicClient({
      hsiTokenMap: { "1": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
      onCall: (c) => blocks.push(c.blockNumber),
    });

    await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(blocks).toEqual([19_000_000n, 19_000_000n]);
  });

  it("processes a mix of enriched, missing, and failed observations deterministically", async () => {
    const db = makeMockDb([
      makeRow({ id: "a", hsiTokenId: "1", observedAtBlock: 10n }),
      makeRow({ id: "b", hsiTokenId: "2", observedAtBlock: 20n }),
      makeRow({ id: "c", hsiTokenId: "3", observedAtBlock: 30n }),
    ]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "1": HSI_CONTRACT, "2": ZERO_ADDRESS, "3": "0x2222222222222222222222222222222222222222" },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT }, // token 3's contract has no stake configured -> throws
    });

    const result = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scanned).toBe(3);
    expect(result.enriched).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.failed).toBe(1);
    // Ordered by observedAtBlock asc (token 1, 2, 3).
    expect(result.outcomes.map((o) => o.status)).toEqual([
      "enriched",
      "missing",
      "failed",
    ]);
  });

  it("is idempotent: a second run over now-complete rows performs no writes", async () => {
    const db = makeMockDb([makeRow()]);
    const publicClient = makePublicClient({
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    const first = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );
    const writesAfterFirst = db._updateCalls.length;

    const second = await enrichHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(first.ok && first.enriched).toBe(1);
    expect(second.ok && second.enriched).toBe(0);
    expect(second.ok && second.skipped).toBe(1);
    expect(db._updateCalls.length).toBe(writesAfterFirst);
  });

  it("short-circuits on an unsupported chain without any read or write", async () => {
    const db = makeMockDb([makeRow()]);
    let called = false;
    const publicClient = makePublicClient({ onCall: () => (called = true) });

    const result = await enrichHsiStakeObservations(
      { chainId: 1, walletAddress: WALLET },
      { publicClient, persistenceClient: asPersistence(db) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("hexmining-hsi-reader-unsupported-chain");
    expect(called).toBe(false);
    expect(db._updateCalls).toHaveLength(0);
  });
});

// Type-only guard: ensures the store input contract stays compatible with the
// reader's usage (all six stake fields plus warnings are writable).
const _typeCheck: PersistHsiStakeObservationInput["stakeShares"] = null;
void _typeCheck;
