// HexMining Phase 6 Slice 4 — HSI live verification runner contract tests
//
// The runner drives the shipped pipeline (discovery → persistence → reader) and
// assembles a factual report. These tests exercise the assembly deterministically
// with in-memory mocks — no live RPC, no live database, no network. They do NOT
// assert any financial value, only presence/consistency, mirroring the runner's
// own guardrail.
//
//   1.  Happy path: full pipeline produces all-checks-passed report.
//   2.  Report captures pre-enrichment warnings and post-enrichment removal.
//   3.  Resolved HSI contract is recorded from the independent hsiToken read.
//   4.  Token not found by discovery → target.found false, checks fail.
//   5.  Missing stake (reader) → isComplete stays false, checks fail, no fabrication.
//   6.  Unsupported chain → discovery short-circuits, report reflects failure.
//   7.  bigint/string-safe: uint256 token IDs and uint72 values survive as strings.
//   8.  No financial comparison: checks are presence-only booleans.

import { describe, expect, it } from "vitest";

import {
  runHsiLiveVerification,
  isPulsechainVerificationChain,
  type HsiLiveVerificationDeps,
} from "@/services/hexmining/hsi-live-verification-runner";

// ─── Constants ────────────────────────────────────────────────────────────────

const HSIM_ADDRESS = "0x8bd3d1472a656e312e94fb1bbdd599b8c51d18e3";
const HSI_CONTRACT = "0x1111111111111111111111111111111111111111";
const WALLET = "0xAbCdEf0000000000000000000000000000000001";
const CHAIN_ID = 369;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BLOCK = 21_000_000n;

const WARN_UNKNOWN = "hexmining-hsi-stake-fields-unknown";

const UINT256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

type StakeStruct = readonly [number, bigint, bigint, number, number, number, boolean];
const LIVE_STRUCT: StakeStruct = [942663, 1000000000000000n, 1414291579679n, 2310, 5555, 0, false];

// ─── In-memory persistence mock (create/findFirst/findMany/update) ──────────────

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

let idCounter = 0;

function makeMockDb() {
  const rows: StoredRow[] = [];

  function dedup(d: Pick<StoredRow, "chainId" | "walletAddress" | "hsiAddress" | "hsiTokenId" | "observedAtBlock">) {
    return rows.find(
      (r) =>
        r.chainId === d.chainId &&
        r.walletAddress === d.walletAddress &&
        r.hsiAddress === d.hsiAddress &&
        r.hsiTokenId === d.hsiTokenId &&
        r.observedAtBlock === d.observedAtBlock,
    );
  }

  return {
    rawHsiStakeObservation: {
      async create(args: { data: Omit<StoredRow, "id" | "createdAt">; select: { id: true } }) {
        if (dedup(args.data)) {
          const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          Object.setPrototypeOf(
            err,
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require("@prisma/client").Prisma.PrismaClientKnownRequestError.prototype,
          );
          throw err;
        }
        const row: StoredRow = { id: `row-${++idCounter}`, createdAt: new Date("2026-07-04T00:00:00Z"), ...args.data };
        rows.push(row);
        return { id: row.id };
      },
      async findFirst(args: { where: Pick<StoredRow, "chainId" | "walletAddress" | "hsiAddress" | "hsiTokenId" | "observedAtBlock">; select: { id: true } }) {
        const m = dedup(args.where);
        return m ? { id: m.id } : null;
      },
      async findMany(args: { where: { chainId: number; walletAddress: string }; orderBy: Record<string, "asc" | "desc">[] }) {
        const filtered = rows.filter(
          (r) => r.chainId === args.where.chainId && r.walletAddress === args.where.walletAddress,
        );
        const fieldOf = (r: StoredRow, f: string): string | bigint =>
          f === "observedAtBlock" ? r.observedAtBlock : f === "hsiTokenId" ? r.hsiTokenId : r.id;
        return filtered.sort((a, b) => {
          for (const entry of args.orderBy) {
            const [field, dir] = Object.entries(entry)[0] as [string, "asc" | "desc"];
            const av = fieldOf(a, field);
            const bv = fieldOf(b, field);
            let cmp: number;
            if (typeof av === "bigint" && typeof bv === "bigint") cmp = av < bv ? -1 : av > bv ? 1 : 0;
            else cmp = String(av).localeCompare(String(bv));
            if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
          }
          return 0;
        });
      },
      async update(args: { where: { id: string }; data: Partial<StoredRow>; select: { id: true } }) {
        const row = rows.find((r) => r.id === args.where.id);
        if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
        Object.assign(row, args.data);
        return { id: row.id };
      },
    },
    _rows: rows,
  };
}

