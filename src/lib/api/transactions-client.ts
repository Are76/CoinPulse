import type { TransactionsPageDto } from "@/services/transactions/types";

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
