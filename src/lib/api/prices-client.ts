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

const pricingStatusSourceSchema = z.object({
  sourceType: z.string(),
  status: z.enum(["ok", "degraded", "disabled", "unknown"]),
  latestObservedAt: z.string().nullable(),
  staleAfterSeconds: z.number().nullable(),
  observationsCount: z.number(),
  rejectedCount: z.number(),
  reason: z.string().nullable(),
});

const pricingStatusSchema = z.object({
  schemaVersion: z.literal("v1"),
  status: z.enum(["ok", "degraded", "unknown"]),
  asOf: z.string(),
  sources: z.array(pricingStatusSourceSchema),
});

export type PricingStatusSourceDto = z.infer<typeof pricingStatusSourceSchema>;
export type PricingStatusDto = z.infer<typeof pricingStatusSchema>;

export type PricingStatusEnvelope = {
  data: PricingStatusDto;
};

export async function fetchPricingStatus(): Promise<PricingStatusDto> {
  const response = await fetchJson<ApiDataResponse<PricingStatusDto>>("/api/prices/status");
  return pricingStatusSchema.parse(response.data);
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
