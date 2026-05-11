import { afterEach, describe, expect, it, vi } from "vitest";

// Keep importTrackedWallet in outer scope so the mock factory can close over it
// across vi.resetModules() cycles.
const importTrackedWallet = vi.fn();

vi.mock("@/services/api/wallets", () => ({
  importTrackedWallet,
  // Provide a stable WalletImportError class so the route's instanceof check works
  // against the same class definition used in tests.
  WalletImportError: class WalletImportError extends Error {
    code: string;
    constructor(message: string) {
      super(message);
      this.name = "WalletImportError";
      this.code = "UNSUPPORTED_CHAIN";
    }
  },
}));

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";
const VALID_CHAIN_ID = 369;

describe("POST /api/wallets/import route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── 1. Validation failure: missing walletAddress ────────────────────────────

  it("returns 400 with stable error envelope when walletAddress is missing", async () => {
    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: VALID_CHAIN_ID }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(Array.isArray(body.error.details)).toBe(true);
    // No internal exception details should appear in the response
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("stack");
    expect(importTrackedWallet).not.toHaveBeenCalled();
  });

  it("returns 400 with stable error envelope when walletAddress is an empty string", async () => {
    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: "", chainId: VALID_CHAIN_ID }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(importTrackedWallet).not.toHaveBeenCalled();
  });

  // ── 2. Validation failure: invalid chainId ──────────────────────────────────

  it("returns 400 with stable error envelope when chainId is a non-numeric string", async () => {
    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: VALID_ADDRESS, chainId: "not-a-number" }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(importTrackedWallet).not.toHaveBeenCalled();
  });

  it("returns 400 with stable error envelope when chainId is a negative number", async () => {
    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: VALID_ADDRESS, chainId: -1 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(importTrackedWallet).not.toHaveBeenCalled();
  });

  it("returns 400 with stable error envelope when chainId is missing", async () => {
    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: VALID_ADDRESS }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(typeof body.error.message).toBe("string");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(importTrackedWallet).not.toHaveBeenCalled();
  });

  // ── 3. Failure path: service throws WalletImportError ──────────────────────

  it("returns 400 with UNSUPPORTED_CHAIN when service raises WalletImportError", async () => {
    const { WalletImportError } = await import("@/services/api/wallets");
    importTrackedWallet.mockRejectedValue(
      new WalletImportError("Chain is not supported for wallet import."),
    );

    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("UNSUPPORTED_CHAIN");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    // No stack or internal details leaked
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("stack");
    expect(importTrackedWallet).toHaveBeenCalledOnce();
  });

  // ── 4. Failure path: service throws unexpectedly → HTTP 500 ────────────────

  it("returns 500 with operator-safe error envelope and no internal details when service throws unexpectedly", async () => {
    const secretDetail = "secret-host:5432/internal-db";
    importTrackedWallet.mockRejectedValue(
      new Error(`database connection refused: ${secretDetail}`),
    );

    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID }),
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error.");
    // Internal exception details must not be exposed in the response
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(secretDetail);
    expect(bodyText).not.toContain("database connection refused");
    expect(bodyText).not.toContain("stack");
    expect(importTrackedWallet).toHaveBeenCalledOnce();
  });

  // ── 5. Success path: stable response shape ──────────────────────────────────

  it("returns 200 with stable wallet data shape on success", async () => {
    importTrackedWallet.mockResolvedValue({
      id: "wallet-1",
      address: VALID_ADDRESS.toLowerCase(),
      chainId: VALID_CHAIN_ID,
      label: "PulseChain Wallet",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
      updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    });

    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: VALID_ADDRESS,
          chainId: VALID_CHAIN_ID,
          label: "PulseChain Wallet",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.id).toBe("string");
    expect(typeof body.data.address).toBe("string");
    expect(typeof body.data.chainId).toBe("number");
    expect(body.data.chainId).toBe(VALID_CHAIN_ID);
    // label, createdAt, updatedAt are present in the response shape
    expect("label" in body.data).toBe(true);
    expect("createdAt" in body.data).toBe(true);
    expect("updatedAt" in body.data).toBe(true);
    expect(importTrackedWallet).toHaveBeenCalledOnce();
  });

  it("returns 200 with stable wallet data shape on success without optional label", async () => {
    importTrackedWallet.mockResolvedValue({
      id: "wallet-2",
      address: VALID_ADDRESS.toLowerCase(),
      chainId: VALID_CHAIN_ID,
      label: null,
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
      updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    });

    const { POST } = await import("../../app/api/wallets/import/route");
    const response = await POST(
      new Request("http://localhost/api/wallets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: VALID_ADDRESS, chainId: VALID_CHAIN_ID }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.id).toBe("string");
    expect(body.data.chainId).toBe(VALID_CHAIN_ID);
    expect(importTrackedWallet).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: VALID_ADDRESS.toLowerCase(), chainId: VALID_CHAIN_ID }),
    );
  });
});
