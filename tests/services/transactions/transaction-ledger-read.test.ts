import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";
import { listCanonicalTransactions } from "@/services/transactions";
import {
  TRANSACTIONS_DEFAULT_LIMIT,
  TRANSACTIONS_MAX_LIMIT,
  TRANSACTIONS_SCHEMA_VERSION,
} from "@/services/transactions/types";

// vi.mock is hoisted before imports by Vitest's transform. Factories must not
// reference module-level variables that are in TDZ at factory evaluation time.
vi.mock("@/services/api/wallets", () => ({
  resolveTrackedWalletByAddress: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const CHAIN_ID = 369;
const WALLET_ID = "wallet-cuid-001";

const MOCK_WALLET = { id: WALLET_ID, address: WALLET_ADDRESS, chainId: CHAIN_ID };

function makeDecimal(raw: string) {
  return { toString: () => raw };
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-001",
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    actionGroupId: "ag-001",
    txHash: "0xdeadbeef",
    entryType: "RECEIVE",
    assetId: "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    quantity: makeDecimal("1000000000000000000"),
    valueUsd: null,
    direction: "IN",
    normalizerVersion: "v1",
    occurredAt: new Date("2026-05-01T12:00:00.000Z"),
    sourceLogIndex: 0,
    sourceLogKey: "log:0xdeadbeef:0:0",
    dedupeKey: "dedup-001",
    createdAt: new Date("2026-05-01T12:00:00.000Z"),
    token: null,
    ...overrides,
  };
}

function makeActionGroup(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    txHash: "0xdeadbeef",
    chainId: CHAIN_ID,
    walletId: WALLET_ID,
    actionGroupKey: `key-${id}`,
    actionType: "TRANSFER",
    occurredAt: new Date("2026-05-01T12:00:00.000Z"),
    createdAt: new Date("2026-05-01T12:00:00.000Z"),
    entries: [],
    ...overrides,
  };
}

// Helper: wire up both mocks for a test. mockDb controls what findMany returns.
// matState defaults to a covered block range when wallet is non-null, null otherwise.
function setupMocks(
  wallet: typeof MOCK_WALLET | null,
  actionGroups: unknown[],
  matState: { sourceLedgerFromBlock: bigint | null; sourceLedgerToBlock: bigint | null } | null = wallet
    ? { sourceLedgerFromBlock: 1_000_000n, sourceLedgerToBlock: 2_000_000n }
    : null,
) {
  const mockFindMany = vi.fn().mockResolvedValue(actionGroups);
  vi.mocked(resolveTrackedWalletByAddress).mockResolvedValue(wallet as never);
  vi.mocked(getDb).mockReturnValue({
    ledgerActionGroup: { findMany: mockFindMany },
    portfolioMaterializationState: { findUnique: vi.fn().mockResolvedValue(matState) },
  } as unknown as ReturnType<typeof getDb>);
  return { mockFindMany };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ── 1. Wallet not tracked ─────────────────────────────────────────────────────

describe("listCanonicalTransactions — wallet not tracked", () => {
  it("returns empty page with unknown coverage when wallet is not found", async () => {
    const { mockFindMany } = setupMocks(null, []);

    const result = await listCanonicalTransactions({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(result.schemaVersion).toBe(TRANSACTIONS_SCHEMA_VERSION);
    expect(result.transactions).toEqual([]);
    expect(result.ledgerCoverage.status).toBe("unknown");
    expect(result.ledgerCoverage.reason).toBe("wallet-not-tracked");
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.nextCursor).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("does not query the ledger when wallet is not tracked", async () => {
    const { mockFindMany } = setupMocks(null, []);
    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

// ── 2. Wallet tracked, empty ledger ───────────────────────────────────────────

describe("listCanonicalTransactions — wallet tracked, empty ledger", () => {
  it("returns empty transactions with covered coverage when wallet exists but has no entries", async () => {
    setupMocks(MOCK_WALLET, []);

    const result = await listCanonicalTransactions({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(result.schemaVersion).toBe(TRANSACTIONS_SCHEMA_VERSION);
    expect(result.transactions).toEqual([]);
    expect(result.ledgerCoverage.status).toBe("covered");
    expect(result.ledgerCoverage.reason).toBeNull();
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.nextCursor).toBeNull();
  });

  it("reports covered ledger — not unknown — when the wallet is tracked", async () => {
    setupMocks(MOCK_WALLET, []);

    const result = await listCanonicalTransactions({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(result.ledgerCoverage.status).toBe("covered");
    expect(result.ledgerCoverage.status).not.toBe("unknown");
  });
});

// ── 3. Wallet with transactions ───────────────────────────────────────────────

describe("listCanonicalTransactions — wallet with transactions", () => {
  it("returns mapped TransactionDto for each action group", async () => {
    const ag = makeActionGroup("ag-001", { entries: [makeEntry()] });
    setupMocks(MOCK_WALLET, [ag]);

    const result = await listCanonicalTransactions({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx.transactionId).toBe("ag-001");
    expect(tx.txHash).toBe("0xdeadbeef");
    expect(tx.chainId).toBe(CHAIN_ID);
    expect(tx.walletId).toBe(WALLET_ID);
    expect(tx.walletAddress).toBe(WALLET_ADDRESS);
    expect(tx.occurredAt).toBe("2026-05-01T12:00:00.000Z");
    expect(tx.blockNumber).toBeNull();
    expect(tx.actionGroupId).toBe("ag-001");
    expect(tx.actionType).toBe("TRANSFER");
    expect(tx.sourceFamily).toBe("TRANSFERS");
    expect(tx.protocol).toBeNull();
    expect(tx.status).toBe("complete");
    expect(tx.warnings).toEqual([]);
  });

  it("maps entry fields from LedgerEntry to TransactionEntryDto", async () => {
    const entry = makeEntry({
      id: "entry-abc",
      assetId: "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      entryType: "SEND",
      direction: "OUT",
      quantity: makeDecimal("500000000000000000"),
      token: { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", decimals: 18 },
    });
    setupMocks(MOCK_WALLET, [makeActionGroup("ag-001", { entries: [entry] })]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const e = result.transactions[0].entries[0];

    expect(e.entryId).toBe("entry-abc");
    expect(e.assetId).toBe("chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(e.assetAddress).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(e.entryType).toBe("SEND");
    expect(e.direction).toBe("OUT");
    expect(e.quantity).toBe("500000000000000000");
    expect(e.decimals).toBe(18);
  });

  it("entry assetId uses chain-aware identity, not a bare symbol or ticker", async () => {
    const chainAwareId = "chain:369:erc20:0xcccccccccccccccccccccccccccccccccccccccc";
    setupMocks(MOCK_WALLET, [makeActionGroup("ag-001", { entries: [makeEntry({ assetId: chainAwareId })] })]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const e = result.transactions[0].entries[0];

    expect(e.assetId).toContain("chain:");
    expect(e.assetId).not.toMatch(/^[A-Z]{2,6}$/);
  });

  it("entry has null assetAddress and null decimals when no token is joined", async () => {
    setupMocks(MOCK_WALLET, [
      makeActionGroup("ag-001", { entries: [makeEntry({ token: null })] }),
    ]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const e = result.transactions[0].entries[0];
    expect(e.assetAddress).toBeNull();
    expect(e.decimals).toBeNull();
  });

  it("pricingStatus is priced and valuationStatus is valued when valueUsd is present", async () => {
    setupMocks(MOCK_WALLET, [
      makeActionGroup("ag-001", { entries: [makeEntry({ valueUsd: makeDecimal("12.50") })] }),
    ]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const e = result.transactions[0].entries[0];

    expect(e.pricingStatus).toBe("priced");
    expect(e.valuationStatus).toBe("valued");
    expect(e.valueQuote).toBe("12.50");
    expect(e.quoteAsset).toBe("USD");
  });

  it("pricingStatus and valuationStatus are unavailable when valueUsd is null", async () => {
    setupMocks(MOCK_WALLET, [
      makeActionGroup("ag-001", { entries: [makeEntry({ valueUsd: null })] }),
    ]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const e = result.transactions[0].entries[0];

    expect(e.pricingStatus).toBe("unavailable");
    expect(e.valuationStatus).toBe("unavailable");
    expect(e.valueQuote).toBeNull();
    expect(e.quoteAsset).toBeNull();
  });

  it("per-transaction provenance carries covered ledgerCoverage with null reason", async () => {
    setupMocks(MOCK_WALLET, [makeActionGroup("ag-001")]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const tx = result.transactions[0];

    expect(tx.provenance.ledgerCoverage.status).toBe("covered");
    expect(tx.provenance.ledgerCoverage.reason).toBeNull();
    expect(tx.provenance.materializationAsOf).toBeNull();
  });
});

// ── 4. Chain filtering ────────────────────────────────────────────────────────

describe("listCanonicalTransactions — chain filtering", () => {
  it("queries the ledger with the correct walletId and chainId", async () => {
    const { mockFindMany } = setupMocks(MOCK_WALLET, []);

    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletId: WALLET_ID, chainId: CHAIN_ID },
      }),
    );
  });

  it("resolves the wallet with the correct walletAddress and chainId", async () => {
    setupMocks(null, []);

    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: 1 });

    expect(vi.mocked(resolveTrackedWalletByAddress)).toHaveBeenCalledWith({
      walletAddress: WALLET_ADDRESS,
      chainId: 1,
    });
  });
});

// ── 5a. Wallet address normalization ─────────────────────────────────────────

describe("listCanonicalTransactions — walletAddress normalization", () => {
  it("page envelope walletAddress is lowercase even when a mixed-case address is passed", async () => {
    const mixedCase = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
    const expectedLower = mixedCase.toLowerCase();
    setupMocks(
      { id: WALLET_ID, address: expectedLower, chainId: CHAIN_ID },
      [],
    );

    const result = await listCanonicalTransactions({ walletAddress: mixedCase, chainId: CHAIN_ID });

    expect(result.walletAddress).toBe(expectedLower);
    expect(result.walletAddress).not.toBe(mixedCase);
  });

  it("each transaction DTO walletAddress matches the normalized page envelope walletAddress", async () => {
    const mixedCase = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
    const expectedLower = mixedCase.toLowerCase();
    setupMocks(
      { id: WALLET_ID, address: expectedLower, chainId: CHAIN_ID },
      [makeActionGroup("ag-001")],
    );

    const result = await listCanonicalTransactions({ walletAddress: mixedCase, chainId: CHAIN_ID });

    expect(result.walletAddress).toBe(expectedLower);
    for (const tx of result.transactions) {
      expect(tx.walletAddress).toBe(result.walletAddress);
    }
  });

  it("walletAddress is consistent across page envelope and all transaction DTOs", async () => {
    setupMocks(MOCK_WALLET, [
      makeActionGroup("ag-001"),
      makeActionGroup("ag-002"),
    ]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(result.transactions).toHaveLength(2);
    for (const tx of result.transactions) {
      expect(tx.walletAddress).toBe(result.walletAddress);
    }
  });

  it("unknown-coverage response also uses the normalized walletAddress", async () => {
    const mixedCase = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
    const expectedLower = mixedCase.toLowerCase();
    const { mockFindMany } = setupMocks(null, []);

    const result = await listCanonicalTransactions({ walletAddress: mixedCase, chainId: CHAIN_ID });

    expect(result.walletAddress).toBe(expectedLower);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

// ── 5. Limit behaviour ────────────────────────────────────────────────────────

describe("listCanonicalTransactions — limit", () => {
  it("passes default limit + 1 to the db query when no limit is supplied", async () => {
    const { mockFindMany } = setupMocks(MOCK_WALLET, []);

    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: TRANSACTIONS_DEFAULT_LIMIT + 1 }),
    );
  });

  it("passes the requested limit + 1 to the db query when within bounds", async () => {
    const { mockFindMany } = setupMocks(MOCK_WALLET, []);

    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID, limit: 10 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 11 }),
    );
  });

  it("caps take at TRANSACTIONS_MAX_LIMIT + 1 in the db query", async () => {
    const { mockFindMany } = setupMocks(MOCK_WALLET, []);

    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID, limit: 9999 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: TRANSACTIONS_MAX_LIMIT + 1 }),
    );
  });

  it("pageInfo.limit reflects the resolved limit", async () => {
    setupMocks(MOCK_WALLET, []);

    const result = await listCanonicalTransactions({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
      limit: 25,
    });

    expect(result.pageInfo.limit).toBe(25);
  });
});

// ── 6. Stable ordering ────────────────────────────────────────────────────────

describe("listCanonicalTransactions — ordering", () => {
  it("queries ledger ordered by occurredAt desc then id asc", async () => {
    const { mockFindMany } = setupMocks(MOCK_WALLET, []);

    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      }),
    );
  });

  it("included entries are queried with deterministic orderBy (occurredAt asc, id asc)", async () => {
    const { mockFindMany } = setupMocks(MOCK_WALLET, []);

    await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          entries: expect.objectContaining({
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          }),
        }),
      }),
    );
  });

  it("transactions are in the order returned by the db (newest first)", async () => {
    const ag1 = makeActionGroup("ag-newer", {
      occurredAt: new Date("2026-05-02T00:00:00.000Z"),
    });
    const ag2 = makeActionGroup("ag-older", {
      occurredAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    // DB returns newest-first as ordered by the query
    setupMocks(MOCK_WALLET, [ag1, ag2]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(result.transactions[0].transactionId).toBe("ag-newer");
    expect(result.transactions[1].transactionId).toBe("ag-older");
  });
});

// ── 7. No raw-log access ──────────────────────────────────────────────────────

describe("listCanonicalTransactions — no raw-log access", () => {
  it("response does not contain rawLog, rawTransaction, or rawTokenTransfer fields", async () => {
    const entry = makeEntry({ sourceLogIndex: 42, sourceLogKey: "log:0xdeadbeef:42:0" });
    setupMocks(MOCK_WALLET, [makeActionGroup("ag-001", { entries: [entry] })]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const json = JSON.stringify(result);

    expect(json).not.toContain("rawLog");
    expect(json).not.toContain("rawTransaction");
    expect(json).not.toContain("rawTokenTransfer");
    expect(json).not.toContain('"topics"');
    expect(json).not.toContain('"logIndex"');
  });

  it("sourceLogIndex and sourceLogKey are not forwarded to the DTO", async () => {
    const entry = makeEntry({ sourceLogIndex: 42, sourceLogKey: "log:0xdeadbeef:42:0" });
    setupMocks(MOCK_WALLET, [makeActionGroup("ag-001", { entries: [entry] })]);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });
    const json = JSON.stringify(result);

    expect(json).not.toContain("sourceLogIndex");
    expect(json).not.toContain("sourceLogKey");
  });
});

// ── 8. No RPC access ─────────────────────────────────────────────────────────

describe("listCanonicalTransactions — no RPC access", () => {
  it("service source does not reference RPC client, fetch, or raw log tables", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(process.cwd(), "src/services/transactions/transaction-service.ts"),
      "utf8",
    );
    expect(content).not.toMatch(/ethers|viem|web3|jsonrpc/i);
    expect(content).not.toMatch(/fetch\(/);
    expect(content).not.toMatch(/PULSECHAIN_RPC/);
    expect(content).not.toMatch(/rawLog/i);
    expect(content).not.toMatch(/rawTransaction/i);
    expect(content).not.toMatch(/rawTokenTransfer/i);
  });
});

// ── 9. Safe error handling ────────────────────────────────────────────────────

describe("listCanonicalTransactions — error propagation", () => {
  it("propagates db errors so the route layer can return 500", async () => {
    vi.mocked(resolveTrackedWalletByAddress).mockResolvedValue(MOCK_WALLET as never);
    const mockFindMany = vi.fn().mockRejectedValue(new Error("db connection refused"));
    vi.mocked(getDb).mockReturnValue({
      ledgerActionGroup: { findMany: mockFindMany },
      portfolioMaterializationState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as ReturnType<typeof getDb>);

    await expect(
      listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
    ).rejects.toThrow("db connection refused");
  });

  it("propagates wallet-lookup errors so the route layer can return 500", async () => {
    vi.mocked(resolveTrackedWalletByAddress).mockRejectedValue(new Error("wallet lookup failed"));

    await expect(
      listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID }),
    ).rejects.toThrow("wallet lookup failed");
  });
});

// ── 10. Route-contract compatibility ─────────────────────────────────────────

describe("listCanonicalTransactions — route-contract compatibility", () => {
  it("response shape matches TransactionsPageDto contract", async () => {
    setupMocks(MOCK_WALLET, []);

    const result = await listCanonicalTransactions({
      walletAddress: WALLET_ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(result.schemaVersion).toBe(TRANSACTIONS_SCHEMA_VERSION);
    expect(result.walletAddress).toBe(WALLET_ADDRESS);
    expect(result.chainId).toBe(CHAIN_ID);
    expect(result.ledgerCoverage).toBeDefined();
    expect(["covered", "partial", "unknown"]).toContain(result.ledgerCoverage.status);
    expect(result.pageInfo).toBeDefined();
    expect(typeof result.pageInfo.hasNextPage).toBe("boolean");
    expect(typeof result.pageInfo.limit).toBe("number");
    expect("nextCursor" in result.pageInfo).toBe(true);
    expect(Array.isArray(result.transactions)).toBe(true);
  });

  it("does not expose ledgerFresh anywhere in the response", async () => {
    setupMocks(MOCK_WALLET, []);

    const result = await listCanonicalTransactions({ walletAddress: WALLET_ADDRESS, chainId: CHAIN_ID });

    expect(result).not.toHaveProperty("ledgerFresh");
    expect(result.ledgerCoverage).not.toHaveProperty("ledgerFresh");
  });
});
