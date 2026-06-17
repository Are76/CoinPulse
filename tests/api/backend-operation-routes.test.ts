import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted before imports. Variable references below are
// captured by closure and work because Vitest resolves them at call time.
const resolveTrackedWalletByAddress = vi.fn();
const runWalletSync = vi.fn();
const runRebuildOperation = vi.fn();
const reserveOperationRunFn = vi.fn();

vi.mock("@/services/api/wallets", () => ({
  resolveTrackedWalletByAddress,
}));

vi.mock("@/services/sync", () => ({
  runWalletSync,
}));

vi.mock("@/services/rebuild", () => ({
  runRebuildOperation,
}));

vi.mock("@/services/operations/operation-lock", () => ({
  reserveOperationRun: reserveOperationRunFn,
  // Minimal type-guard — matches the shape the routes check for 409 routing.
  isOperationConflictError: (e: unknown) =>
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "OPERATION_CONFLICT" &&
    "details" in e &&
    typeof (e as { details: unknown }).details === "object" &&
    (e as { details: unknown }).details !== null &&
    "allowed" in ((e as { details: unknown }).details as object) &&
    ((e as { details: { allowed: unknown } }).details as { allowed: unknown }).allowed === false,
}));

// Execute the after() callback immediately in tests so mock assertions work.
vi.mock("next/server", () => ({
  after: vi.fn((cb: () => Promise<void> | void) => cb()),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_WALLET = {
  id: "wallet-1",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
};

const CONFLICT_DETAILS = {
  allowed: false,
  reason: "active_rebuild_in_progress",
  conflictingOperationId: "run-rebuild-1",
  conflictingTrigger: "REBUILD",
  conflictingStage: "REBUILDING_LEDGER",
  operationType: "rebuild",
  status: "RUNNING",
  startedAt: "2026-05-08T10:00:00.000Z",
  createdAt: "2026-05-08T10:00:00.000Z",
  updatedAt: "2026-05-08T10:01:00.000Z",
  ageMs: 60000,
  appearsStale: false,
  staleReason: null,
};

// ─── POST /api/sync/manual ─────────────────────────────────────────────────────

describe("POST /api/sync/manual", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 202 with runId immediately — sync work runs after the response", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "sync-run-1" });
    runWalletSync.mockResolvedValue({
      runId: "sync-run-1",
      counts: { rawLogs: 10, actionGroups: 4, ledgerEntries: 9 },
      warningCount: 1,
      latestSafeBlock: 200n,
    });

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS", "DEX"],
          endBlock: "200",
          startBlock: "100",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { runId: "sync-run-1" } });
  });

  it("calls reserveOperationRun with the correct args before returning 202", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "sync-run-1" });
    runWalletSync.mockResolvedValue({ runId: "sync-run-1" });

    const { POST } = await import("../../app/api/sync/manual/route");
    await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS", "DEX"],
          endBlock: "200",
          startBlock: "100",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(reserveOperationRunFn).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        chainId: 369,
        trigger: "MANUAL",
        status: "PENDING",
        stage: "PENDING",
        sourceFamilies: ["TRANSFERS", "DEX"],
        startBlock: 100n,
        endBlock: 200n,
        policyLabel: "manual-dashboard-sync",
      }),
    );
  });

  it("delegates async sync work to runWalletSync with pre-reserved runId injected", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "sync-run-1" });
    runWalletSync.mockResolvedValue({ runId: "sync-run-1" });

    const { POST } = await import("../../app/api/sync/manual/route");
    await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS", "DEX"],
          endBlock: "200",
          startBlock: "100",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    // flush pending microtasks so the after() callback resolves
    await Promise.resolve();

    expect(runWalletSync).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: MOCK_WALLET,
        sourceFamilies: ["TRANSFERS", "DEX"],
        startBlock: 100n,
        endBlock: 200n,
        policyLabel: "manual-dashboard-sync",
        trigger: "MANUAL",
        dependencies: expect.objectContaining({
          reserveOperationRun: expect.any(Function),
        }),
      }),
    );
  });

  it("reserves startBlock: 0n when no explicit startBlock is supplied", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "sync-run-1" });
    runWalletSync.mockResolvedValue({ runId: "sync-run-1" });

    const { POST } = await import("../../app/api/sync/manual/route");
    await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(reserveOperationRunFn).toHaveBeenCalledWith(
      expect.objectContaining({ startBlock: 0n }),
    );
  });

  it("returns 202 even when async sync work subsequently fails", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "sync-run-1" });
    // The after() callback will catch this — the HTTP response is still 202.
    runWalletSync.mockRejectedValue(new Error("rpc connection refused"));

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { runId: "sync-run-1" } });
  });

  it("returns a structured validation error for invalid sync input", async () => {
    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
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
    expect(reserveOperationRunFn).not.toHaveBeenCalled();
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("returns not found when the requested tracked wallet is absent", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(null);

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WALLET_NOT_FOUND",
        message: "Wallet not found for the requested chain.",
      },
    });
    expect(reserveOperationRunFn).not.toHaveBeenCalled();
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("returns 500 when pre-reservation fails with an unexpected error", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockRejectedValue(new Error("db connection refused"));

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    expect(JSON.stringify(body)).not.toContain("db connection refused");
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("rejects block spans above the safe limit before calling the sync service", async () => {
    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS", "DEX", "LP", "STAKING"],
          startBlock: "26740000",
          endBlock: "26797360",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toBe("Invalid request input.");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Block span exceeds") }),
      ]),
    );
    expect(reserveOperationRunFn).not.toHaveBeenCalled();
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("accepts block spans at or below the safe limit and returns 202", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "sync-run-safe" });
    runWalletSync.mockResolvedValue({ runId: "sync-run-safe" });

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          startBlock: "0",
          endBlock: "1000",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(reserveOperationRunFn).toHaveBeenCalled();
  });

  it("returns a structured 400 with a safe message that does not leak secrets", async () => {
    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          startBlock: "0",
          endBlock: "99999",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/rpc/i);
    expect(bodyStr).not.toMatch(/secret/i);
    expect(bodyStr).not.toMatch(/stack/i);
    expect(bodyStr).not.toMatch(/env\b/i);
    expect(reserveOperationRunFn).not.toHaveBeenCalled();
    expect(runWalletSync).not.toHaveBeenCalled();
  });

  it("returns a structured 409 conflict when reservation is blocked by an active rebuild", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockRejectedValue({
      code: "OPERATION_CONFLICT",
      message: "A conflicting operation is already active.",
      details: CONFLICT_DETAILS,
    });

    const { POST } = await import("../../app/api/sync/manual/route");
    const response = await POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          sourceFamilies: ["TRANSFERS"],
          endBlock: "200",
          policyLabel: "manual-dashboard-sync",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OPERATION_CONFLICT",
        message: "A conflicting operation is already active.",
        details: CONFLICT_DETAILS,
      },
    });
    expect(runWalletSync).not.toHaveBeenCalled();
  });
});

