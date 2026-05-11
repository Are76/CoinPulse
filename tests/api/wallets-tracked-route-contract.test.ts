import { afterEach, describe, expect, it, vi } from "vitest";

const listTrackedWallets = vi.fn();

vi.mock("@/services/api/wallets", () => ({
  listTrackedWallets,
}));

const VALID_ADDRESS_1 = "0x1111111111111111111111111111111111111111";
const VALID_ADDRESS_2 = "0x2222222222222222222222222222222222222222";
const VALID_CHAIN_ID = 369;

describe("GET /api/wallets/tracked route contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── 1. Success: multiple tracked wallets ────────────────────────────────────

  it("returns 200 with schemaVersion v1 and wallet list when multiple wallets exist", async () => {
    listTrackedWallets.mockResolvedValue([
      {
        id: "wallet-1",
        address: VALID_ADDRESS_1,
        chainId: VALID_CHAIN_ID,
        label: "Main Wallet",
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
        updatedAt: new Date("2026-05-10T00:00:00.000Z"),
      },
      {
        id: "wallet-2",
        address: VALID_ADDRESS_2,
        chainId: VALID_CHAIN_ID,
        label: null,
        createdAt: new Date("2026-05-11T00:00:00.000Z"),
        updatedAt: new Date("2026-05-11T00:00:00.000Z"),
      },
    ]);

    const { GET } = await import("../../app/api/wallets/tracked/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.schemaVersion).toBe("v1");
    expect(Array.isArray(body.data.wallets)).toBe(true);
    expect(body.data.wallets).toHaveLength(2);

    const first = body.data.wallets[0];
    expect(typeof first.id).toBe("string");
    expect(typeof first.address).toBe("string");
    expect(typeof first.chainId).toBe("number");
    expect(first.chainId).toBe(VALID_CHAIN_ID);
    expect("label" in first).toBe(true);
    expect("createdAt" in first).toBe(true);
    expect("updatedAt" in first).toBe(true);

    expect(listTrackedWallets).toHaveBeenCalledOnce();
  });

  // ── 2. Success: no wallets ──────────────────────────────────────────────────

  it("returns 200 with schemaVersion v1 and empty wallets array when no wallets exist", async () => {
    listTrackedWallets.mockResolvedValue([]);

    const { GET } = await import("../../app/api/wallets/tracked/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.schemaVersion).toBe("v1");
    expect(Array.isArray(body.data.wallets)).toBe(true);
    expect(body.data.wallets).toHaveLength(0);

    expect(listTrackedWallets).toHaveBeenCalledOnce();
  });

  // ── 3. Failure: service throws → HTTP 500, no internal detail leakage ───────

  it("returns 500 with stable error envelope and no internal details when service throws", async () => {
    const secretDetail = "secret-host:5432/internal-db";
    listTrackedWallets.mockRejectedValue(
      new Error(`database connection refused: ${secretDetail}`),
    );

    const { GET } = await import("../../app/api/wallets/tracked/route");
    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error.");

    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(secretDetail);
    expect(bodyText).not.toContain("database connection refused");
    expect(bodyText).not.toContain("stack");

    expect(listTrackedWallets).toHaveBeenCalledOnce();
  });

  // ── 4. Stable wallet fields ─────────────────────────────────────────────────

  it("returns only backend-owned stable fields for each wallet", async () => {
    listTrackedWallets.mockResolvedValue([
      {
        id: "wallet-abc",
        address: VALID_ADDRESS_1,
        chainId: VALID_CHAIN_ID,
        label: "Test",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const { GET } = await import("../../app/api/wallets/tracked/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    const wallet = body.data.wallets[0];

    expect(wallet.id).toBe("wallet-abc");
    expect(wallet.address).toBe(VALID_ADDRESS_1);
    expect(wallet.chainId).toBe(VALID_CHAIN_ID);
    expect(wallet.label).toBe("Test");
    expect(typeof wallet.createdAt).toBe("string");
    expect(typeof wallet.updatedAt).toBe("string");
  });
});
