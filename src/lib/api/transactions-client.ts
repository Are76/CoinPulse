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
  cursor?: string;
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

  const response = await fetchJson<ApiDataResponse<TransactionsPageDto>>(
    `/api/transactions?${params.toString()}`,
  );

  return response.data;
}
