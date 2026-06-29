import type { TransactionsPageDto } from "@/services/transactions/types";

import {
  ApiClientError,
  fetchJson,
  type ApiDataResponse,
} from "@/lib/api/api-client";

export { ApiClientError };

export type TransactionFilters = {
  assetId?: string;
  actionType?: string;
  sourceFamily?: string;
  protocol?: string;
  fromDate?: string;
  toDate?: string;
};

export type FetchTransactionsArgs = {
  walletAddress: string;
  chainId: number;
  limit?: number;
  cursor?: string;
  filters?: TransactionFilters;
};

export async function fetchTransactions(
  args: FetchTransactionsArgs,
): Promise<TransactionsPageDto> {
  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    chainId: String(args.chainId),
  });
  if (args.limit !== undefined) {
    params.set("limit", String(args.limit));
  }
  if (args.cursor !== undefined) {
    params.set("cursor", args.cursor);
  }
  const filters = args.filters ?? {};
  if (filters.assetId) params.set("assetId", filters.assetId);
  if (filters.actionType) params.set("actionType", filters.actionType);
  if (filters.sourceFamily) params.set("sourceFamily", filters.sourceFamily);
  if (filters.protocol) params.set("protocol", filters.protocol);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);

  const response = await fetchJson<ApiDataResponse<TransactionsPageDto>>(
    `/api/transactions?${params.toString()}`,
  );

  return response.data;
}
