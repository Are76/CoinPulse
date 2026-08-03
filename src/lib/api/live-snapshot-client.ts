import type { LiveHoldingsSnapshotDto } from "@/services/portfolio/live-snapshot-types";

import { fetchJson, type ApiDataResponse } from "@/lib/api/api-client";

export async function fetchLiveHoldingsSnapshot(args: {
  walletAddress: string;
  chainId: number;
  quoteAsset?: string;
}) {
  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    chainId: String(args.chainId),
    quoteAsset: args.quoteAsset ?? "fiat:usd",
  });

  const response = await fetchJson<ApiDataResponse<LiveHoldingsSnapshotDto>>(
    `/api/portfolio/live-snapshot?${params.toString()}`,
  );

  return response.data;
}
