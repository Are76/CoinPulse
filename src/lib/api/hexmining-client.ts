import type { HexMiningEvidenceCoverageReportDto } from "@/services/hexmining/evidence-coverage-report";
import type { HexStakeListDto } from "@/services/hexmining/types";

import {
  ApiClientError,
  fetchJson,
  type ApiDataResponse,
} from "@/lib/api/api-client";

export { ApiClientError };

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
