import { describe, expect, it } from "vitest";

import { getMaterializationDiagnosticsReport } from "@/services/portfolio/materialization-diagnostics";

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

type LpPositionRecord = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  lpAssetId: string;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
  createdAt: Date;
  updatedAt: Date;
};

type StakePositionRecord = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  stakeKey: string;
  createdAt: Date;
  updatedAt: Date;
};

type MaterializationStateRecord = {
  walletId: string;
  walletAddress: string;
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
  createdAt: Date;
  updatedAt: Date;
};

function createMemoryDb(args?: {
  tokenBalances?: TokenBalanceRecord[];
  lpPositions?: LpPositionRecord[];
  stakePositions?: StakePositionRecord[];
  materializationStates?: MaterializationStateRecord[];
}) {
  const tokenBalances = args?.tokenBalances ?? [];
  const lpPositions = args?.lpPositions ?? [];
  const stakePositions = args?.stakePositions ?? [];
  const materializationStates = args?.materializationStates ?? [];

  return new Proxy(
    {
      portfolioTokenBalance: {
        async findMany() {
          return tokenBalances;
        },
      },
      portfolioLpPosition: {
        async findMany() {
          return lpPositions;
        },
      },
      portfolioStakePosition: {
        async findMany() {
          return stakePositions;
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

describe("getMaterializationDiagnosticsReport", () => {
  it("returns a deterministic empty report when no materialized state exists", async () => {
    const report = await getMaterializationDiagnosticsReport({
      db: createMemoryDb() as never,
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    expect(report).toEqual({
      updatedAt: "2026-05-10T10:00:00.000Z",
      wallets: [],
    });
  });

  it("reports healthy materialized state with counts and derivable coverage", async () => {
    const report = await getMaterializationDiagnosticsReport({
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: "wallet-1",
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 369,
            assetId: "chain:369:erc20:0xtokena",
            assetAddress: "0xtokena",
            balanceQuantity: "5",
            decimals: 6,
            updatedFromBlock: 100n,
            updatedToBlock: 120n,
            createdAt: new Date("2026-05-10T09:00:00.000Z"),
            updatedAt: new Date("2026-05-10T09:05:00.000Z"),
          },
        ],
        lpPositions: [
          {
            walletId: "wallet-1",
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 369,
            lpAssetId: "chain:369:erc20:0xlp",
            updatedFromBlock: 102n,
            updatedToBlock: 118n,
            createdAt: new Date("2026-05-10T09:01:00.000Z"),
            updatedAt: new Date("2026-05-10T09:06:00.000Z"),
          },
        ],
        stakePositions: [
          {
            walletId: "wallet-1",
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 369,
            stakeKey: "42",
            createdAt: new Date("2026-05-10T09:02:00.000Z"),
            updatedAt: new Date("2026-05-10T09:07:00.000Z"),
          },
        ],
        materializationStates: [
          {
            walletId: "wallet-1",
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 369,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-10T09:06:00.000Z"),
            latestMaterializedAt: new Date("2026-05-10T09:06:30.000Z"),
            sourceLedgerFromBlock: 90n,
            sourceLedgerToBlock: 130n,
            updatedFromBlock: 95n,
            updatedToBlock: 125n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
            createdAt: new Date("2026-05-10T09:06:30.000Z"),
            updatedAt: new Date("2026-05-10T09:06:30.000Z"),
          },
        ],
      }) as never,
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    expect(report).toEqual({
      updatedAt: "2026-05-10T10:00:00.000Z",
      wallets: [
        {
          walletId: "wallet-1",
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          status: "COMPLETED",
          completedSuccessfully: true,
          lastAttemptedAt: "2026-05-10T09:06:00.000Z",
          latestMaterializedAt: "2026-05-10T09:06:30.000Z",
          sourceLedgerFromBlock: "90",
          sourceLedgerToBlock: "130",
          updatedFromBlock: "95",
          updatedToBlock: "125",
          tokenBalanceCount: 1,
          lpPositionCount: 1,
          stakePositionCount: 1,
          warningCount: 0,
          warningHistoryCount: null,
          warningHistoryAvailable: false,
          warnings: [],
          hasNegativeBalances: false,
          negativeBalances: [],
        },
      ],
    });
  });

  it("reports current negative balance warnings from persisted materialized rows", async () => {
    const report = await getMaterializationDiagnosticsReport({
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: "wallet-1",
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 369,
            assetId: "chain:369:native:PLS",
            assetAddress: null,
            balanceQuantity: "-0.25",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
            createdAt: new Date("2026-05-10T09:00:00.000Z"),
            updatedAt: new Date("2026-05-10T09:05:00.000Z"),
          },
        ],
        materializationStates: [
          {
            walletId: "wallet-1",
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 369,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-10T09:04:00.000Z"),
            latestMaterializedAt: new Date("2026-05-10T09:05:30.000Z"),
            sourceLedgerFromBlock: 200n,
            sourceLedgerToBlock: 220n,
            updatedFromBlock: 200n,
            updatedToBlock: 220n,
            warningCount: 1,
            warningDetails: ["negative-token-balance:chain:369:native:PLS:-0.25"],
            errorMessage: null,
            createdAt: new Date("2026-05-10T09:05:30.000Z"),
            updatedAt: new Date("2026-05-10T09:05:30.000Z"),
          },
        ],
      }) as never,
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    expect(report.wallets[0]).toEqual({
      walletId: "wallet-1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      status: "COMPLETED",
      completedSuccessfully: true,
      lastAttemptedAt: "2026-05-10T09:04:00.000Z",
      latestMaterializedAt: "2026-05-10T09:05:30.000Z",
      sourceLedgerFromBlock: "200",
      sourceLedgerToBlock: "220",
      updatedFromBlock: "200",
      updatedToBlock: "220",
      tokenBalanceCount: 1,
      lpPositionCount: 0,
      stakePositionCount: 0,
      warningCount: 1,
      warningHistoryCount: null,
      warningHistoryAvailable: false,
      warnings: [
        {
          code: "negative_token_balance",
          message: "Negative materialized token balance for chain:369:native:PLS: -0.25",
        },
      ],
      hasNegativeBalances: true,
      negativeBalances: [
        {
          assetId: "chain:369:native:PLS",
          assetAddress: null,
          balanceQuantity: "-0.25",
          decimals: 18,
        },
      ],
    });
  });

  it("reports persisted provenance even when no materialized rows currently exist", async () => {
    const report = await getMaterializationDiagnosticsReport({
      db: createMemoryDb({
        materializationStates: [
          {
            walletId: "wallet-2",
            walletAddress: "0x2222222222222222222222222222222222222222",
            chainId: 369,
            status: "COMPLETED",
            completedSuccessfully: true,
            lastAttemptedAt: new Date("2026-05-10T09:10:00.000Z"),
            latestMaterializedAt: new Date("2026-05-10T09:10:30.000Z"),
            sourceLedgerFromBlock: 300n,
            sourceLedgerToBlock: 330n,
            updatedFromBlock: 300n,
            updatedToBlock: 330n,
            warningCount: 0,
            warningDetails: [],
            errorMessage: null,
            createdAt: new Date("2026-05-10T09:10:30.000Z"),
            updatedAt: new Date("2026-05-10T09:10:30.000Z"),
          },
        ],
      }) as never,
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    expect(report.wallets).toEqual([
      {
        walletId: "wallet-2",
        walletAddress: "0x2222222222222222222222222222222222222222",
        chainId: 369,
        status: "COMPLETED",
        completedSuccessfully: true,
        lastAttemptedAt: "2026-05-10T09:10:00.000Z",
        latestMaterializedAt: "2026-05-10T09:10:30.000Z",
        sourceLedgerFromBlock: "300",
        sourceLedgerToBlock: "330",
        updatedFromBlock: "300",
        updatedToBlock: "330",
        tokenBalanceCount: 0,
        lpPositionCount: 0,
        stakePositionCount: 0,
        warningCount: 0,
        warningHistoryCount: null,
        warningHistoryAvailable: false,
        warnings: [],
        hasNegativeBalances: false,
        negativeBalances: [],
      },
    ]);
  });

  it("sorts wallet diagnostics deterministically", async () => {
    const report = await getMaterializationDiagnosticsReport({
      db: createMemoryDb({
        tokenBalances: [
          {
            walletId: "wallet-b",
            walletAddress: "0x2222222222222222222222222222222222222222",
            chainId: 369,
            assetId: "chain:369:erc20:0xtokenb",
            assetAddress: "0xtokenb",
            balanceQuantity: "1",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
            createdAt: new Date("2026-05-10T09:00:00.000Z"),
            updatedAt: new Date("2026-05-10T09:05:00.000Z"),
          },
          {
            walletId: "wallet-a",
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 369,
            assetId: "chain:369:erc20:0xtokena",
            assetAddress: "0xtokena",
            balanceQuantity: "1",
            decimals: 18,
            updatedFromBlock: null,
            updatedToBlock: null,
            createdAt: new Date("2026-05-10T09:00:00.000Z"),
            updatedAt: new Date("2026-05-10T09:05:00.000Z"),
          },
        ],
      }) as never,
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    expect(report.wallets.map((wallet) => wallet.walletId)).toEqual([
      "wallet-a",
      "wallet-b",
    ]);
  });
});