// ─── POST /api/rebuild ─────────────────────────────────────────────────────────

describe("POST /api/rebuild", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 202 with runId immediately — rebuild work runs after the response", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "rebuild-run-1" });
    runRebuildOperation.mockResolvedValue({
      runId: "rebuild-run-1",
      warningCount: 0,
      rebuild: {},
      materialized: {},
    });

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS", "DEX"],
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { runId: "rebuild-run-1" } });
  });

  it("calls reserveOperationRun with the correct REBUILD args before returning 202", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "rebuild-run-1" });
    runRebuildOperation.mockResolvedValue({ runId: "rebuild-run-1" });

    const { POST } = await import("../../app/api/rebuild/route");
    await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS", "DEX"],
        }),
      }),
    );

    expect(reserveOperationRunFn).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        chainId: 369,
        trigger: "REBUILD",
        status: "PENDING",
        stage: "PENDING",
        sourceFamilies: ["TRANSFERS", "DEX"],
        startBlock: 100n,
        endBlock: 200n,
        policyLabel: "manual-rebuild",
      }),
    );
  });

  it("delegates async rebuild to runRebuildOperation with pre-reserved runId injected", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "rebuild-run-1" });
    runRebuildOperation.mockResolvedValue({ runId: "rebuild-run-1" });

    const { POST } = await import("../../app/api/rebuild/route");
    await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS", "DEX"],
        }),
      }),
    );

    await Promise.resolve();

    expect(runRebuildOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: MOCK_WALLET,
        fromBlock: 100n,
        toBlock: 200n,
        sourceFamilies: ["TRANSFERS", "DEX"],
        dependencies: expect.objectContaining({
          reserveOperationRun: expect.any(Function),
        }),
      }),
    );
  });

  it("returns 202 even when async rebuild work subsequently fails", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockResolvedValue({ id: "rebuild-run-1" });
    runRebuildOperation.mockRejectedValue(new Error("ledger rebuild failed"));

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS"],
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { runId: "rebuild-run-1" } });
  });

  it("rejects rebuild block spans above the safe limit before calling the rebuild service", async () => {
    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "26740000",
          toBlock: "26797360",
          sourceFamilies: ["TRANSFERS", "DEX"],
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Block span exceeds") }),
      ]),
    );
    expect(resolveTrackedWalletByAddress).not.toHaveBeenCalled();
    expect(reserveOperationRunFn).not.toHaveBeenCalled();
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });

  it("returns a structured validation error for invalid rebuild input", async () => {
    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "bad",
          chainId: "oops",
          fromBlock: "200",
          toBlock: "100",
          sourceFamilies: [],
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
    expect(resolveTrackedWalletByAddress).not.toHaveBeenCalled();
    expect(reserveOperationRunFn).not.toHaveBeenCalled();
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });

  it("returns not found when the requested rebuild wallet is absent", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(null);

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS"],
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WALLET_NOT_FOUND",
        message: "Wallet not found for the requested chain.",
      },
    });
    expect(reserveOperationRunFn).not.toHaveBeenCalled();
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });

  it("returns 500 when pre-reservation fails with an unexpected error", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    reserveOperationRunFn.mockRejectedValue(new Error("ledger secret stack detail"));

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS"],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    expect(JSON.stringify(body)).not.toContain("ledger secret stack detail");
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });

  it("returns a structured 409 conflict when rebuild is blocked by an active sync", async () => {
    resolveTrackedWalletByAddress.mockResolvedValue(MOCK_WALLET);
    const conflictDetails = {
      allowed: false,
      reason: "active_sync_in_scope",
      conflictingOperationId: "run-sync-1",
      conflictingTrigger: "MANUAL",
      conflictingStage: "PERSISTING_LEDGER",
      operationType: "manual_sync",
      status: "RUNNING",
      startedAt: "2026-05-08T12:00:00.000Z",
      createdAt: "2026-05-08T12:00:00.000Z",
      updatedAt: "2026-05-08T12:01:00.000Z",
      ageMs: 60000,
      appearsStale: false,
      staleReason: null,
    };
    reserveOperationRunFn.mockRejectedValue({
      code: "OPERATION_CONFLICT",
      message: "A conflicting operation is already active.",
      details: conflictDetails,
    });

    const { POST } = await import("../../app/api/rebuild/route");
    const response = await POST(
      new Request("http://localhost/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: "0x1111111111111111111111111111111111111111",
          chainId: 369,
          fromBlock: "100",
          toBlock: "200",
          sourceFamilies: ["TRANSFERS"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OPERATION_CONFLICT",
        message: "A conflicting operation is already active.",
        details: conflictDetails,
      },
    });
    expect(runRebuildOperation).not.toHaveBeenCalled();
  });
});
