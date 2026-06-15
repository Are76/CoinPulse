import type { PortfolioDashboardDto } from "@/services/dashboard/types";

import {
  ApiClientError,
  fetchJson,
  type ApiDataResponse,
} from "@/lib/api/api-client";

export { ApiClientError };

export type HealthReportDto = {
  status: "ok" | "degraded";
  timestamp: string;
  app: {
    env: string;
  };
  dependencies: {
    database: {
      status: "ready" | "degraded" | "unavailable";
    };
    redis: {
      status: "ready" | "degraded" | "unavailable";
    };
  };
};

export type DebugStatusReportDto = {
  status: "ok";
  timestamp: string;
  app: {
    env: string;
  };
  supportedChains: Array<{
    chainId: number;
    name: string;
    nativeAssetId: string;
  }>;
  sourceFamilies: string[];
  pricing: {
    persistedObservationsOnly: true;
    liveAdaptersEnabled: false;
  };
};

export async function fetchPortfolioDashboard(args: {
  walletAddress: string;
  chainId: number;
  quoteAsset?: string;
  asOf?: string | null;
}) {
  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    chainId: String(args.chainId),
    quoteAsset: args.quoteAsset ?? "fiat:usd",
  });
  if (args.asOf !== undefined && args.asOf !== null) {
    params.set("asOf", args.asOf);
  }

  const response = await fetchJson<ApiDataResponse<PortfolioDashboardDto>>(
    `/api/portfolio/dashboard?${params.toString()}`,
  );

  return response.data;
}

export async function fetchDebugHealth() {
  const response = await fetchJson<ApiDataResponse<HealthReportDto>>("/api/debug/health");
  return response.data;
}

export async function fetchDebugStatus() {
  const response = await fetchJson<ApiDataResponse<DebugStatusReportDto>>("/api/debug/status");
  return response.data;
}
