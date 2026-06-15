import type { HexMiningEvidenceCoverageReportDto } from "@/services/hexmining/evidence-coverage-report";
import type { HexStakeListDto } from "@/services/hexmining/types";

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

export type FetchHexMiningStakesArgs = {
  walletAddress: string;
  chainId?: number;
};

export async function fetchHexMiningStakes(
  args: FetchHexMiningStakesArgs,
): Promise<HexStakeListDto> {
  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    chainId: String(args.chainId ?? 369),
  });

  const response = await fetchJson<ApiDataResponse<HexStakeListDto>>(
    `/api/hexmining/stakes?${params.toString()}`,
  );

  return response.data;
}

export type FetchHexMiningEvidenceMissingArgs = {
  walletAddress: string;
  chainId?: number;
};

export async function fetchHexMiningEvidenceMissing(
  args: FetchHexMiningEvidenceMissingArgs,
): Promise<HexMiningEvidenceCoverageReportDto> {
  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    chainId: String(args.chainId ?? 369),
  });

  const response = await fetchJson<ApiDataResponse<HexMiningEvidenceCoverageReportDto>>(
    `/api/hexmining/evidence/missing?${params.toString()}`,
  );

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
