import { afterEach, describe, expect, it, vi } from "vitest";

const CHAIN_ID = 369;
const WALLET_ID = "wallet-1";
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WALLET_TOPIC =
  "0x0000000000000000000000001111111111111111111111111111111111111111";

type SyncRunRecord = {
  id: string;
  trigger: "MANUAL" | "IMPORT" | "REBUILD";
  status: "PENDING" | "RUNNING" | "FAILED" | "COMPLETED";
  stage: string;
  chainId: number;
  walletId: string | null;
  wallet: { address: string } | null;
  warningCount: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  sourceFamilies?: Array<"TRANSFERS" | "DEX" | "LP" | "STAKING" | "NATIVE">;
  policyLabel?: string | null;
  startBlock?: bigint | null;
  endBlock?: bigint | null;
  failedSourceFamily?: "TRANSFERS" | "DEX" | "LP" | "STAKING" | "NATIVE" | null;
  failedFromBlock?: bigint | null;
  failedToBlock?: bigint | null;
};

type TokenBalanceRecord = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  assetId: string;
  assetAddress: string | null;
  balanceQuantity: string;
  decimals: number | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
  createdAt: Date;
  updatedAt: Date;
};

type MaterializationStateRecord = {
  walletId: string;
  chainId: number;
  status: "RUNNING" | "FAILED" | "COMPLETED";
  completedSuccessfully: boolean;
  lastAttemptedAt: Date;
  latestMaterializedAt: Date | null;
  sourceLedgerFromBlock: bigint | null;
  sourceLedgerToBlock: bigint | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
  warningCount: number;
  warningDetails: unknown;
  errorMessage: string | null;
  wallet?: { addressLower: string } | null;
};

type RawBlockRecord = {
  chainId: number;
  status: "ACTIVE" | "INACTIVE";
  blockNumber: bigint;
};

type RawTransactionRecord = {
  chainId: number;
  status: "ACTIVE" | "INACTIVE";
  blockNumber: bigint;
  fromAddress: string;
  toAddress: string | null;
};

type RawLogRecord = {
  chainId: number;
  status: "ACTIVE" | "INACTIVE";
  blockNumber: bigint;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
};

function countMatching<T>(rows: T[], predicate: (row: T) => boolean) {
  return rows.filter(predicate).length;
}

