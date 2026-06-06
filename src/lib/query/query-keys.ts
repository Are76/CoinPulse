const LATEST_AS_OF = "latest";

export type DashboardQueryKeyParams = {
  schemaVersion: string;
  chainId: number;
  walletAddress: string;
  quoteAsset: string;
  asOf?: string | null;
};

export const queryKeys = {
  debug: {
    health: () => ["debug", "health"] as const,
    status: () => ["debug", "status"] as const,
  },
  dashboard: ({
    schemaVersion,
    chainId,
    walletAddress,
    quoteAsset,
    asOf,
  }: DashboardQueryKeyParams) =>
    [
      "dashboard",
      schemaVersion,
      chainId,
      walletAddress.trim().toLowerCase(),
      quoteAsset,
      asOf ?? LATEST_AS_OF,
    ] as const,
  prices: {
    status: (chainId: number) => ["prices", "status", { chainId }] as const,
  },
  transactions: (schemaVersion: string, filters: Record<string, unknown>) =>
    ["transactions", schemaVersion, filters] as const,
  wallets: {
    tracked: (chainId: number) => ["wallets", "tracked", chainId] as const,
  },
  hexmining: {
    stakes: (params: { walletAddress: string; chainId: number }) =>
      ["hexmining", "stakes", { walletAddress: params.walletAddress, chainId: params.chainId }] as const,
  },
} as const;
