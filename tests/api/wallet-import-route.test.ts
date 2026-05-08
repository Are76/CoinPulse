import { afterEach, describe, expect, it, vi } from "vitest";

const importTrackedWallet = vi.fn();

vi.mock("@/services/api/wallets", () => ({
  importTrackedWallet,
  WalletImportError: class WalletImportError extends Error {
    code = "UNSUPPORTED_CHAIN";
  },
}));

describe("POST /api/wallets/import", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("imports a wallet idempotently through the wallet service", async () => {
    importTrackedWallet.mockResolvedValue({
      id: "wallet-1",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      label: "Main",
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    });

    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          label: "Main",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: "wallet-1",
        address: "0x1111111111111111111111111111111111111111",
        chainId: 369,
        label: "Main",
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
    });
    expect(importTrackedWallet).toHaveBeenCalledWith({
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 369,
      label: "Main",
    });
  });

  it("returns a structured validation error for invalid import input", async () => {
    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "bad",
          chainId: "oops",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid request input.",
        details: expect.any(Array),
      },
    });
    expect(importTrackedWallet).not.toHaveBeenCalled();
  });
});
