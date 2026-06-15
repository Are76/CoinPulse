import { z } from "zod";

import {
  ApiClientError,
  fetchJson,
  type ApiDataResponse,
} from "@/lib/api/api-client";

export { ApiClientError };

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

/**
 * Fetches the current pricing status report from the backend.
 *
 * Calls GET /api/prices/status and validates the response against the
 * PricingStatusDto zod schema. Throws ApiClientError on non-2xx responses.
 * Does not compute, infer, or modify pricing truth in the client.
 */
export async function fetchPricingStatus(): Promise<PricingStatusDto> {
  const response = await fetchJson<ApiDataResponse<PricingStatusDto>>("/api/prices/status");
  return pricingStatusSchema.parse(response.data);
}
