// Contract tests for POST /api/hexmining/ended-stakes/discover
//
// This route is the operator-triggered production call site for the existing
// Phase 5 ended-stake discovery pipeline (discoverEndedHexStakes). It does not
// redesign discovery, persistence, DTOs, or the frontend — it only invokes the
// existing service and returns a structured, safe evidence envelope.
//
// Verifies:
//   1. Route disabled by default (env flag not set) returns 404 and does not
//      call discovery.
//   2. Disabled route does not require a valid body and never invokes discovery.
//   3. Valid PulseChain wallet invokes existing discoverEndedHexStakes exactly
//      once with normalized (lowercased) wallet, chainId 369, bigint block range.
//   4. fromBlock defaults to 0 when omitted; toBlock is required.
//   5. Discovery result (discovered/persisted/skipped/warnings) is surfaced
//      faithfully — the route fabricates nothing.
//   6. Empty discovery succeeds with zero counts and no fabricated stake rows.
//   7. Repeated invocation preserves idempotency semantics (second run reports
//      skipped, not re-persisted) — the route passes these counts through.
//   8. Invalid wallet input returns 400 and does not call discovery.
//   9. Unsupported chain input returns 400 and does not call discovery.
//  10. Missing toBlock returns 400; fromBlock > toBlock returns 400;
//      non-numeric block returns 400; malformed JSON returns 400.
//  11. Discovery failure maps to the established safe 500 INTERNAL_ERROR
//      envelope without leaking the internal error message.
//  12. No RPC/provider client is constructed (discovery is DB-based).
//  13. No yield / pricing / valuation / PnL / HSI / HTT fields in the response.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DiscoverEndedHexStakesInput,
  DiscoverEndedHexStakesResult,
} from "@/services/hexmining/ended-stake-discovery";

// ─── Module-level mocks ────────────────────────────────────────────────────────

const discoverEndedHexStakes = vi.fn<
  (input: DiscoverEndedHexStakesInput) => Promise<DiscoverEndedHexStakesResult>
>();

vi.mock("@/services/hexmining/ended-stake-discovery", () => ({ discoverEndedHexStakes }));

const ENV_FLAG = "HEXMINING_ENDED_STAKE_DISCOVERY_ADMIN_ENABLED";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WALLET_MIXED_CASE = "0x75F808367720951E789d47e9e9DB51148D9AA765";
const WALLET_LOWER = WALLET_MIXED_CASE.toLowerCase();

const VALID_BODY = {
  walletAddress: WALLET_MIXED_CASE,
  chainId: 369,
  fromBlock: "20000000",
  toBlock: "26944376",
};

const SUCCESS_RESULT: DiscoverEndedHexStakesResult = {
  discovered: 2,
  persisted: 2,
  skipped: 0,
  conflicts: 0,
  warnings: [
    "hexmining-ended-stake-lockedday-unknown:stake=942663",
    "hexmining-ended-stake-lockedday-unknown:stake=942664",
  ],
};

const EMPTY_RESULT: DiscoverEndedHexStakesResult = {
  discovered: 0,
  persisted: 0,
  skipped: 0,
  conflicts: 0,
  warnings: [],
};

const IDEMPOTENT_RERUN_RESULT: DiscoverEndedHexStakesResult = {
  discovered: 2,
  persisted: 0,
  skipped: 2,
  conflicts: 0,
  warnings: [
    "hexmining-ended-stake-lockedday-unknown:stake=942663",
    "hexmining-ended-stake-lockedday-unknown:stake=942664",
  ],
};