// ─── Read client mock ────────────────────────────────────────────────────────────

function makePublicClient(config: {
  balanceOf?: bigint;
  tokenIds?: bigint[];
  hsiTokenMap?: Record<string, string>;
  stakeMap?: Record<string, StakeStruct>;
  blockNumber?: bigint;
}) {
  return {
    async getBlockNumber() {
      return config.blockNumber ?? BLOCK;
    },
    async readContract(args: { functionName: string; address: string; args?: unknown[] }) {
      switch (args.functionName) {
        case "balanceOf":
          return config.balanceOf ?? 0n;
        case "tokenOfOwnerByIndex": {
          const idx = Number((args.args as [unknown, bigint])[1]);
          return config.tokenIds?.[idx] ?? 0n;
        }
        case "hsiToken": {
          const tokenId = String((args.args as [bigint])[0]);
          return config.hsiTokenMap?.[tokenId] ?? ZERO_ADDRESS;
        }
        case "stakeDataFetch": {
          const struct = config.stakeMap?.[args.address.toLowerCase()];
          if (!struct) throw new Error(`no stake configured for ${args.address}`);
          return struct;
        }
        default:
          throw new Error(`Unexpected readContract call: ${args.functionName}`);
      }
    },
  } as unknown as HsiLiveVerificationDeps["publicClient"];
}

function asDeps(
  db: ReturnType<typeof makeMockDb>,
  publicClient: HsiLiveVerificationDeps["publicClient"],
): HsiLiveVerificationDeps {
  return {
    publicClient,
    persistenceClient: db as unknown as HsiLiveVerificationDeps["persistenceClient"],
  };
}

