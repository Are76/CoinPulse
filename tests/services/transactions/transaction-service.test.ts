import { describe, expect, it } from "vitest";

import {
  buildEmptyTransactionsPage,
  buildTransactionPageInfo,
  listCanonicalTransactions,
  listTransactionsArgsSchema,
  resolveTransactionCursor,
  resolveTransactionLimit,
  TRANSACTIONS_DEFAULT_LIMIT,
  TRANSACTIONS_MAX_LIMIT,
  TRANSACTIONS_SCHEMA_VERSION,
} from "@/services/transactions";
import type { TransactionLedgerCoverageStatus } from "@/services/transactions";

const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const CHAIN_ID = 369;

describe("TRANSACTIONS_SCHEMA_VERSION", () => {
  it("is v1", () => {
    expect(TRANSACTIONS_SCHEMA_VERSION).toBe("v1");
  });
});

describe("resolveTransactionLimit", () => {
  it("returns default limit when undefined", () => {
    expect(resolveTransactionLimit(undefined)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("caps at TRANSACTIONS_MAX_LIMIT", () => {
    expect(resolveTransactionLimit(9999)).toBe(TRANSACTIONS_MAX_LIMIT);
  });

  it("returns the requested value when within bounds", () => {
    expect(resolveTransactionLimit(10)).toBe(10);
  });

  it("returns default limit for non-positive values", () => {
    expect(resolveTransactionLimit(0)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
    expect(resolveTransactionLimit(-1)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("returns default limit for NaN (e.g. Number('abc'))", () => {
    expect(resolveTransactionLimit(Number("abc"))).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("returns default limit for fractional values", () => {
    expect(resolveTransactionLimit(1.5)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
    expect(resolveTransactionLimit(10.9)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("returns default limit for Infinity", () => {
    expect(resolveTransactionLimit(Infinity)).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("TRANSACTIONS_MAX_LIMIT is 100", () => {
    expect(TRANSACTIONS_MAX_LIMIT).toBe(100);
  });
});

describe("listTransactionsArgsSchema", () => {
  it("accepts a valid minimal request", () => {
    const result = listTransactionsArgsSchema.safeParse({
      walletAddress: "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd",
      chainId: 369,
    });
    expect(result.success).toBe(true);
  });

  it("normalises walletAddress to lowercase", () => {
    const result = listTransactionsArgsSchema.safeParse({
      walletAddress: "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
      chainId: 369,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.walletAddress).toBe(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
    }
  });

  it("rejects an invalid walletAddress", () => {
    const result = listTransactionsArgsSchema.safeParse({
      walletAddress: "not-an-address",
      chainId: 369,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive chainId", () => {
    const result = listTransactionsArgsSchema.safeParse({
      walletAddress: WALLET,
      chainId: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a limit that exceeds TRANSACTIONS_MAX_LIMIT", () => {
    const result = listTransactionsArgsSchema.safeParse({
      walletAddress: WALLET,
      chainId: 369,
      limit: 9999,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a limit within bounds", () => {
    const result = listTransactionsArgsSchema.safeParse({
      walletAddress: WALLET,
      chainId: 369,
      limit: 25,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a fractional limit", () => {
    const result = listTransactionsArgsSchema.safeParse({
      walletAddress: WALLET,
      chainId: 369,
      limit: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("buildEmptyTransactionsPage", () => {
  const page = buildEmptyTransactionsPage({
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    limit: 50,
  });

  it("returns v1 schemaVersion", () => {
    expect(page.schemaVersion).toBe("v1");
  });

  it("returns empty transactions array", () => {
    expect(page.transactions).toEqual([]);
  });

  it("returns walletAddress and chainId from args", () => {
    expect(page.walletAddress).toBe(WALLET);
    expect(page.chainId).toBe(CHAIN_ID);
  });

  it("pageInfo has no next page and null cursor", () => {
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it("pageInfo limit matches requested limit", () => {
    expect(page.pageInfo.limit).toBe(50);
  });
});

describe("listCanonicalTransactions", () => {
  it("returns a stable v1 empty envelope", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.schemaVersion).toBe("v1");
    expect(result.transactions).toEqual([]);
    expect(result.walletAddress).toBe(WALLET);
    expect(result.chainId).toBe(CHAIN_ID);
  });

  it("applies default limit when no limit is supplied", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.pageInfo.limit).toBe(TRANSACTIONS_DEFAULT_LIMIT);
  });

  it("caps limit at TRANSACTIONS_MAX_LIMIT", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 9999,
    });

    expect(result.pageInfo.limit).toBeLessThanOrEqual(TRANSACTIONS_MAX_LIMIT);
  });

  it("pageInfo.hasNextPage is false for empty result", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.nextCursor).toBeNull();
  });
});

describe("DTO type shape — design-time checks", () => {
  it("quantity is a string, not a number", () => {
    const entry = {
      entryId: "e1",
      assetId: "asset:369:0xabc",
      assetAddress: null,
      entryType: "ASSET_OUT",
      direction: "OUT" as const,
      quantity: "1000000000000000000",
      decimals: 18,
      pricingStatus: "unavailable" as const,
      pricingProvenance: null,
      valuationStatus: "unavailable" as const,
      valueQuote: null,
      quoteAsset: null,
      pnlImpact: null,
      warnings: [],
      rejectedReason: null,
    };

    expect(typeof entry.quantity).toBe("string");
  });

  it("blockNumber is nullable — not required when not in canonical ledger", () => {
    const tx = {
      transactionId: "tx-1",
      txHash: "0xdeadbeef",
      chainId: CHAIN_ID,
      walletId: "wallet-1",
      walletAddress: WALLET,
      occurredAt: "2026-05-01T12:00:00.000Z",
      blockNumber: null,
      actionGroupId: "ag-1",
      actionType: "TRANSFER",
      sourceFamily: null,
      protocol: null,
      status: "complete" as const,
      warnings: [],
      provenance: {
        ledgerCoverage: { status: "covered" as TransactionLedgerCoverageStatus, reason: null },
        materializationAsOf: null,
      },
      entries: [],
    };

    // blockNumber and sourceFamily are null when not sourced from canonical ledger
    expect(tx.blockNumber).toBeNull();
    expect(tx.sourceFamily).toBeNull();
  });

  it("provenance does not have ledgerFresh boolean", () => {
    const provenance = {
      ledgerCoverage: { status: "unknown" as TransactionLedgerCoverageStatus, reason: "test" },
      materializationAsOf: null,
    };
    expect(provenance).not.toHaveProperty("ledgerFresh");
  });

  it("direction uses INTERNAL not NEUTRAL — aligned with PnLDirection", () => {
    const validDirections: string[] = ["IN", "OUT", "INTERNAL"];
    expect(validDirections).toContain("INTERNAL");
    expect(validDirections).not.toContain("NEUTRAL");
  });

  it("assetId is not a bare symbol or ticker", () => {
    const assetId = "asset:369:0xabc";
    expect(assetId).not.toMatch(/^[A-Z]{2,6}$/);
  });

  it("pricingStatus and valuationStatus have explicit unavailable/unsupported states", () => {
    const pricingStatuses = [
      "priced",
      "unpriced",
      "stale",
      "rejected",
      "unsupported",
      "unavailable",
    ] as const;
    const valuationStatuses = [
      "valued",
      "unvalued",
      "stale",
      "rejected",
      "unsupported",
      "unavailable",
    ] as const;

    expect(pricingStatuses).toContain("unsupported");
    expect(pricingStatuses).toContain("unavailable");
    expect(valuationStatuses).toContain("unsupported");
    expect(valuationStatuses).toContain("unavailable");
  });
});

describe("resolveTransactionCursor", () => {
  it("returns null for undefined", () => {
    expect(resolveTransactionCursor(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveTransactionCursor("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(resolveTransactionCursor("   ")).toBeNull();
  });

  it("returns trimmed cursor for a valid opaque value", () => {
    expect(resolveTransactionCursor("  cursor-abc-123  ")).toBe("cursor-abc-123");
  });

  it("returns the cursor unchanged when already trimmed", () => {
    expect(resolveTransactionCursor("cursor-abc-123")).toBe("cursor-abc-123");
  });
});

describe("buildTransactionPageInfo", () => {
  it("defaults to hasNextPage=false and nextCursor=null", () => {
    const info = buildTransactionPageInfo({ limit: 50 });
    expect(info.hasNextPage).toBe(false);
    expect(info.nextCursor).toBeNull();
    expect(info.limit).toBe(50);
  });

  it("reflects explicit hasNextPage=true and a non-null cursor", () => {
    const info = buildTransactionPageInfo({
      limit: 25,
      hasNextPage: true,
      nextCursor: "next-page-token",
    });
    expect(info.hasNextPage).toBe(true);
    expect(info.nextCursor).toBe("next-page-token");
    expect(info.limit).toBe(25);
  });

  it("nextCursor is null when hasNextPage is false and no cursor supplied", () => {
    const info = buildTransactionPageInfo({ limit: 50, hasNextPage: false });
    expect(info.nextCursor).toBeNull();
  });
});

describe("listCanonicalTransactions — cursor defaults", () => {
  it("nextCursor is null by default (no cursor arg)", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.pageInfo.nextCursor).toBeNull();
  });

  it("nextCursor remains null when an empty cursor is passed", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      cursor: "",
    });
    expect(result.pageInfo.nextCursor).toBeNull();
  });

  it("hasNextPage is always false from the skeleton", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      cursor: "some-cursor",
    });
    expect(result.pageInfo.hasNextPage).toBe(false);
  });
});

describe("service skeleton — no raw log dependency", () => {
  it("exports the five expected functions", async () => {
    const mod = await import(
      "@/services/transactions/transaction-service"
    );

    const keys = Object.keys(mod);
    expect(keys).toContain("listCanonicalTransactions");
    expect(keys).toContain("buildEmptyTransactionsPage");
    expect(keys).toContain("buildTransactionPageInfo");
    expect(keys).toContain("resolveTransactionLimit");
    expect(keys).toContain("resolveTransactionCursor");
  });

  it("does not import prisma client or db module", async () => {
    const src = await import("fs");
    const path = await import("path");
    const servicePath = path.resolve(
      process.cwd(),
      "src/services/transactions/transaction-service.ts",
    );
    const content = src.readFileSync(servicePath, "utf8");
    expect(content).not.toMatch(/@\/lib\/prisma/);
    expect(content).not.toMatch(/from "@prisma\/client"/);
    expect(content).not.toMatch(/prisma\./);
  });

  it("does not reference raw log or raw token transfer tables", async () => {
    const src = await import("fs");
    const path = await import("path");
    const servicePath = path.resolve(
      process.cwd(),
      "src/services/transactions/transaction-service.ts",
    );
    const content = src.readFileSync(servicePath, "utf8");
    expect(content).not.toMatch(/rawLog/i);
    expect(content).not.toMatch(/rawTransaction/i);
    expect(content).not.toMatch(/rawTokenTransfer/i);
    expect(content).not.toMatch(/LedgerActionGroup/);
    expect(content).not.toMatch(/LedgerEntry/);
  });
});

describe("TransactionLedgerCoverageStatus — named union", () => {
  it("supports covered, partial, and unknown", () => {
    const statuses: TransactionLedgerCoverageStatus[] = [
      "covered",
      "partial",
      "unknown",
    ];
    expect(statuses).toContain("covered");
    expect(statuses).toContain("partial");
    expect(statuses).toContain("unknown");
    expect(statuses).toHaveLength(3);
  });
});

describe("buildEmptyTransactionsPage — ledgerCoverage", () => {
  it("defaults to unknown coverage with non-null reason when no ledgerCoverage supplied", () => {
    const page = buildEmptyTransactionsPage({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 50,
    });

    expect(page.ledgerCoverage.status).toBe("unknown");
    expect(typeof page.ledgerCoverage.reason).toBe("string");
    expect(page.ledgerCoverage.reason).not.toBeNull();
    expect((page.ledgerCoverage.reason as string).length).toBeGreaterThan(0);
  });

  it("does not claim covered ledger truth in the skeleton", () => {
    const page = buildEmptyTransactionsPage({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 50,
    });

    expect(page.ledgerCoverage.status).not.toBe("covered");
  });

  it("accepts an explicit covered ledgerCoverage when provided", () => {
    const page = buildEmptyTransactionsPage({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 50,
      ledgerCoverage: { status: "covered", reason: null },
    });

    expect(page.ledgerCoverage.status).toBe("covered");
    expect(page.ledgerCoverage.reason).toBeNull();
  });

  it("accepts an explicit partial ledgerCoverage with a reason", () => {
    const page = buildEmptyTransactionsPage({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 50,
      ledgerCoverage: { status: "partial", reason: "only-transfer-family-queried" },
    });

    expect(page.ledgerCoverage.status).toBe("partial");
    expect(page.ledgerCoverage.reason).toBe("only-transfer-family-queried");
  });

  it("reason is null when status is covered", () => {
    const page = buildEmptyTransactionsPage({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 50,
      ledgerCoverage: { status: "covered", reason: null },
    });

    expect(page.ledgerCoverage.reason).toBeNull();
  });

  it("does not have a ledgerFresh field anywhere in the page", () => {
    const page = buildEmptyTransactionsPage({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      limit: 50,
    });

    expect(page).not.toHaveProperty("ledgerFresh");
    expect(page.ledgerCoverage).not.toHaveProperty("ledgerFresh");
  });
});

describe("listCanonicalTransactions — ledgerCoverage", () => {
  it("returns explicit unknown ledgerCoverage with a reason (skeleton not yet querying ledger)", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.ledgerCoverage).toBeDefined();
    expect(result.ledgerCoverage.status).toBe("unknown");
    expect(result.ledgerCoverage.reason).not.toBeNull();
  });

  it("does not expose ledgerFresh in the response", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result).not.toHaveProperty("ledgerFresh");
    expect(result.ledgerCoverage).not.toHaveProperty("ledgerFresh");
  });

  it("existing envelope fields are unchanged", async () => {
    const result = await listCanonicalTransactions({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });

    expect(result.schemaVersion).toBe("v1");
    expect(result.walletAddress).toBe(WALLET);
    expect(result.chainId).toBe(CHAIN_ID);
    expect(result.transactions).toEqual([]);
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.nextCursor).toBeNull();
  });
});
