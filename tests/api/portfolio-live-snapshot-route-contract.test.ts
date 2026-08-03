import { afterEach, describe, expect, it, vi } from "vitest";

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;

vi.mock("@/services/api/wallets", () => ({
  resolveTrackedWalletByAddress: vi.fn(),
}));

vi.mock("@/services/portfolio/live-holdings-snapshot", async (importOriginal) => {
  // Keep the real UnsupportedChainError class so route.ts's `instanceof`
  // check works against it; only assembleLiveHoldingsSnapshot is mocked.
  const actual = await importOriginal<typeof import("@/services/portfolio/live-holdings-snapshot")>();
  return {
    ...actual,
    assembleLiveHoldingsSnapshot: vi.fn(),
  };
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/portfolio/live-snapshot", () => {
  it("returns 404 WALLET_NOT_FOUND when the wallet has not been imported", async () => {
    const { resolveTrackedWalletByAddress } = await import("@/services/api/wallets");
    vi.mocked(resolveTrackedWalletByAddress).mockResolvedValue(null);

    const { GET } = await import("../../app/api/portfolio/live-snapshot/route");
    const request = new Request(
      `http://localhost/api/portfolio/live-snapshot?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}`,
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("WALLET_NOT_FOUND");
  });

  it("returns the assembled snapshot for a known wallet", async () => {
    const { resolveTrackedWalletByAddress } = await import("@/services/api/wallets");
    vi.mocked(resolveTrackedWalletByAddress).mockResolvedValue({
      id: "wallet-1",
      address: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    const { assembleLiveHoldingsSnapshot } = await import("@/services/portfolio/live-holdings-snapshot");
    const dto = {
      schemaVersion: "v1",
      wallet: { address: WALLET_ADDRESS, chainId: CHAIN_ID },
      quoteAsset: "fiat:usd",
      asOf: "2026-08-03T00:00:00.000Z",
      sourceType: "LIVE_RPC_SNAPSHOT",
      observedBlock: "1000",
      coverage: "known_assets_only",
      coverageNote: "note",
      pnlStatus: "unsupported",
      assets: [],
      totalValueQuote: null,
      valuationStatus: "unavailable",
      warnings: [],
    };
    vi.mocked(assembleLiveHoldingsSnapshot).mockResolvedValue(dto as never);

    const { GET } = await import("../../app/api/portfolio/live-snapshot/route");
    const request = new Request(
      `http://localhost/api/portfolio/live-snapshot?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}`,
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(dto);
  });

  it("returns 400 INVALID_INPUT for a malformed wallet address", async () => {
    const { GET } = await import("../../app/api/portfolio/live-snapshot/route");
    const request = new Request(
      `http://localhost/api/portfolio/live-snapshot?walletAddress=not-an-address&chainId=${CHAIN_ID}`,
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT for a non-PulseChain chainId, without reaching the wallet lookup or assembler", async () => {
    const { resolveTrackedWalletByAddress } = await import("@/services/api/wallets");
    const { assembleLiveHoldingsSnapshot } = await import("@/services/portfolio/live-holdings-snapshot");

    const { GET } = await import("../../app/api/portfolio/live-snapshot/route");
    const request = new Request(
      `http://localhost/api/portfolio/live-snapshot?walletAddress=${WALLET_ADDRESS}&chainId=1`,
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(resolveTrackedWalletByAddress).not.toHaveBeenCalled();
    expect(assembleLiveHoldingsSnapshot).not.toHaveBeenCalled();
  });

  it("returns 400 UNSUPPORTED_CHAIN if the assembler rejects the wallet's own stored chainId (defense in depth)", async () => {
    const { resolveTrackedWalletByAddress } = await import("@/services/api/wallets");
    vi.mocked(resolveTrackedWalletByAddress).mockResolvedValue({
      id: "wallet-1",
      address: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    const { assembleLiveHoldingsSnapshot, UnsupportedChainError } = await import(
      "@/services/portfolio/live-holdings-snapshot"
    );
    vi.mocked(assembleLiveHoldingsSnapshot).mockRejectedValue(new UnsupportedChainError(1));

    const { GET } = await import("../../app/api/portfolio/live-snapshot/route");
    const request = new Request(
      `http://localhost/api/portfolio/live-snapshot?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}`,
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("UNSUPPORTED_CHAIN");
  });

  it("returns a stable internal error response when snapshot assembly throws", async () => {
    const { resolveTrackedWalletByAddress } = await import("@/services/api/wallets");
    vi.mocked(resolveTrackedWalletByAddress).mockResolvedValue({
      id: "wallet-1",
      address: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    const { assembleLiveHoldingsSnapshot } = await import("@/services/portfolio/live-holdings-snapshot");
    vi.mocked(assembleLiveHoldingsSnapshot).mockRejectedValue(new Error("snapshot exploded"));

    const { GET } = await import("../../app/api/portfolio/live-snapshot/route");
    const request = new Request(
      `http://localhost/api/portfolio/live-snapshot?walletAddress=${WALLET_ADDRESS}&chainId=${CHAIN_ID}`,
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    });
  });
});
