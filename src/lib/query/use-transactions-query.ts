import { useQuery } from "@tanstack/react-query";

import { fetchTransactions } from "@/lib/api/transactions-client";
import { QUERY_DEFAULTS } from "@/lib/query/query-defaults";
import { queryKeys } from "@/lib/query/query-keys";

const TRANSACTIONS_SCHEMA_VERSION = "v1" as const;

export type UseTransactionsQueryParams = {
  walletAddress: string;
  chainId: number;
  limit?: number;
  enabled?: boolean;
};

export function useTransactionsQuery({
  walletAddress,
  chainId,
  limit,
  enabled = true,
}: UseTransactionsQueryParams) {
  const normalizedAddress = walletAddress.trim().toLowerCase();

  return useQuery({
    queryKey: queryKeys.transactions(TRANSACTIONS_SCHEMA_VERSION, {
      walletAddress: normalizedAddress,
      chainId,
      ...(limit !== undefined ? { limit } : {}),
    }),
    queryFn: () =>
      fetchTransactions({
        walletAddress: walletAddress.trim(),
        chainId,
        limit,
      }),
    enabled: enabled && walletAddress.trim().length > 0,
    retry: false,
    staleTime: QUERY_DEFAULTS.transactions.staleTime,
    gcTime: QUERY_DEFAULTS.transactions.gcTime,
  });
}