function createMemoryDb(overrides?: {
  syncRuns?: SyncRunRecord[];
  tokenBalances?: TokenBalanceRecord[];
  materializationStates?: MaterializationStateRecord[];
  rawBlocks?: RawBlockRecord[];
  rawTransactions?: RawTransactionRecord[];
  rawLogs?: RawLogRecord[];
}) {
  const syncRuns = overrides?.syncRuns ?? [];
  const tokenBalances = overrides?.tokenBalances ?? [];
  const materializationStates = overrides?.materializationStates ?? [];
  const rawBlocks = overrides?.rawBlocks ?? [];
  const rawTransactions = overrides?.rawTransactions ?? [];
  const rawLogs = overrides?.rawLogs ?? [];

  return new Proxy(
    {
      syncRun: {
        async findMany() {
          return syncRuns;
        },
        async findFirst(args: {
          where: {
            trigger?:
              | "REBUILD"
              | { in?: Array<"MANUAL" | "IMPORT" | "REBUILD">; equals?: "REBUILD" };
            status?: "COMPLETED" | { in: Array<"RUNNING" | "COMPLETED"> };
          };
          orderBy?: Array<{ updatedAt?: "desc" | "asc"; createdAt?: "desc" | "asc" }>;
        }) {
          return (
            syncRuns.find((row) => {
              const triggerFilter = args.where.trigger;
              const statusFilter = args.where.status;
              const triggerMatch =
                !triggerFilter ||
                (typeof triggerFilter === "string"
                  ? row.trigger === triggerFilter
                  : "in" in triggerFilter
                    ? triggerFilter.in?.includes(row.trigger)
                    : row.trigger === triggerFilter.equals);
              const statusMatch =
                !statusFilter ||
                typeof statusFilter === "string"
                  ? row.status === statusFilter
                  : statusFilter.in.some((status) => status === row.status);
              return triggerMatch && statusMatch;
            }) ?? null
          );
        },
      },
      rawBlock: {
        async count(args: {
          where: {
            chainId: number;
            status: "ACTIVE";
            blockNumber: { gte: bigint; lte: bigint };
          };
        }) {
          return countMatching(
            rawBlocks,
            (row) =>
              row.chainId === args.where.chainId &&
              row.status === args.where.status &&
              row.blockNumber >= args.where.blockNumber.gte &&
              row.blockNumber <= args.where.blockNumber.lte,
          );
        },
      },
      rawTransaction: {
        async count(args: {
          where: {
            chainId: number;
            status: "ACTIVE";
            blockNumber: { gte: bigint; lte: bigint };
            OR: Array<{ fromAddress?: string; toAddress?: string }>;
          };
        }) {
          return countMatching(
            rawTransactions,
            (row) =>
              row.chainId === args.where.chainId &&
              row.status === args.where.status &&
              row.blockNumber >= args.where.blockNumber.gte &&
              row.blockNumber <= args.where.blockNumber.lte &&
              args.where.OR.some(
                (clause) =>
                  (clause.fromAddress !== undefined &&
                    row.fromAddress === clause.fromAddress) ||
                  (clause.toAddress !== undefined && row.toAddress === clause.toAddress),
              ),
          );
        },
      },
      rawLog: {
        async count(args: {
          where: {
            chainId: number;
            status: "ACTIVE";
            blockNumber: { gte: bigint; lte: bigint };
            topic0: string;
            OR: Array<{ topic1?: string; topic2?: string }>;
          };
        }) {
          return countMatching(
            rawLogs,
            (row) =>
              row.chainId === args.where.chainId &&
              row.status === args.where.status &&
              row.blockNumber >= args.where.blockNumber.gte &&
              row.blockNumber <= args.where.blockNumber.lte &&
              row.topic0 === args.where.topic0 &&
              args.where.OR.some(
                (clause) =>
                  (clause.topic1 !== undefined && row.topic1 === clause.topic1) ||
                  (clause.topic2 !== undefined && row.topic2 === clause.topic2),
              ),
          );
        },
      },
      portfolioTokenBalance: {
        async findMany() {
          return tokenBalances;
        },
      },
      portfolioLpPosition: {
        async findMany() {
          return [];
        },
      },
      portfolioStakePosition: {
        async findMany() {
          return [];
        },
      },
      portfolioMaterializationState: {
        async findMany() {
          return materializationStates;
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

const getDb = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb,
}));

describe("GET /api/debug/status route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns persisted ingestion and materialization diagnostics end-to-end", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        syncRuns: [
          {
            id: "run-1",
            trigger: "MANUAL",
            status: "FAILED",
            stage: "INGEST_TRANSFERS",
            chainId: CHAIN_ID,
            walletId: WALLET_ID,
            wallet: { address: WALLET_ADDRESS },
            warningCount: 2,
            errorMessage: "sync exploded",
            createdAt: new Date("2026-05-08T12:00:00.000Z"),
            updatedAt: new Date("2026-05-08T12:04:00.000Z"),
            sourceFamilies: ["TRANSFERS"],
            policyLabel: "manual-sync",
            startBlock: 100n,
            endBlock: 4100n,
            failedSourceFamily: "TRANSFERS",
            failedFromBlock: 100n,
            failedToBlock: 4100n,
          },
        ],
        rawBlocks: [
          { chainId: CHAIN_ID, status: "ACTIVE", blockNumber: 100n },
          { chainId: CHAIN_ID, status: "ACTIVE", blockNumber: 2100n },
          { chainId: CHAIN_ID, status: "ACTIVE", blockNumber: 4100n },
        ],
        rawTransactions: [
          {
            chainId: CHAIN_ID,
            status: "ACTIVE",
            blockNumber: 100n,
            fromAddress: WALLET_ADDRESS.toLowerCase(),
            toAddress: "0x2222222222222222222222222222222222222222",
          },
          {
            chainId: CHAIN_ID,
            status: "ACTIVE",
            blockNumber: 4100n,
            fromAddress: "0x3333333333333333333333333333333333333333",
            toAddress: WALLET_ADDRESS.toLowerCase(),
          },
        ],
        rawLogs: [
          {
            chainId: CHAIN_ID,
            status: "ACTIVE",
            blockNumber: 100n,
            topic0: TRANSFER_TOPIC,
            topic1: WALLET_TOPIC,
            topic2: null,
          },
          {
            chainId: CHAIN_ID,
            status: "ACTIVE",
            blockNumber: 4100n,
            topic0: TRANSFER_TOPIC,
            topic1: null,
            topic2: WALLET_TOPIC,
          },
        ],
        tokenBalances: [
          {
            walletId: WALLET_ID,
            walletAddress: WALLET_ADDRESS,
            chainId: CHAIN_ID,
            assetId: "chain:369:native:PLS",
            assetAddress: null,
            balanceQuantity: "-0.25",
            decimals: 18,
            updatedFromBlock: 100n,
            updatedToBlock: 4100n,
            createdAt: new Date("2026-05-08T12:03:00.000Z"),
            updatedAt: new Date("2026-05-08T12:03:30.000Z"),
          },
        ],
        materializationStates: [
          {
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            status: "FAILED",
            completedSuccessfully: false,
            lastAttemptedAt: new Date("2026-05-08T12:04:00.000Z"),
            latestMaterializedAt: new Date("2026-05-08T12:03:30.000Z"),
            sourceLedgerFromBlock: null,
            sourceLedgerToBlock: null,
            updatedFromBlock: 100n,
            updatedToBlock: 4100n,
            warningCount: 2,
            warningDetails: [
              "negative-token-balance:chain:369:native:PLS:-0.25",
              "stake-key-missing:null",
            ],
            errorMessage: "materialization exploded",
            wallet: { addressLower: WALLET_ADDRESS.toLowerCase() },
          },
        ],
      }),
    );

    const { GET } = await import("../../app/api/debug/status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "ok",
        sourceFamilies: ["TRANSFERS", "DEX", "LP", "STAKING", "NATIVE"],
        operationState: {
          ingestionDiagnostics: [
            {
              operationId: "run-1",
              walletId: WALLET_ID,
              walletAddress: WALLET_ADDRESS,
              chainId: CHAIN_ID,
              sourceFamily: "TRANSFERS",
              requestedFromBlock: "100",
              requestedToBlock: "4100",
              rangeStatus: "exact",
              rangeWarning: null,
              nativeScanWindowCount: 3,
              nativeScanWindows: [
                { fromBlock: "100", toBlock: "2099" },
                { fromBlock: "2100", toBlock: "4099" },
                { fromBlock: "4100", toBlock: "4100" },
              ],
              rawBlocksPersistedCount: 3,
              rawTransactionsPersistedCount: 2,
              rawLogsPersistedCount: 2,
              warningCount: 2,
            },
          ],
        },
        materializationDiagnostics: {
          wallets: [
            {
              walletId: WALLET_ID,
              walletAddress: WALLET_ADDRESS.toLowerCase(),
              chainId: CHAIN_ID,
              status: "FAILED",
              completedSuccessfully: false,
              lastAttemptedAt: "2026-05-08T12:04:00.000Z",
              latestMaterializedAt: "2026-05-08T12:03:30.000Z",
              updatedFromBlock: "100",
              updatedToBlock: "4100",
              warningCount: 2,
              warnings: [
                {
                  code: "negative_token_balance",
                  message:
                    "Negative materialized token balance for chain:369:native:PLS: -0.25",
                },
                {
                  code: "generic_persisted_warning",
                  message: "stake-key-missing:null",
                },
              ],
              errorMessage: "materialization exploded",
              hasNegativeBalances: true,
              negativeBalances: [
                {
                  assetId: "chain:369:native:PLS",
                  assetAddress: null,
                  balanceQuantity: "-0.25",
                  decimals: 18,
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("handles missing persisted diagnostics safely", async () => {
    getDb.mockReturnValue(
      createMemoryDb({
        syncRuns: [],
        rawBlocks: [],
        rawTransactions: [],
        rawLogs: [],
        tokenBalances: [],
        materializationStates: [],
      }),
    );

    const { GET } = await import("../../app/api/debug/status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        operationState: {
          operations: [],
          ingestionDiagnostics: [],
          warnings: expect.any(Array),
        },
        materializationDiagnostics: {
          wallets: [],
        },
      },
    });
  });
});
