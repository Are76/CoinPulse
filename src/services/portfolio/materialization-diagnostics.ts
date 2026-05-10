import "server-only";

import { getDb } from "@/lib/db";

type MaterializationDiagnosticsDbClient = {
  portfolioTokenBalance: {
    findMany(args?: {
      orderBy?: Array<
        { chainId?: "asc" | "desc" } | { walletAddress?: "asc" | "desc" } | { assetId?: "asc" | "desc" }
      >;
    }): Promise<
      Array<{
        walletId: string;
        walletAddress: string;
        chainId: number;
        assetId: string;
        assetAddress: string | null;
        balanceQuantity: string | { toString(): string };
        decimals: number | null;
        updatedFromBlock: bigint | null;
        updatedToBlock: bigint | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >;
  };
  portfolioLpPosition: {
    findMany(args?: {
      orderBy?: Array<{ chainId?: "asc" | "desc" } | { walletAddress?: "asc" | "desc" } | { lpAssetId?: "asc" | "desc" }>;
    }): Promise<
      Array<{
        walletId: string;
        walletAddress: string;
        chainId: number;
        lpAssetId: string;
        updatedFromBlock: bigint | null;
        updatedToBlock: bigint | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >;
  };
  portfolioStakePosition: {
    findMany(args?: {
      orderBy?: Array<{ chainId?: "asc" | "desc" } | { walletAddress?: "asc" | "desc" } | { stakeKey?: "asc" | "desc" }>;
    }): Promise<
      Array<{
        walletId: string;
        walletAddress: string;
        chainId: number;
        stakeKey: string;
        createdAt: Date;
        updatedAt: Date;
      }>
    >;
  };
};

export type MaterializationWarningCode = "negative_token_balance";

export type MaterializationWarning = {
  code: MaterializationWarningCode;
  message: string;
};

export type NegativeBalanceDiagnostic = {
  assetId: string;
  assetAddress: string | null;
  balanceQuantity: string;
  decimals: number | null;
};

export type WalletMaterializationDiagnostics = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  latestMaterializedAt: string | null;
  updatedFromBlock: string | null;
  updatedToBlock: string | null;
  tokenBalanceCount: number;
  lpPositionCount: number;
  stakePositionCount: number;
  warningCount: number;
  warningHistoryCount: null;
  warningHistoryAvailable: false;
  warnings: MaterializationWarning[];
  hasNegativeBalances: boolean;
  negativeBalances: NegativeBalanceDiagnostic[];
};

export type MaterializationDiagnosticsReport = {
  updatedAt: string;
  wallets: WalletMaterializationDiagnostics[];
};

type WalletAccumulator = {
  walletId: string;
  walletAddress: string;
  chainId: number;
  latestMaterializedAt: Date | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
  tokenBalanceCount: number;
  lpPositionCount: number;
  stakePositionCount: number;
  negativeBalances: NegativeBalanceDiagnostic[];
};

export async function getMaterializationDiagnosticsReport(args: {
  db?: MaterializationDiagnosticsDbClient;
  now?: Date;
} = {}): Promise<MaterializationDiagnosticsReport> {
  const db = args.db ?? (getDb() as unknown as MaterializationDiagnosticsDbClient);
  const now = args.now ?? new Date();
  const [tokenBalances, lpPositions, stakePositions] = await Promise.all([
    db.portfolioTokenBalance.findMany({
      orderBy: [{ chainId: "asc" }, { walletAddress: "asc" }, { assetId: "asc" }],
    }),
    db.portfolioLpPosition.findMany({
      orderBy: [{ chainId: "asc" }, { walletAddress: "asc" }, { lpAssetId: "asc" }],
    }),
    db.portfolioStakePosition.findMany({
      orderBy: [{ chainId: "asc" }, { walletAddress: "asc" }, { stakeKey: "asc" }],
    }),
  ]);

  const wallets = new Map<string, WalletAccumulator>();

  for (const row of tokenBalances) {
    const wallet = getOrCreateWalletAccumulator(wallets, row);
    wallet.tokenBalanceCount += 1;
    wallet.latestMaterializedAt = maxDate(wallet.latestMaterializedAt, row.updatedAt ?? row.createdAt);
    wallet.updatedFromBlock = minBigInt(wallet.updatedFromBlock, row.updatedFromBlock);
    wallet.updatedToBlock = maxBigInt(wallet.updatedToBlock, row.updatedToBlock);

    const balanceQuantity = toStringValue(row.balanceQuantity);
    if (isNegativeDecimal(balanceQuantity)) {
      wallet.negativeBalances.push({
        assetId: row.assetId,
        assetAddress: row.assetAddress,
        balanceQuantity,
        decimals: row.decimals,
      });
    }
  }

  for (const row of lpPositions) {
    const wallet = getOrCreateWalletAccumulator(wallets, row);
    wallet.lpPositionCount += 1;
    wallet.latestMaterializedAt = maxDate(wallet.latestMaterializedAt, row.updatedAt ?? row.createdAt);
    wallet.updatedFromBlock = minBigInt(wallet.updatedFromBlock, row.updatedFromBlock);
    wallet.updatedToBlock = maxBigInt(wallet.updatedToBlock, row.updatedToBlock);
  }

  for (const row of stakePositions) {
    const wallet = getOrCreateWalletAccumulator(wallets, row);
    wallet.stakePositionCount += 1;
    wallet.latestMaterializedAt = maxDate(wallet.latestMaterializedAt, row.updatedAt ?? row.createdAt);
  }

  return {
    updatedAt: now.toISOString(),
    wallets: Array.from(wallets.values())
      .sort((left, right) =>
        left.chainId === right.chainId
          ? left.walletAddress === right.walletAddress
            ? left.walletId.localeCompare(right.walletId)
            : left.walletAddress.localeCompare(right.walletAddress)
          : left.chainId - right.chainId,
      )
      .map((wallet) => {
        const negativeBalances = [...wallet.negativeBalances].sort((left, right) =>
          left.assetId.localeCompare(right.assetId),
        );
        const warnings = negativeBalances.map((negativeBalance) => ({
          code: "negative_token_balance" as const,
          message: `Negative materialized token balance for ${negativeBalance.assetId}: ${negativeBalance.balanceQuantity}`,
        }));

        return {
          walletId: wallet.walletId,
          walletAddress: wallet.walletAddress,
          chainId: wallet.chainId,
          latestMaterializedAt: wallet.latestMaterializedAt?.toISOString() ?? null,
          updatedFromBlock: bigintToString(wallet.updatedFromBlock),
          updatedToBlock: bigintToString(wallet.updatedToBlock),
          tokenBalanceCount: wallet.tokenBalanceCount,
          lpPositionCount: wallet.lpPositionCount,
          stakePositionCount: wallet.stakePositionCount,
          warningCount: warnings.length,
          warningHistoryCount: null,
          warningHistoryAvailable: false as const,
          warnings,
          hasNegativeBalances: negativeBalances.length > 0,
          negativeBalances,
        };
      }),
  };
}

function getOrCreateWalletAccumulator(
  wallets: Map<string, WalletAccumulator>,
  row: { walletId: string; walletAddress: string; chainId: number },
) {
  const key = `${row.walletId}:${row.chainId}`;
  const existing = wallets.get(key);
  if (existing) {
    return existing;
  }

  const created: WalletAccumulator = {
    walletId: row.walletId,
    walletAddress: row.walletAddress,
    chainId: row.chainId,
    latestMaterializedAt: null,
    updatedFromBlock: null,
    updatedToBlock: null,
    tokenBalanceCount: 0,
    lpPositionCount: 0,
    stakePositionCount: 0,
    negativeBalances: [],
  };
  wallets.set(key, created);
  return created;
}

function maxDate(current: Date | null, candidate: Date | null) {
  if (!candidate) {
    return current;
  }
  if (!current || candidate.getTime() > current.getTime()) {
    return candidate;
  }
  return current;
}

function minBigInt(current: bigint | null, candidate: bigint | null) {
  if (candidate === null) {
    return current;
  }
  if (current === null || candidate < current) {
    return candidate;
  }
  return current;
}

function maxBigInt(current: bigint | null, candidate: bigint | null) {
  if (candidate === null) {
    return current;
  }
  if (current === null || candidate > current) {
    return candidate;
  }
  return current;
}

function bigintToString(value: bigint | null) {
  return value === null ? null : value.toString();
}

function toStringValue(value: string | { toString(): string }) {
  return typeof value === "string" ? value : value.toString();
}

function isNegativeDecimal(value: string) {
  return value.trim().startsWith("-") && value.trim() !== "-0" && value.trim() !== "-0.0";
}
