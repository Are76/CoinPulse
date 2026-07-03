// HexMining Phase 6 Slice 2 — HSI discovery service contract tests
//
// Verifies the behaviour of discoverHsiStakeObservations:
//
//   1.  Wallet with zero HSI NFTs returns ok: true, discovered/persisted/skipped = 0.
//   2.  Wallet with one HSI NFT persists one observation.
//   3.  Wallet with multiple HSI NFTs persists all of them.
//   4.  Duplicate discovery (same block) does not create duplicate observations.
//   5.  Persistence called with correct fields (null stake struct, isComplete: false).
//   6.  Warnings include hexmining-hsi-stake-fields-unknown for each observation.
//   7.  walletAddress normalized to lowercase before persistence.
//   8.  hsiAddress normalized to lowercase before persistence.
//   9.  uint256-sized token IDs (beyond int64) are passed as decimal strings.
//  10.  getBlockNumber failure returns ok: false with structured error code.
//  11.  balanceOf RPC failure returns ok: false with structured error code.
//  12.  tokenOfOwnerByIndex failure for one index skips that token, adds warning,
//       continues with the rest.
//  13.  Persistence failure propagates correctly.
//  14.  observedAtBlock is a decimal string of the captured block number.
//  15.  Skipped count reflects already-existing observations (created: false).
//
// No live database, no RPC, no network. Pure in-memory mock.

import { describe, expect, it, vi } from "vitest";

import { discoverHsiStakeObservations } from "@/services/hexmining/hsi-discovery";
import type { HsiDiscoveryReadClient } from "@/services/hexmining/hsi-discovery";
import type { PersistHsiStakeObservationInput } from "@/services/hexmining/hsi-observation-store";

// ─── Constants ────────────────────────────────────────────────────────────────

const HEDRON_ADDRESS = "0x8bd3d1472a656e312e94fb1bbdd599b8c51d18e3";
const WALLET = "0xAbCdEf0000000000000000000000000000000001";
const WALLET_LOWER = WALLET.toLowerCase();
const CHAIN_ID = 369;
const BLOCK = 21_000_000n;

// uint256 max — well beyond int64 range
const UINT256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

// ─── Mock factory helpers ─────────────────────────────────────────────────────

function makePublicClient(overrides: {
  blockNumber?: bigint;
  blockNumberError?: unknown;
  balanceOf?: bigint;
  balanceOfError?: unknown;
  tokenIds?: bigint[];
  tokenIdErrors?: Record<number, unknown>;
}) {
  return {
    async getBlockNumber() {
      if (overrides.blockNumberError) throw overrides.blockNumberError;
      return overrides.blockNumber ?? BLOCK;
    },
    async readContract(args: {
      functionName: string;
      args?: unknown[];
    }) {
      if (args.functionName === "balanceOf") {
        if (overrides.balanceOfError) throw overrides.balanceOfError;
        return overrides.balanceOf ?? 0n;
      }
      if (args.functionName === "tokenOfOwnerByIndex") {
        const index = Number((args.args as [unknown, bigint])[1]);
        if (overrides.tokenIdErrors?.[index]) {
          throw overrides.tokenIdErrors[index];
        }
        return overrides.tokenIds?.[index] ?? BigInt(index + 1);
      }
      throw new Error(`Unexpected readContract call: ${args.functionName}`);
    },
  } as unknown as HsiDiscoveryReadClient;
}