const BASE_INPUT = {
  chainId: CHAIN_ID,
  walletAddress: WALLET,
  hsiManagerAddress: HSIM_ADDRESS,
  expectedHsiTokenId: "42",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runHsiLiveVerification", () => {
  it("produces an all-checks-passed report for a healthy HSI pipeline", async () => {
    const db = makeMockDb();
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    const report = await runHsiLiveVerification(BASE_INPUT, asDeps(db, publicClient));

    expect(report.discovery.ok).toBe(true);
    expect(report.discovery.discovered).toBe(1);
    expect(report.discovery.observedAtBlock).toBe("21000000");

    expect(report.target.found).toBe(true);
    expect(report.target.hsiTokenId).toBe("42");
    expect(report.target.observedAtBlock).toBe("21000000");
    expect(report.target.resolvedHsiContract).toBe(HSI_CONTRACT);
    expect(report.target.isCompleteBefore).toBe(false);
    expect(report.target.warningsBefore).toEqual([WARN_UNKNOWN]);

    expect(report.enrichment.ok).toBe(true);
    expect(report.enrichment.outcomeStatus).toBe("enriched");

    expect(report.afterEnrichment.isComplete).toBe(true);
    expect(report.afterEnrichment.stakeId).toBe("942663");
    expect(report.afterEnrichment.stakeShares).toBe("1414291579679");
    expect(report.afterEnrichment.principalHex).toBe("1000000000000000");
    expect(report.afterEnrichment.lockedDay).toBe(2310);
    expect(report.afterEnrichment.stakedDays).toBe(5555);
    expect(report.afterEnrichment.warningsAfter).toEqual([]);

    expect(report.checks).toEqual({
      discoveryFoundToken: true,
      tokenIdMatches: true,
      observedAtBlockCaptured: true,
      hsiContractResolved: true,
      stakeIdPopulated: true,
      stakeSharesPopulated: true,
      principalHexPopulated: true,
      lockedDayPopulated: true,
      stakedDaysPopulated: true,
      isCompleteBecameTrue: true,
      stakeFieldsUnknownWarningRemoved: true,
    });
    expect(report.allChecksPassed).toBe(true);
  });

  it("records the warning transition (present before, absent after)", async () => {
    const db = makeMockDb();
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    const report = await runHsiLiveVerification(BASE_INPUT, asDeps(db, publicClient));

    expect(report.target.warningsBefore).toContain(WARN_UNKNOWN);
    expect(report.afterEnrichment.warningsAfter).not.toContain(WARN_UNKNOWN);
    expect(report.checks.stakeFieldsUnknownWarningRemoved).toBe(true);
  });

  it("reports target.found false and fails checks when discovery does not find the expected token", async () => {
    const db = makeMockDb();
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [999n], // discovery finds a different token
      hsiTokenMap: { "999": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    const report = await runHsiLiveVerification(BASE_INPUT, asDeps(db, publicClient));

    expect(report.discovery.ok).toBe(true);
    expect(report.target.found).toBe(false);
    expect(report.checks.discoveryFoundToken).toBe(false);
    expect(report.allChecksPassed).toBe(false);
    // Nothing fabricated for the (absent) target.
    expect(report.afterEnrichment.stakeId).toBeNull();
  });

  it("does not fabricate values and leaves isComplete false when the reader finds no stake", async () => {
    const db = makeMockDb();
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
      hsiTokenMap: { "42": ZERO_ADDRESS }, // resolves to nothing → missing stake
      stakeMap: {},
    });

    const report = await runHsiLiveVerification(BASE_INPUT, asDeps(db, publicClient));

    expect(report.target.found).toBe(true);
    expect(report.enrichment.outcomeStatus).toBe("missing");
    expect(report.afterEnrichment.isComplete).toBe(false);
    expect(report.afterEnrichment.stakeId).toBeNull();
    expect(report.afterEnrichment.stakeShares).toBeNull();
    expect(report.checks.stakeIdPopulated).toBe(false);
    expect(report.checks.hsiContractResolved).toBe(false);
    expect(report.checks.isCompleteBecameTrue).toBe(false);
    expect(report.allChecksPassed).toBe(false);
  });

  it("short-circuits on an unsupported chain and reflects discovery failure", async () => {
    const db = makeMockDb();
    const publicClient = makePublicClient({ balanceOf: 1n, tokenIds: [42n] });

    const report = await runHsiLiveVerification(
      { ...BASE_INPUT, chainId: 1 },
      asDeps(db, publicClient),
    );

    expect(report.discovery.ok).toBe(false);
    expect(report.discovery.code).toBe("hexmining-hsi-discovery-unsupported-chain");
    expect(report.target.found).toBe(false);
    expect(report.allChecksPassed).toBe(false);
    expect(db._rows).toHaveLength(0);
  });

  it("is bigint/string-safe for uint256 token IDs and uint72 stake values", async () => {
    const bigShares = "4722366482869645213695";
    const bigHearts = "4722366482869645213600";
    const db = makeMockDb();
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [BigInt(UINT256_MAX)],
      hsiTokenMap: { [UINT256_MAX]: HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: [7, BigInt(bigHearts), BigInt(bigShares), 1, 2, 0, false] },
    });

    const report = await runHsiLiveVerification(
      { ...BASE_INPUT, expectedHsiTokenId: UINT256_MAX },
      asDeps(db, publicClient),
    );

    expect(report.target.hsiTokenId).toBe(UINT256_MAX);
    expect(report.afterEnrichment.stakeShares).toBe(bigShares);
    expect(report.afterEnrichment.principalHex).toBe(bigHearts);
    expect(report.afterEnrichment.stakeShares).not.toContain("e");
    expect(report.allChecksPassed).toBe(true);
  });

  it("every check value is a boolean (no financial values leak into checks)", async () => {
    const db = makeMockDb();
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
      hsiTokenMap: { "42": HSI_CONTRACT },
      stakeMap: { [HSI_CONTRACT]: LIVE_STRUCT },
    });

    const report = await runHsiLiveVerification(BASE_INPUT, asDeps(db, publicClient));
    for (const value of Object.values(report.checks)) {
      expect(typeof value).toBe("boolean");
    }
  });
});

describe("isPulsechainVerificationChain", () => {
  it("accepts only chain 369", () => {
    expect(isPulsechainVerificationChain(369)).toBe(true);
    expect(isPulsechainVerificationChain(1)).toBe(false);
    expect(isPulsechainVerificationChain(8453)).toBe(false);
  });
});
