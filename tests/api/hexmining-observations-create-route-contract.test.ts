// Contract tests for POST /api/hexmining/observations
//
// Verifies:
//   1. Route disabled by default (HEXMINING_OBSERVATION_ADMIN_ENABLED not set) returns 404.
//   2. Disabled route does not parse/require a valid body.
//   3. Disabled route does not call createPublicClientForChain.
//   4. Disabled route does not call acquireAndPersistHexDailyDataObservation.
//   5. Valid range returns 200 with safe observation DTO when enabled.
//   6. Valid request calls acquireAndPersistHexDailyDataObservation with correct args.
//   7. Response does not include canonicalPayload.
//   8. Response does not include rawDailyData.
//   9. Response does not include payloadHash.
//  10. Missing rangeStartDay returns 400 and does not call service.
//  11. Missing rangeEndDay returns 400 and does not call service.
//  12. Non-integer rangeStartDay returns 400.
//  13. Non-integer rangeEndDay returns 400.
//  14. Negative rangeStartDay returns 400.
//  15. Negative rangeEndDay returns 400.
//  16. rangeEndDay < rangeStartDay returns 400.
//  17. Malformed JSON returns 400.
//  18. Service ok:false maps to 422 with safe error code.
//  19. Unexpected thrown service error maps to 500.
//  20. No live RPC/network.
//  21. No yield/APY/pricing/valuation/PnL fields in response.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AcquireAndPersistHexDailyDataArgs,
  AcquireAndPersistHexDailyDataResult,
} from "@/services/hexmining/daily-data-observation-service";

// ─── Module-level mocks ────────────────────────────────────────────────────────

const createPublicClientForChain = vi.fn();

const acquireAndPersistHexDailyDataObservation = vi.fn<
  (args: AcquireAndPersistHexDailyDataArgs) => Promise<AcquireAndPersistHexDailyDataResult>
>();

