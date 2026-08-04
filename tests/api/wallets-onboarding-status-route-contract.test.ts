import { afterEach, describe, expect, it, vi } from "vitest";

const resolveTrackedWalletByAddress = vi.fn();
const getWalletOnboardingStatus = vi.fn();

vi.mock("@/services/api/wallets", () => ({
  resolveTrackedWalletByAddress,
}));

vi.mock("@/services/operations/wallet-onboarding-status", () => ({
  getWalletOnboardingStatus,
}));

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";
const VALID_CHAIN_ID = "369";

function buildRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return new Request(`http://localhost/api/wallets/onboarding-status?${params.toString()}`);
}

describe("GET /api/wallets/onboarding-status route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 with the canonical onboarding status for a tracked wallet", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: VALID_ADDRESS,
      chainId: 369,
    });
    getWalletOnboardingStatus.mockResolvedValue({
      status: "CANONICAL_STATE_READY",
      reason: "Canonical materialized state is ready and covers the known ledger history.",
      actionRequired: false,
      holdingsMayBeVisible: true,
      pnlMayBeAvailable: true,
      pricingMayBeUnavailable: false,
      latestSyncRun: {
        id: "run-1",
        status: "COMPLETED",
        trigger: "MANUAL",
        stage: "UPDATING_CURSOR",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:05:00.000Z",
      },
      materialization: {
        status: "COMPLETED",
        completedSuccessfully: true,
        warningCount: 0,
        latestMaterializedAt: "2026-08-01T00:05:00.000Z",
      },
    });

    const { GET } = await import("../../app/api/wallets/onboarding-status/route");
    const response = await GET(buildRequest({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.schemaVersion).toBe("v1");
    expect(body.data.wallet).toEqual({ id: "wallet-1", address: VALID_ADDRESS, chainId: 369 });
    expect(body.data.onboarding.status).toBe("CANONICAL_STATE_READY");

    expect(resolveTrackedWalletByAddress).toHaveBeenCalledWith({
      walletAddress: VALID_ADDRESS,
      chainId: 369,
    });
    expect(getWalletOnboardingStatus).toHaveBeenCalledWith({ walletId: "wallet-1", chainId: 369 });
  });

  it("returns 404 WALLET_NOT_FOUND when the wallet is not tracked", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(null);

    const { GET } = await import("../../app/api/wallets/onboarding-status/route");
    const response = await GET(buildRequest({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID }));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("WALLET_NOT_FOUND");
    expect(getWalletOnboardingStatus).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT for a malformed wallet address", async () => {
    const { GET } = await import("../../app/api/wallets/onboarding-status/route");
    const response = await GET(buildRequest({ walletAddress: "not-an-address", chainId: VALID_CHAIN_ID }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(resolveTrackedWalletByAddress).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_INPUT when chainId is missing", async () => {
    const { GET } = await import("../../app/api/wallets/onboarding-status/route");
    const response = await GET(buildRequest({ walletAddress: VALID_ADDRESS, chainId: "" }));

    expect(response.status).toBe(400);
  });

  it("returns 500 with a stable error envelope and no internal detail leakage when the service throws", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({ id: "wallet-1", address: VALID_ADDRESS, chainId: 369 });
    const secretDetail = "secret-host:5432/internal-db";
    getWalletOnboardingStatus.mockRejectedValue(new Error(`database connection refused: ${secretDetail}`));

    const { GET } = await import("../../app/api/wallets/onboarding-status/route");
    const response = await GET(buildRequest({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(secretDetail);
    expect(bodyText).not.toContain("stack");
  });
});