// Builds a mock persistence client that tracks calls and controls results.
function makePersistenceClient(
  responses: Map<string, { id: string; created: boolean }> = new Map(),
  defaultCreated = true,
) {
  const calls: PersistHsiStakeObservationInput[] = [];
  let callCount = 0;

  const client = {
    rawHsiStakeObservation: {
      async create(args: { data: PersistHsiStakeObservationInput; select: { id: true } }) {
        calls.push(args.data);
        const key = `${args.data.hsiTokenId}`;
        const existing = responses.get(key);
        if (existing && !existing.created) {
          const err = Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
          Object.setPrototypeOf(
            err,
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require("@prisma/client").Prisma.PrismaClientKnownRequestError.prototype,
          );
          throw err;
        }
        callCount++;
        return { id: existing?.id ?? `mock-id-${callCount}` };
      },
      async findFirst() {
        return { id: "existing-id" };
      },
      async findMany() {
        return [];
      },
    },
    _calls: calls,
  };
  return client;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("discoverHsiStakeObservations", () => {
  it("returns ok: true with zero counts when wallet owns no HSI NFTs", async () => {
    const publicClient = makePublicClient({ balanceOf: 0n });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discovered).toBe(0);
    expect(result.persisted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(persistenceClient._calls).toHaveLength(0);
  });

  it("persists one observation when wallet owns one HSI NFT", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
    });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discovered).toBe(1);
    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(persistenceClient._calls).toHaveLength(1);
    expect(persistenceClient._calls[0].hsiTokenId).toBe("42");
  });

  it("persists all observations when wallet owns multiple HSI NFTs", async () => {
    const publicClient = makePublicClient({
      balanceOf: 3n,
      tokenIds: [100n, 200n, 300n],
    });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discovered).toBe(3);
    expect(result.persisted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(persistenceClient._calls.map((c) => c.hsiTokenId)).toEqual([
      "100",
      "200",
      "300",
    ]);
  });

  it("duplicate discovery returns created: false and increments skipped, not persisted", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
    });
    // Configure token "42" to return created: false (duplicate)
    const responses = new Map([["42", { id: "existing-id", created: false }]]);
    const persistenceClient = makePersistenceClient(responses);

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discovered).toBe(1);
    expect(result.persisted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("persists with null stake fields and isComplete: false", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
    });
    const persistenceClient = makePersistenceClient();
    const observedAt = new Date("2026-07-03T12:00:00Z");

    await discoverHsiStakeObservations(
      {
        chainId: CHAIN_ID,
        walletAddress: WALLET,
        hsiAddress: HEDRON_ADDRESS,
        observedAt,
      },
      { publicClient, persistenceClient },
    );

    const call = persistenceClient._calls[0];
    expect(call.stakeId).toBeNull();
    expect(call.stakeIndex).toBeNull();
    expect(call.stakedDays).toBeNull();
    expect(call.lockedDay).toBeNull();
    expect(call.stakeShares).toBeNull();
    expect(call.principalHex).toBeNull();
    expect(call.isComplete).toBe(false);
    expect(call.observedAt).toEqual(observedAt);
  });

  it("populates warnings with hexmining-hsi-stake-fields-unknown for each observation", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
    });
    const persistenceClient = makePersistenceClient();

    await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    const call = persistenceClient._calls[0];
    expect(call.warnings).toContain("hexmining-hsi-stake-fields-unknown");
  });

  it("normalizes walletAddress to lowercase before persistence", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [1n],
    });
    const persistenceClient = makePersistenceClient();

    await discoverHsiStakeObservations(
      {
        chainId: CHAIN_ID,
        walletAddress: "0xAbCdEf0000000000000000000000000000000001",
        hsiAddress: HEDRON_ADDRESS,
      },
      { publicClient, persistenceClient },
    );

    expect(persistenceClient._calls[0].walletAddress).toBe(WALLET_LOWER);
  });

  it("normalizes hsiAddress to lowercase before persistence", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [1n],
    });
    const persistenceClient = makePersistenceClient();

    await discoverHsiStakeObservations(
      {
        chainId: CHAIN_ID,
        walletAddress: WALLET,
        hsiAddress: HEDRON_ADDRESS.toUpperCase(),
      },
      { publicClient, persistenceClient },
    );

    expect(persistenceClient._calls[0].hsiAddress).toBe(HEDRON_ADDRESS);
  });

  it("handles uint256-sized token IDs safely as decimal strings", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [BigInt(UINT256_MAX)],
    });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(persistenceClient._calls[0].hsiTokenId).toBe(UINT256_MAX);
  });

  it("returns ok: false with unsupported-chain code and makes zero RPC or persistence calls", async () => {
    let getBlockNumberCalled = false;
    let readContractCalled = false;
    const publicClient = {
      async getBlockNumber() {
        getBlockNumberCalled = true;
        return BLOCK;
      },
      async readContract() {
        readContractCalled = true;
        return 0n;
      },
    } as unknown as import("@/services/hexmining/hsi-discovery").HsiDiscoveryReadClient;
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: 1, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("hexmining-hsi-discovery-unsupported-chain");
    expect(getBlockNumberCalled).toBe(false);
    expect(readContractCalled).toBe(false);
    expect(persistenceClient._calls).toHaveLength(0);
  });

  it("returns ok: false when getBlockNumber fails", async () => {
    const publicClient = makePublicClient({
      blockNumberError: new Error("network unreachable"),
    });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toMatch(/^hexmining-hsi-discovery-block-rpc-/);
    expect(persistenceClient._calls).toHaveLength(0);
  });

  it("returns ok: false when balanceOf RPC call fails", async () => {
    const publicClient = makePublicClient({
      balanceOfError: new Error("execution reverted"),
    });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toMatch(/^hexmining-hsi-discovery-balance-rpc-/);
    expect(persistenceClient._calls).toHaveLength(0);
  });

  it("skips failed tokenOfOwnerByIndex calls and continues with remaining tokens", async () => {
    const publicClient = makePublicClient({
      balanceOf: 3n,
      tokenIds: [100n, 200n, 300n],
      tokenIdErrors: { 1: new Error("timeout") }, // index 1 fails
    });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discovered).toBe(3);
    expect(result.persisted).toBe(2); // indices 0 and 2 succeeded
    expect(result.skipped).toBe(1); // index 1 failed
    expect(result.warnings.some((w) => w.includes("tokenindex") && w.includes("index=1"))).toBe(true);
    expect(persistenceClient._calls.map((c) => c.hsiTokenId)).toEqual(["100", "300"]);
  });

  it("propagates persistence errors that are not P2002", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [42n],
    });
    const brokenClient = {
      rawHsiStakeObservation: {
        async create() {
          throw new Error("database connection lost");
        },
        async findFirst() {
          return null;
        },
        async findMany() {
          return [];
        },
      },
      _calls: [] as PersistHsiStakeObservationInput[],
    };

    await expect(
      discoverHsiStakeObservations(
        { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
        {
          publicClient,
          persistenceClient:
            brokenClient as unknown as Parameters<
              typeof discoverHsiStakeObservations
            >[1]["persistenceClient"],
        },
      ),
    ).rejects.toThrow("database connection lost");
  });

  it("observedAtBlock in result is a decimal string matching the captured block", async () => {
    const publicClient = makePublicClient({
      blockNumber: 99999999n,
      balanceOf: 0n,
    });
    const persistenceClient = makePersistenceClient();

    const result = await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observedAtBlock).toBe("99999999");
  });

  it("all observations share the same observedAtBlock", async () => {
    const publicClient = makePublicClient({
      blockNumber: 55000000n,
      balanceOf: 2n,
      tokenIds: [10n, 20n],
    });
    const persistenceClient = makePersistenceClient();

    await discoverHsiStakeObservations(
      { chainId: CHAIN_ID, walletAddress: WALLET, hsiAddress: HEDRON_ADDRESS },
      { publicClient, persistenceClient },
    );

    expect(persistenceClient._calls[0].observedAtBlock).toBe(55000000n);
    expect(persistenceClient._calls[1].observedAtBlock).toBe(55000000n);
  });

  it("passes chainId and hsiAddress correctly to each observation", async () => {
    const publicClient = makePublicClient({
      balanceOf: 1n,
      tokenIds: [7n],
    });
    const persistenceClient = makePersistenceClient();

    await discoverHsiStakeObservations(
      {
        chainId: 369,
        walletAddress: WALLET,
        hsiAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      { publicClient, persistenceClient },
    );

    const call = persistenceClient._calls[0];
    expect(call.chainId).toBe(369);
    expect(call.hsiAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });
});
