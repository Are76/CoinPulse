import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/transactions/transaction-history-screen.tsx",
);

const PAGE_PATH = path.resolve(
  __dirname,
  "../../src/app/transactions/page.tsx",
);

function readScreen() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

function readPage() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

// ── Query disabled before explicit submit ────────────────────────────────────

describe("TransactionHistoryScreen — query disabled before explicit submit", () => {
  it("submittedParams starts as null (query initially disabled)", () => {
    const source = readScreen();
    expect(source).toContain("useState<SubmittedParams | null>(null)");
  });

  it("transactionsQuery is enabled only when submittedParams is non-null", () => {
    const source = readScreen();
    expect(source).toContain("enabled: submittedParams !== null");
  });

  it("screen does not call fetch() directly", () => {
    const source = readScreen();
    expect(source).not.toContain("fetch(");
  });

  it("screen does not use useEffect for data fetching", () => {
    const source = readScreen();
    expect(source).not.toContain("useEffect");
  });
});

// ── Clicking Load transactions enables the query ─────────────────────────────

describe("TransactionHistoryScreen — submit enables query with correct params", () => {
  it("handleSubmit sets submittedParams to enable the transactions query", () => {
    const source = readScreen();
    expect(source).toContain("setSubmittedParams(params)");
  });

  it("handleSubmit calls event.preventDefault()", () => {
    const source = readScreen();
    expect(source).toContain("event.preventDefault()");
  });

  it("handleSubmit resets submittedParams to null on validation error", () => {
    const source = readScreen();
    expect(source).toContain("setSubmittedParams(null)");
  });

  it("button label shows 'Load transactions'", () => {
    const source = readScreen();
    expect(source).toContain("Load transactions");
  });

  it("button label shows 'Loading...' while fetching", () => {
    const source = readScreen();
    expect(source).toContain("Loading...");
  });
});

// ── Wallet/chain input wired to query hook ───────────────────────────────────

describe("TransactionHistoryScreen — wallet and chain passed to useTransactionsQuery", () => {
  it("screen imports useTransactionsQuery from the shared hook", () => {
    const source = readScreen();
    expect(source).toContain(
      'import { useTransactionsQuery } from "@/lib/query/use-transactions-query"',
    );
  });

  it("walletAddress state is wired into useTransactionsQuery", () => {
    const source = readScreen();
    expect(source).toContain("walletAddress: submittedParams?.walletAddress");
  });

  it("chainId state is wired into useTransactionsQuery", () => {
    const source = readScreen();
    expect(source).toContain("chainId: submittedParams?.chainId");
  });

  it("limit state is wired into useTransactionsQuery", () => {
    const source = readScreen();
    expect(source).toContain("limit: submittedParams?.limit");
  });

  it("walletAddress input has an onChange handler", () => {
    const source = readScreen();
    expect(source).toContain("setWalletAddress");
  });

  it("chainId input has an onChange handler", () => {
    const source = readScreen();
    expect(source).toContain("setChainId");
  });

  it("default chainId is 369", () => {
    const source = readScreen();
    expect(source).toContain('DEFAULT_CHAIN_ID = "369"');
  });
});

// ── Empty DTO renders empty state ────────────────────────────────────────────

describe("TransactionHistoryScreen — empty DTO renders empty state", () => {
  it("renders EmptyState when transactions array is empty", () => {
    const source = readScreen();
    expect(source).toContain("No transactions");
    expect(source).toContain("No canonical transaction entries");
  });

  it("renders idle EmptyState before first submit", () => {
    const source = readScreen();
    expect(source).toContain("No query submitted");
  });
});

// ── Backend DTO fields passed through ────────────────────────────────────────

describe("TransactionHistoryScreen — renders backend DTO fields pass-through", () => {
  it("renders tx.txHash", () => {
    const source = readScreen();
    expect(source).toContain("tx.txHash");
  });

  it("renders tx.occurredAt via TimestampLabel", () => {
    const source = readScreen();
    expect(source).toContain("tx.occurredAt");
    expect(source).toContain("TimestampLabel");
  });

  it("renders tx.actionType", () => {
    const source = readScreen();
    expect(source).toContain("tx.actionType");
  });

  it("renders tx.status", () => {
    const source = readScreen();
    expect(source).toContain("tx.status");
  });

  it("renders tx.warnings", () => {
    const source = readScreen();
    expect(source).toContain("tx.warnings");
  });

  it("renders entry.assetId", () => {
    const source = readScreen();
    expect(source).toContain("entry.assetId");
  });

  it("renders entry.assetAddress", () => {
    const source = readScreen();
    expect(source).toContain("entry.assetAddress");
  });

  it("renders entry.direction", () => {
    const source = readScreen();
    expect(source).toContain("entry.direction");
  });

  it("renders entry.quantity", () => {
    const source = readScreen();
    expect(source).toContain("entry.quantity");
  });

  it("renders entry.pricingStatus", () => {
    const source = readScreen();
    expect(source).toContain("entry.pricingStatus");
  });

  it("renders entry.valuationStatus", () => {
    const source = readScreen();
    expect(source).toContain("entry.valuationStatus");
  });

  it("renders entry.rejectedReason when present", () => {
    const source = readScreen();
    expect(source).toContain("entry.rejectedReason");
    expect(source).toContain("Rejected:");
  });

  it("renders entry.warnings", () => {
    const source = readScreen();
    expect(source).toContain("entry.warnings");
  });
});

