import type { TransactionsPageDto } from "@/services/transactions/types";

import {
  ApiClientError,
  fetchJson,
  type ApiDataResponse,
} from "@/lib/api/api-client";

export { ApiClientError };

export type FetchTransactionsArgs = {
  walletAddress: string;
  chainId: number;
  limit?: number;
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

  const response = await fetchJson<ApiDataResponse<TransactionsPageDto>>(
    `/api/transactions?${params.toString()}`,
  );

  return response.data;
}