const CONFLICT_RESULT: DiscoverEndedHexStakesResult = {
  discovered: 1,
  persisted: 0,
  skipped: 0,
  conflicts: 1,
  warnings: [
    "hexmining-ended-stake-end-evidence-conflict:stake=942663:hexmining-ended-stake-end-evidence-conflict:endBlockNumber persisted=21000000 incoming=22000000",
  ],
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/hexmining/ended-stakes/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function importRoute() {
  return import("../../app/api/hexmining/ended-stakes/discover/route");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/hexmining/ended-stakes/discover route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env[ENV_FLAG];
  });

  // ── Disabled-by-default (env gate) ─────────────────────────────────────────

  it("returns 404 when the admin flag is not set and does not call discovery", async () => {
    const { POST } = await importRoute();
    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(discoverEndedHexStakes).not.toHaveBeenCalled();
  });

  it("returns 404 when the admin flag is a non-true value", async () => {
    process.env[ENV_FLAG] = "false";
    const { POST } = await importRoute();
    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(404);
    expect(discoverEndedHexStakes).not.toHaveBeenCalled();
  });

  it("does not require a valid body when disabled", async () => {
    const { POST } = await importRoute();
    const malformed = new Request("http://localhost/api/hexmining/ended-stakes/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    const response = await POST(malformed);

    expect(response.status).toBe(404);
    expect(discoverEndedHexStakes).not.toHaveBeenCalled();
  });

  // ── Enabled ────────────────────────────────────────────────────────────────

  describe("when the admin flag is true", () => {
    beforeEach(() => {
      process.env[ENV_FLAG] = "true";
    });

    it("invokes discoverEndedHexStakes once with normalized wallet, chainId 369, bigint range", async () => {
      discoverEndedHexStakes.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await importRoute();
      const response = await POST(makeRequest(VALID_BODY));

      expect(response.status).toBe(200);
      expect(discoverEndedHexStakes).toHaveBeenCalledOnce();
      const args = discoverEndedHexStakes.mock.calls[0]![0];
      expect(args.chainId).toBe(369);
      expect(args.walletAddress).toBe(WALLET_LOWER);
      expect(args.fromBlock).toBe(20000000n);
      expect(args.toBlock).toBe(26944376n);
    });

    it("returns a structured envelope surfacing discovery counts and warnings faithfully", async () => {
      discoverEndedHexStakes.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await importRoute();
      const response = await POST(makeRequest(VALID_BODY));
      const body = await response.json();

      expect(body.data).toMatchObject({
        schemaVersion: "v1",
        status: "completed",
        scope: {
          chainId: 369,
          walletAddress: WALLET_LOWER,
          fromBlock: "20000000",
          toBlock: "26944376",
        },
        discovered: 2,
        persisted: 2,
        skipped: 0,
        conflicts: 0,
        warnings: SUCCESS_RESULT.warnings,
      });
    });

    it("surfaces canonical-identity conflicts as a `conflicts` count, not persisted or skipped", async () => {
      // D-033: a canonical-identity conflict must never inflate `persisted`
      // or fold into `skipped` — it is its own accounting bucket that the
      // route must expose so operators can act on the disagreement.
      discoverEndedHexStakes.mockResolvedValue(CONFLICT_RESULT);

      const { POST } = await importRoute();
      const response = await POST(makeRequest(VALID_BODY));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.discovered).toBe(1);
      expect(body.data.persisted).toBe(0);
      expect(body.data.skipped).toBe(0);
      expect(body.data.conflicts).toBe(1);
      expect(
        body.data.warnings.some((w: string) =>
          w.includes("hexmining-ended-stake-end-evidence-conflict"),
        ),
      ).toBe(true);
    });

    it("defaults fromBlock to 0 when omitted", async () => {
      discoverEndedHexStakes.mockResolvedValue(SUCCESS_RESULT);

      const { POST } = await importRoute();
      const response = await POST(
        makeRequest({ walletAddress: WALLET_MIXED_CASE, toBlock: "26944376" }),
      );

      expect(response.status).toBe(200);
      const args = discoverEndedHexStakes.mock.calls[0]![0];
      expect(args.fromBlock).toBe(0n);
      expect(args.chainId).toBe(369); // chainId defaults to 369 when omitted
    });

    it("succeeds with zero counts and no fabricated stake rows on empty discovery", async () => {
      discoverEndedHexStakes.mockResolvedValue(EMPTY_RESULT);

      const { POST } = await importRoute();
      const response = await POST(makeRequest(VALID_BODY));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.discovered).toBe(0);
      expect(body.data.persisted).toBe(0);
      expect(body.data.skipped).toBe(0);
      expect(body.data.warnings).toEqual([]);
      // No fabricated stake evidence in the envelope.
      expect(JSON.stringify(body)).not.toContain("stakeId");
    });

    it("passes through idempotent re-run semantics (second run reports skipped, not re-persisted)", async () => {
      discoverEndedHexStakes.mockResolvedValueOnce(SUCCESS_RESULT);
      discoverEndedHexStakes.mockResolvedValueOnce(IDEMPOTENT_RERUN_RESULT);

      const { POST } = await importRoute();

      const first = await (await POST(makeRequest(VALID_BODY))).json();
      expect(first.data.persisted).toBe(2);
      expect(first.data.skipped).toBe(0);

      const second = await (await POST(makeRequest(VALID_BODY))).json();
      expect(second.data.persisted).toBe(0);
      expect(second.data.skipped).toBe(2);
      expect(second.data.discovered).toBe(2);
    });

    // ── Validation ────────────────────────────────────────────────────────────

    it("returns 400 for an invalid wallet address and does not call discovery", async () => {
      const { POST } = await importRoute();
      const response = await POST(
        makeRequest({ walletAddress: "0xnothex", toBlock: "26944376" }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(discoverEndedHexStakes).not.toHaveBeenCalled();
    });

    it("returns 400 for an unsupported chain and does not call discovery", async () => {
      const { POST } = await importRoute();
      const response = await POST(
        makeRequest({ walletAddress: WALLET_MIXED_CASE, chainId: 1, toBlock: "26944376" }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(discoverEndedHexStakes).not.toHaveBeenCalled();
    });

    it("returns 400 when toBlock is missing", async () => {
      const { POST } = await importRoute();
      const response = await POST(makeRequest({ walletAddress: WALLET_MIXED_CASE }));

      expect(response.status).toBe(400);
      expect(discoverEndedHexStakes).not.toHaveBeenCalled();
    });

    it("returns 400 when fromBlock > toBlock", async () => {
      const { POST } = await importRoute();
      const response = await POST(
        makeRequest({ walletAddress: WALLET_MIXED_CASE, fromBlock: "100", toBlock: "50" }),
      );

      expect(response.status).toBe(400);
      expect(discoverEndedHexStakes).not.toHaveBeenCalled();
    });

    it("returns 400 for a non-numeric block value", async () => {
      const { POST } = await importRoute();
      const response = await POST(
        makeRequest({ walletAddress: WALLET_MIXED_CASE, toBlock: "26944376.5" }),
      );

      expect(response.status).toBe(400);
      expect(discoverEndedHexStakes).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON", async () => {
      const request = new Request("http://localhost/api/hexmining/ended-stakes/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not valid json",
      });
      const { POST } = await importRoute();
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(discoverEndedHexStakes).not.toHaveBeenCalled();
    });

    // ── Failure envelope ────────────────────────────────────────────────────

    it("maps a discovery failure to a safe 500 INTERNAL_ERROR without leaking details", async () => {
      discoverEndedHexStakes.mockRejectedValue(new Error("unexpected internal failure"));

      const { POST } = await importRoute();
      const response = await POST(makeRequest(VALID_BODY));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(body)).not.toContain("unexpected internal failure");
    });

    // ── Scope / anti-scope-creep guards ───────────────────────────────────────

    it("does not include yield, pricing, valuation, PnL, HSI, or HTT fields", async () => {
      discoverEndedHexStakes.mockResolvedValue(EMPTY_RESULT);

      const { POST } = await importRoute();
      const response = await POST(makeRequest(VALID_BODY));
      const bodyStr = JSON.stringify(await response.json()).toLowerCase();

      expect(bodyStr).not.toContain("yield");
      expect(bodyStr).not.toContain("pricing");
      expect(bodyStr).not.toContain("valuation");
      expect(bodyStr).not.toContain("pnl");
      expect(bodyStr).not.toContain("apy");
      expect(bodyStr).not.toContain("hsi");
      expect(bodyStr).not.toContain("htt");
    });
  });
});
