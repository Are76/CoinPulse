import type { PortfolioDashboardDto } from "@/services/dashboard/types";

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

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{
      path?: string;
      message?: string;
      code?: string;
    }>;
  };
};

type ApiDataResponse<T> = {
  data: T;
};

type ApiErrorDetails = NonNullable<ApiErrorPayload["error"]>["details"];

export class ApiClientError extends Error {
  status: number;
  code: string;
  details: ApiErrorDetails;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: ApiErrorDetails;
  }) {
    super(args.message);
    this.name = "ApiClientError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
  }
}

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

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new ApiClientError({
      status: response.status,
      code: payload.error?.code ?? "UNKNOWN_ERROR",
      message: payload.error?.message ?? "Request failed.",
      details: payload.error?.details,
    });
  }

  return payload;
}
