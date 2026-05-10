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
  portfolioMaterializationState: {
    findMany(args?: {
      orderBy?: Array<{ chainId?: "asc" | "desc" } | { walletId?: "asc" | "desc" }>;
      include?: { wallet?: { select: { addressLower: true } } };
    }): Promise<
      Array<{
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
        walletAddress?: string;
        wallet?: { addressLower: string } | null;
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
  status: "RUNNING" | "FAILED" | "COMPLETED" | null;
  completedSuccessfully: boolean | null;
  lastAttemptedAt: string | null;
  latestMaterializedAt: string | null;
  sourceLedgerFromBlock: string | null;
  sourceLedgerToBlock: string | null;
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
  status: "RUNNING" | "FAILED" | "COMPLETED" | null;
  completedSuccessfully: boolean | null;
  lastAttemptedAt: Date | null;
  latestMaterializedAt: Date | null;
  sourceLedgerFromBlock: bigint | null;
  sourceLedgerToBlock: bigint | null;
  updatedFromBlock: bigint | null;
  updatedToBlock: bigint | null;
  tokenBalanceCount: number;
  lpPositionCount: number;
  stakePositionCount: number;
  negativeBalances: NegativeBalanceDiagnostic[];
  persistedWarnings: MaterializationWarning[];
};

export async function getMaterializationDiagnosticsReport(args: {
  db?: MaterializationDiagnosticsDbClient;
  now?: Date;
} = {}): Promise<MaterializationDiagnosticsReport> {
  const db = args.db ?? (getDb() as unknown as MaterializationDiagnosticsDbClient);
  const now = args.now ?? new Date();
  const [tokenBalances, lpPositions, stakePositions, materializationStates] = await Promise.all([
    db.portfolioTokenBalance.findMany({
      orderBy: [{ chainId: "asc" }, { walletAddress: "asc" }, { assetId: "asc" }],
    }),
    db.portfolioLpPosition.findMany({
      orderBy: [{ chainId: "asc" }, { walletAddress: "asc" }, { lpAssetId: "asc" }],
    }),
    db.portfolioStakePosition.findMany({
      orderBy: [{ chainId: "asc" }, { walletAddress: "asc" }, { stakeKey: "asc" }],
    }),
    db.portfolioMaterializationState.findMany({
      orderBy: [{ chainId: "asc" }, { walletId: "asc" }],
      include: { wallet: { select: { addressLower: true } } },
    }),
  ]);

  const wallets = new Map<string, WalletAccumulator>();

  for (const row of materializationStates) {
    const wallet = getOrCreateWalletAccumulator(wallets, {
      walletId: row.walletId,
      walletAddress: row.wallet?.addressLower ?? row.walletAddress ?? "",
      chainId: row.chainId,
    });
    wallet.status = row.status;
    wallet.completedSuccessfully = row.completedSuccessfully;
    wallet.lastAttemptedAt = row.lastAttemptedAt;
    wallet.latestMaterializedAt = row.latestMaterializedAt ?? wallet.latestMaterializedAt;
    wallet.sourceLedgerFromBlock = row.sourceLedgerFromBlock;
    wallet.sourceLedgerToBlock = row.sourceLedgerToBlock;
    wallet.updatedFromBlock = row.updatedFromBlock ?? wallet.updatedFromBlock;
    wallet.updatedToBlock = row.updatedToBlock ?? wallet.updatedToBlock;
    wallet.persistedWarnings = normalizePersistedWarnings(row.warningDetails);
  }

  for (const row of tokenBalances) {
    const wallet = getOrCreateWalletAccumulator(wallets, row);
    wallet.tokenBalanceCount += 1;
    wallet.latestMaterializedAt =
      wallet.latestMaterializedAt ?? row.updatedAt ?? row.createdAt;
    wallet.updatedFromBlock =
      wallet.updatedFromBlock ?? row.updatedFromBlock;
    wallet.updatedToBlock =
      wallet.updatedToBlock ?? row.updatedToBlock;

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
    wallet.latestMaterializedAt =
      wallet.latestMaterializedAt ?? row.updatedAt ?? row.createdAt;
    wallet.updatedFromBlock =
      wallet.updatedFromBlock ?? row.updatedFromBlock;
    wallet.updatedToBlock =
      wallet.updatedToBlock ?? row.updatedToBlock;
  }

  for (const row of stakePositions) {
    const wallet = getOrCreateWalletAccumulator(wallets, row);
    wallet.stakePositionCount += 1;
    wallet.latestMaterializedAt =
      wallet.latestMaterializedAt ?? row.updatedAt ?? row.createdAt;
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
        const warnings = mergeWarnings(
          wallet.persistedWarnings,
          negativeBalances.map((negativeBalance) => ({
            code: "negative_token_balance" as const,
            message: `Negative materialized token balance for ${negativeBalance.assetId}: ${negativeBalance.balanceQuantity}`,
          })),
        );

        return {
          walletId: wallet.walletId,
          walletAddress: wallet.walletAddress,
          chainId: wallet.chainId,
          status: wallet.status,
          completedSuccessfully: wallet.completedSuccessfully,
          lastAttemptedAt: wallet.lastAttemptedAt?.toISOString() ?? null,
          latestMaterializedAt: wallet.latestMaterializedAt?.toISOString() ?? null,
          sourceLedgerFromBlock: bigintToString(wallet.sourceLedgerFromBlock),
          sourceLedgerToBlock: bigintToString(wallet.sourceLedgerToBlock),
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
    status: null,
    completedSuccessfully: null,
    lastAttemptedAt: null,
    latestMaterializedAt: null,
    sourceLedgerFromBlock: null,
    sourceLedgerToBlock: null,
    updatedFromBlock: null,
    updatedToBlock: null,
    tokenBalanceCount: 0,
    lpPositionCount: 0,
    stakePositionCount: 0,
    negativeBalances: [],
    persistedWarnings: [],
  };
  wallets.set(key, created);
  return created;
}

function normalizePersistedWarnings(value: unknown): MaterializationWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) => {
      if (typeof item !== "string") {
        return [];
      }
      if (item.startsWith("negative-token-balance:")) {
        const prefix = "negative-token-balance:";
        const remainder = item.slice(prefix.length);
        const separatorIndex = remainder.lastIndexOf(":");
        if (separatorIndex === -1) {
          return [];
        }
        const assetId = remainder.slice(0, separatorIndex);
        const balanceQuantity = remainder.slice(separatorIndex + 1);
        return [
          {
            code: "negative_token_balance" as const,
            message: `Negative materialized token balance for ${assetId}: ${balanceQuantity}`,
          },
        ];
      }
      return [];
    })
    .sort((left, right) => left.message.localeCompare(right.message));
}

function mergeWarnings(
  persistedWarnings: MaterializationWarning[],
  derivedWarnings: MaterializationWarning[],
) {
  const merged = new Map<string, MaterializationWarning>();
  for (const warning of [...persistedWarnings, ...derivedWarnings]) {
    merged.set(`${warning.code}:${warning.message}`, warning);
  }
  return Array.from(merged.values()).sort((left, right) => left.message.localeCompare(right.message));
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
