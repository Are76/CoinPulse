import { z } from "zod";

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

export const SOURCE_FAMILY_OPTIONS = [
  "TRANSFERS",
  "DEX",
  "LP",
  "STAKING",
  "NATIVE",
] as const;

const healthReportSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  timestamp: z.string(),
  app: z.object({
    env: z.string(),
  }),
  dependencies: z.object({
    database: z.object({
      status: z.enum(["ready", "degraded", "unavailable"]),
    }),
    redis: z.object({
      status: z.enum(["ready", "degraded", "unavailable"]),
    }),
  }),
});

const debugStatusReportSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string(),
  app: z.object({
    env: z.string(),
  }),
  supportedChains: z.array(
    z.object({
      chainId: z.number(),
      name: z.string(),
      nativeAssetId: z.string(),
    }),
  ),
  sourceFamilies: z.array(z.string()),
  pricing: z.object({
    persistedObservationsOnly: z.literal(true),
    liveAdaptersEnabled: z.literal(false),
  }),
});

export type HealthReportDto = z.infer<typeof healthReportSchema>;
export type DebugStatusReportDto = z.infer<typeof debugStatusReportSchema>;
export type SourceFamily = (typeof SOURCE_FAMILY_OPTIONS)[number];

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

export async function fetchDebugHealth() {
  const response = await fetchJson<ApiDataResponse<HealthReportDto>>("/api/debug/health");
  return healthReportSchema.parse(response.data);
}

export async function fetchDebugStatus() {
  const response = await fetchJson<ApiDataResponse<DebugStatusReportDto>>("/api/debug/status");
  return debugStatusReportSchema.parse(response.data);
}

export async function runManualSync(args: {
  walletAddress: string;
  chainId: number;
  sourceFamilies: SourceFamily[];
  endBlock: string;
  policyLabel: string;
  startBlock?: string;
}) {
  return fetchJson<ApiDataResponse<unknown>>("/api/sync/manual", {
    method: "POST",
    body: JSON.stringify({
      walletAddress: args.walletAddress,
      chainId: args.chainId,
      sourceFamilies: args.sourceFamilies,
      startBlock: args.startBlock?.trim() ? args.startBlock : undefined,
      endBlock: args.endBlock,
      policyLabel: args.policyLabel,
    }),
  });
}

export async function runRebuild(args: {
  walletAddress: string;
  chainId: number;
  sourceFamilies: SourceFamily[];
  fromBlock: string;
  toBlock: string;
}) {
  return fetchJson<ApiDataResponse<unknown>>("/api/rebuild", {
    method: "POST",
    body: JSON.stringify({
      walletAddress: args.walletAddress,
      chainId: args.chainId,
      sourceFamilies: args.sourceFamilies,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
    }),
  });
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
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
