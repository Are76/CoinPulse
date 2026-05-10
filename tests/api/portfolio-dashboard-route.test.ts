import { afterEach, describe, expect, it, vi } from "vitest";

const resolveTrackedWalletByAddress = vi.fn();
const assemblePortfolioDashboard = vi.fn();

vi.mock("@/services/api/wallets", () => ({
  resolveTrackedWalletByAddress,
}));

vi.mock("@/services/dashboard", () => ({
  assemblePortfolioDashboard,
}));

describe("GET /api/portfolio/dashboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the assembled dashboard dto for a valid wallet and chain", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    assemblePortfolioDashboard.mockResolvedValue({
      schemaVersion: "v1",
      wallet: {
        id: "wallet-1",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      },
      quoteAsset: "fiat:usd",
      asOf: "2026-05-08T12:00:00.000Z",
      summary: {
        totalValueQuote: "100",
        valuationStatus: "available",
        valuationCoverage: {
          totalPositions: 1,
          valuedPositions: 1,
          unvaluedPositions: 0,
        },
        warnings: [],
      },
      tokenPositions: [],
      lpPositions: [],
      stakePositions: [],
    });

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        "http://localhost/api/portfolio/dashboard?walletAddress=0x1111111111111111111111111111111111111111&chainId=369&quoteAsset=fiat:usd&asOf=2026-05-08T12:00:00.000Z",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        schemaVersion: "v1",
        wallet: {
          id: "wallet-1",
          address: "0x1111111111111111111111111111111111111111",
          chainId: 369,
        },
        quoteAsset: "fiat:usd",
        asOf: "2026-05-08T12:00:00.000Z",
        summary: {
          totalValueQuote: "100",
          valuationStatus: "available",
          valuationCoverage: {
            totalPositions: 1,
            valuedPositions: 1,
            unvaluedPositions: 0,
          },
          warnings: [],
        },
        tokenPositions: [],
        lpPositions: [],
        stakePositions: [],
      },
    });
    expect(resolveTrackedWalletByAddress).toHaveBeenCalledWith({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    expect(assemblePortfolioDashboard).toHaveBeenCalledWith({
      wallet: {
        id: "wallet-1",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      },
      quoteAsset: "fiat:usd",
      asOf: new Date("2026-05-08T12:00:00.000Z"),
    });
  });

  it("returns a structured validation error for invalid inputs", async () => {
    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request("http://localhost/api/portfolio/dashboard?walletAddress=bad&chainId=oops"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid request input.",
        details: expect.any(Array),
      },
    });
    expect(resolveTrackedWalletByAddress).not.toHaveBeenCalled();
    expect(assemblePortfolioDashboard).not.toHaveBeenCalled();
  });

  it("returns not found when the wallet is missing", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(null);

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        "http://localhost/api/portfolio/dashboard?walletAddress=0x1111111111111111111111111111111111111111&chainId=369",
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WALLET_NOT_FOUND",
        message: "Wallet not found for the requested chain.",
      },
    });
    expect(assemblePortfolioDashboard).not.toHaveBeenCalled();
  });

  it("returns a stable internal error response when dashboard assembly throws", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
    });
    assemblePortfolioDashboard.mockRejectedValue(new Error("dashboard exploded"));

    const { GET } = await import("../../app/api/portfolio/dashboard/route");
    const response = await GET(
      new Request(
        "http://localhost/api/portfolio/dashboard?walletAddress=0x1111111111111111111111111111111111111111&chainId=369&quoteAsset=fiat:usd",
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    });
  });
});