// ── Ledger coverage rendered ─────────────────────────────────────────────────

describe("TransactionHistoryScreen — ledger coverage status visible", () => {
  it("renders page.ledgerCoverage", () => {
    const source = readScreen();
    expect(source).toContain("page.ledgerCoverage");
  });

  it("renders coverage.status", () => {
    const source = readScreen();
    expect(source).toContain("coverage.status");
  });

  it("renders coverage.reason when present", () => {
    const source = readScreen();
    expect(source).toContain("coverage.reason");
    expect(source).toContain("Reason:");
  });

  it("LedgerCoveragePanel uses covered status as fresh tone", () => {
    const source = readScreen();
    expect(source).toContain('"covered"');
    expect(source).toContain('"fresh"');
  });

  it("LedgerCoveragePanel uses partial status as warn tone", () => {
    const source = readScreen();
    expect(source).toContain('"partial"');
    expect(source).toContain('"warn"');
  });
});

// ── Stale results hidden during error ────────────────────────────────────────

describe("TransactionHistoryScreen — stale results not shown during error", () => {
  it("TransactionResultView render condition requires errorMessage === null", () => {
    const source = readScreen();
    // Guard: results must not render when there is an active error message
    expect(source).toContain("transactionsQuery.data !== undefined && errorMessage === null");
  });
});

// ── Errors are visible ───────────────────────────────────────────────────────

describe("TransactionHistoryScreen — errors are visible", () => {
  it("renders ErrorState when transactionsQuery.isError is true", () => {
    const source = readScreen();
    expect(source).toContain("transactionsQuery.isError");
    expect(source).toContain("getErrorMessage");
  });

  it("renders validation error message", () => {
    const source = readScreen();
    expect(source).toContain("validationError");
    expect(source).toContain("errorMessage");
  });

  it("handles ApiClientError with code and message", () => {
    const source = readScreen();
    expect(source).toContain("ApiClientError");
    expect(source).toContain("error.code");
    expect(source).toContain("error.message");
  });
});

// ── No raw log / RPC imports ─────────────────────────────────────────────────

describe("TransactionHistoryScreen — no raw log or RPC imports", () => {
  it("does not import from rawLog, rawTransaction, or rawTokenTransfer", () => {
    const source = readScreen();
    expect(source).not.toContain("rawLog");
    expect(source).not.toContain("rawTransaction");
    expect(source).not.toContain("rawTokenTransfer");
  });

  it("does not reference PULSECHAIN_RPC_URL", () => {
    const source = readScreen();
    expect(source).not.toContain("PULSECHAIN_RPC_URL");
  });

  it("does not use createPublicClient or viem RPC helpers", () => {
    const source = readScreen();
    expect(source).not.toContain("createPublicClient");
    expect(source).not.toContain("http(");
  });

  it("does not import from @/services/pricing or @/services/pnl", () => {
    const source = readScreen();
    expect(source).not.toContain("@/services/pricing");
    expect(source).not.toContain("@/services/pnl");
  });
});

// ── No frontend pricing/PnL/accounting computation ───────────────────────────

describe("TransactionHistoryScreen — no frontend pricing or PnL computation", () => {
  it("does not use parseFloat for value computation", () => {
    const source = readScreen();
    expect(source).not.toContain("parseFloat");
  });

  it("does not use reduce for aggregation", () => {
    const source = readScreen();
    expect(source).not.toContain(".reduce(");
  });

  it("does not compute pnl locally", () => {
    const source = readScreen();
    expect(source).not.toContain("pnl =");
    expect(source).not.toContain("pnl +=");
  });

  it("does not compute balance or price locally", () => {
    const source = readScreen();
    expect(source).not.toContain("balance *");
    expect(source).not.toContain("price *");
  });

  it("does not call toFixed for value formatting", () => {
    const source = readScreen();
    expect(source).not.toContain(".toFixed(");
  });

  it("does not use DexScreener, CoinGecko, or external price APIs", () => {
    const source = readScreen();
    expect(source).not.toContain("DexScreener");
    expect(source).not.toContain("CoinGecko");
    expect(source).not.toContain("GeckoTerminal");
  });
});

// ── Page wiring ──────────────────────────────────────────────────────────────

describe("transactions page — wiring", () => {
  it("page imports TransactionHistoryScreen", () => {
    const source = readPage();
    expect(source).toContain("TransactionHistoryScreen");
    expect(source).toContain(
      'import { TransactionHistoryScreen } from "@/components/transactions/transaction-history-screen"',
    );
  });

  it("page renders TransactionHistoryScreen as the sole root component", () => {
    const source = readPage();
    expect(source).toContain("<TransactionHistoryScreen />");
  });

  it("page does not import useTransactionsQuery directly", () => {
    const source = readPage();
    expect(source).not.toContain("useTransactionsQuery");
  });
});