vi.mock("@/services/chains/public-client", () => ({ createPublicClientForChain }));
vi.mock("@/services/hexmining/daily-data-observation-service", () => ({
  acquireAndPersistHexDailyDataObservation,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_BODY = {
  rangeStartDay: 1000,
  rangeEndDay: 1002,
  rpcEndpointLabel: "pulsechain-primary",
};

const SUCCESS_RESULT: AcquireAndPersistHexDailyDataResult = {
  ok: true,
  observationId: "obs_contract_test_123",
  rangeStartDay: 1000,
  rangeEndDay: 1002,
  observedAtBlock: "99000000",
  observedAt: "2026-06-08T00:00:00.000Z",
  warnings: [],
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/hexmining/observations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/hexmining/observations route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.HEXMINING_OBSERVATION_ADMIN_ENABLED;
  });

  // ── Disabled-by-default (env gate) ───────────────────────────────────────

  it("returns 404 when HEXMINING_OBSERVATION_ADMIN_ENABLED is not set", async () => {
    // env var absent — default state
    const { POST } = await import("../../app/api/hexmining/observations/route");
    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when HEXMINING_OBSERVATION_ADMIN_ENABLED is set to a non-true value", async () => {
    process.env.HEXMINING_OBSERVATION_ADMIN_ENABLED = "false";
    const { POST } = await import("../../app/api/hexmining/observations/route");
    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(404);
  });

  it("does not require a valid body when route is disabled", async () => {
    const { POST } = await import("../../app/api/hexmining/observations/route");
    const malformedRequest = new Request("http://localhost/api/hexmining/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    const response = await POST(malformedRequest);

    expect(response.status).toBe(404);
  });

  it("does not call createPublicClientForChain when route is disabled", async () => {
    const { POST } = await import("../../app/api/hexmining/observations/route");
    await POST(makeRequest(VALID_BODY));

    expect(createPublicClientForChain).not.toHaveBeenCalled();
  });

  it("does not call acquireAndPersistHexDailyDataObservation when route is disabled", async () => {
    const { POST } = await import("../../app/api/hexmining/observations/route");
    await POST(makeRequest(VALID_BODY));

    expect(acquireAndPersistHexDailyDataObservation).not.toHaveBeenCalled();
  });

  // ── Enabled: happy path ───────────────────────────────────────────────────

  describe("when HEXMINING_OBSERVATION_ADMIN_ENABLED=true", () => {
    beforeEach(() => {
      process.env.HEXMINING_OBSERVATION_ADMIN_ENABLED = "true";
    });

    it("returns 200 with safe observation DTO on valid input", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toMatchObject({
        schemaVersion: "v1",
        status: "persisted",
        observation: {
          id: SUCCESS_RESULT.observationId,
          rangeStartDay: 1000,
          rangeEndDay: 1002,
          observedAtBlock: "99000000",
          observedAt: "2026-06-08T00:00:00.000Z",
          warnings: [],
        },
      });
    });

    it("calls acquireAndPersistHexDailyDataObservation with rangeStartDay, rangeEndDay, rpcEndpointLabel", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      await POST(makeRequest(VALID_BODY));

      expect(acquireAndPersistHexDailyDataObservation).toHaveBeenCalledOnce();
      const callArgs = acquireAndPersistHexDailyDataObservation.mock.calls[0]![0];
      expect(callArgs.rangeStartDay).toBe(1000);
      expect(callArgs.rangeEndDay).toBe(1002);
      expect(callArgs.rpcEndpointLabel).toBe("pulsechain-primary");
      expect(callArgs.publicClient).toBeDefined();
    });

    it("passes null rpcEndpointLabel when omitted from body", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      await POST(makeRequest({ rangeStartDay: 1000, rangeEndDay: 1002 }));

      const callArgs = acquireAndPersistHexDailyDataObservation.mock.calls[0]![0];
      expect(callArgs.rpcEndpointLabel).toBeNull();
    });

    it("does not include canonicalPayload in the response", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));
      const body = await response.json();

      expect(JSON.stringify(body)).not.toContain("canonicalPayload");
    });

    it("does not include rawDailyData in the response", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));
      const body = await response.json();

      expect(JSON.stringify(body)).not.toContain("rawDailyData");
    });

    it("does not include payloadHash in the response", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));
      const body = await response.json();

      expect(JSON.stringify(body)).not.toContain("payloadHash");
    });

    // ── Validation ────────────────────────────────────────────────────────

    it("returns 400 when rangeStartDay is missing and does not call service", async () => {
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest({ rangeEndDay: 1002 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(acquireAndPersistHexDailyDataObservation).not.toHaveBeenCalled();
    });

    it("returns 400 when rangeEndDay is missing and does not call service", async () => {
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest({ rangeStartDay: 1000 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(acquireAndPersistHexDailyDataObservation).not.toHaveBeenCalled();
    });

    it("returns 400 for non-integer rangeStartDay", async () => {
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest({ rangeStartDay: 1000.5, rangeEndDay: 1002 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 for non-integer rangeEndDay", async () => {
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest({ rangeStartDay: 1000, rangeEndDay: 1002.7 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 for negative rangeStartDay", async () => {
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest({ rangeStartDay: -1, rangeEndDay: 1002 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 for negative rangeEndDay", async () => {
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest({ rangeStartDay: 0, rangeEndDay: -5 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 when rangeEndDay < rangeStartDay", async () => {
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest({ rangeStartDay: 1005, rangeEndDay: 1000 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 for malformed JSON body", async () => {
      const request = new Request("http://localhost/api/hexmining/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not valid json",
      });
      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
    });

    // ── Service error paths ───────────────────────────────────────────────

    it("returns 422 with OBSERVATION_FAILED code when service returns ok:false", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue({
        ok: false,
        code: "hexmining-range-exceeds-current-day",
        warnings: ["hexmining-range-exceeds-current-day"],
      });

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe("OBSERVATION_FAILED");
      expect(body.error.message).toBeDefined();
    });

    it("does not leak internal service error code in 422 response", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue({
        ok: false,
        code: "hexmining-daily-data-range-rpc-unknown",
        warnings: ["hexmining-daily-data-range-rpc-unknown"],
      });

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));

      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("hexmining-daily-data-range-rpc-unknown");
    });

    it("returns 500 with INTERNAL_ERROR when service throws unexpectedly", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockRejectedValue(
        new Error("unexpected internal failure"),
      );

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(body)).not.toContain("unexpected internal failure");
    });

    // ── No live RPC ───────────────────────────────────────────────────────

    it("does not make live RPC calls (createPublicClientForChain returns mock)", async () => {
      const mockClient = { readContract: vi.fn(), getBlockNumber: vi.fn() };
      createPublicClientForChain.mockReturnValue(mockClient);
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      await POST(makeRequest(VALID_BODY));

      expect(mockClient.readContract).not.toHaveBeenCalled();
      expect(mockClient.getBlockNumber).not.toHaveBeenCalled();
    });

    // ── No yield/pricing/valuation/PnL fields ─────────────────────────────

    it("does not include yield, APY, pricing, valuation, or PnL fields in response", async () => {
      createPublicClientForChain.mockReturnValue({});
      acquireAndPersistHexDailyDataObservation.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await import("../../app/api/hexmining/observations/route");
      const response = await POST(makeRequest(VALID_BODY));
      const bodyStr = JSON.stringify(await response.json());

      expect(bodyStr).not.toContain("yield");
      expect(bodyStr).not.toContain("apy");
      expect(bodyStr).not.toContain("pricing");
      expect(bodyStr).not.toContain("valuation");
      expect(bodyStr).not.toContain("pnl");
    });
  });
});
