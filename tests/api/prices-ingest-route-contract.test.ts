import { afterEach, describe, expect, it, vi } from "vitest";

import type { PriceObservationDraft } from "@/services/pricing/types";
import type { FetchOnchainPriceArgs, FetchOnchainPriceResult } from "@/services/pricing/fetchers/onchain-pulsex-fetcher";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const createPublicClientForChain = vi.fn();
const fetchOnchainPulseXPrice = vi.fn<(args: FetchOnchainPriceArgs) => Promise<FetchOnchainPriceResult>>();
const persistPriceObservations = vi.fn<(drafts: readonly PriceObservationDraft[]) => Promise<{ createdCount: number }>>();

vi.mock("@/services/chains/public-client", () => ({ createPublicClientForChain }));
vi.mock("@/services/pricing/fetchers/onchain-pulsex-fetcher", () => ({ fetchOnchainPulseXPrice }));
vi.mock("@/services/pricing/price-store", () => ({ persistPriceObservations }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_BODY = {
  chainId: 369,
  blockNumber: "21000000",
  observedAt: "2026-06-04T12:00:00.000Z",
  assets: [
    {
      assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      tokenAddress: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      tokenDecimals: 8,
      quoteAsset: "fiat:usd",
    },
  ],
};

function makeDraft(assetId: string): PriceObservationDraft {
  return {
    chainId: 369,
    assetId,
    assetAddress: null,
    quoteAsset: "fiat:usd",
    price: "0.021",
    sourceType: "ONCHAIN_POOL",
    sourceId: "pulsex:pulsex_v1:route:mock",
    routeMetadata: null,
    liquidityUsd: "500000",
    confidence: "0.95",
    observedAt: new Date("2026-06-04T12:00:00.000Z"),
    blockNumber: 21_000_000n,
    staleAfterSeconds: 120,
  };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/prices/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/prices/ingest route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 with schemaVersion v1 on success", async () => {
    createPublicClientForChain.mockReturnValue({});
    fetchOnchainPulseXPrice.mockResolvedValue({
      ok: true,
      draft: makeDraft(VALID_BODY.assets[0]!.assetId),
    });
    persistPriceObservations.mockResolvedValue({ createdCount: 1 });

    const { POST } = await import("../../app/api/prices/ingest/route");
    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.schemaVersion).toBe("v1");
    expect(body.data.fetchedCount).toBe(1);
    expect(body.data.persistedCount).toBe(1);
    expect(body.data.failedCount).toBe(0);
    expect(body.data.failedAssets).toEqual([]);
    expect(body.data.chainId).toBe(369);
    expect(body.data.blockNumber).toBe("21000000");
  });

  it("returns 200 with failedCount when fetch fails for an asset", async () => {
    createPublicClientForChain.mockReturnValue({});
    fetchOnchainPulseXPrice.mockResolvedValue({ ok: false, reason: "zero_amount_out" });
    persistPriceObservations.mockResolvedValue({ createdCount: 0 });

    const { POST } = await import("../../app/api/prices/ingest/route");
    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.fetchedCount).toBe(0);
    expect(body.data.failedCount).toBe(1);
    expect(body.data.failedAssets).toEqual([VALID_BODY.assets[0]!.assetId]);
  });

  it("returns 400 for missing required fields", async () => {
    const { POST } = await import("../../app/api/prices/ingest/route");
    const response = await POST(makeRequest({ chainId: 369 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details).toBeDefined();
  });

  it("returns 400 for invalid token address", async () => {
    const { POST } = await import("../../app/api/prices/ingest/route");
    const badBody = {
      ...VALID_BODY,
      assets: [{ ...VALID_BODY.assets[0], tokenAddress: "not-an-address" }],
    };
    const response = await POST(makeRequest(badBody));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 for empty assets array", async () => {
    const { POST } = await import("../../app/api/prices/ingest/route");
    const response = await POST(makeRequest({ ...VALID_BODY, assets: [] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 for invalid blockNumber (non-numeric string)", async () => {
    const { POST } = await import("../../app/api/prices/ingest/route");
    const response = await POST(makeRequest({ ...VALID_BODY, blockNumber: "abc" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 for invalid observedAt", async () => {
    const { POST } = await import("../../app/api/prices/ingest/route");
    const response = await POST(makeRequest({ ...VALID_BODY, observedAt: "not-a-date" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 for tokenDecimals out of range", async () => {
    const { POST } = await import("../../app/api/prices/ingest/route");
    const badBody = {
      ...VALID_BODY,
      assets: [{ ...VALID_BODY.assets[0], tokenDecimals: 19 }],
    };
    const response = await POST(makeRequest(badBody));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 for malformed JSON body", async () => {
    const { POST } = await import("../../app/api/prices/ingest/route");
    const request = new Request("http://localhost/api/prices/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("response does not expose stack traces or internal error details", async () => {
    createPublicClientForChain.mockReturnValue({});
    fetchOnchainPulseXPrice.mockRejectedValue(new Error("internal rpc failure"));

    const { POST } = await import("../../app/api/prices/ingest/route");
    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("rpc failure");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});
