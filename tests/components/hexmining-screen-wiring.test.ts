import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/hexmining/hexmining-screen.tsx",
);

const PAGE_PATH = path.resolve(
  __dirname,
  "../../src/app/hexmining/page.tsx",
);

function readScreen() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

function readPage() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

// ── Client boundary ───────────────────────────────────────────────────────────

describe("HexMiningScreen — client boundary", () => {
  it("declares use client directive", () => {
    const source = readScreen();
    expect(source).toContain('"use client"');
  });
});

// ── Query disabled before explicit submit ────────────────────────────────────

describe("HexMiningScreen — query disabled before explicit submit", () => {
  it("submittedParams starts as null (query initially disabled)", () => {
    const source = readScreen();
    expect(source).toContain("useState<SubmittedParams | null>(null)");
  });

  it("stakesQuery is enabled only when submittedParams is non-null", () => {
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

// ── Submit wires params into query hook ──────────────────────────────────────

describe("HexMiningScreen — submit enables query with correct params", () => {
  it("handleSubmit calls event.preventDefault()", () => {
    const source = readScreen();
    expect(source).toContain("event.preventDefault()");
  });

  it("handleSubmit resets submittedParams to null on validation error", () => {
    const source = readScreen();
    expect(source).toContain("setSubmittedParams(null)");
  });

  it("button label shows 'Load stakes'", () => {
    const source = readScreen();
    expect(source).toContain("Load stakes");
  });

  it("button label shows 'Loading…' while fetching", () => {
    const source = readScreen();
    expect(source).toContain("Loading…");
  });
});

// ── Query hook wired correctly ────────────────────────────────────────────────

describe("HexMiningScreen — wallet and chain passed to useHexMiningStakesQuery", () => {
  it("screen imports useHexMiningStakesQuery from the shared hook", () => {
    const source = readScreen();
    expect(source).toContain(
      'import { useHexMiningStakesQuery } from "@/lib/query/use-hexmining-stakes-query"',
    );
  });

  it("walletAddress is wired into useHexMiningStakesQuery from submittedParams", () => {
    const source = readScreen();
    expect(source).toContain("walletAddress: submittedParams?.walletAddress");
  });

  it("chainId is wired into useHexMiningStakesQuery from submittedParams", () => {
    const source = readScreen();
    expect(source).toContain("chainId: submittedParams?.chainId");
  });

  it("walletAddress input has an onChange handler", () => {
    const source = readScreen();
    expect(source).toContain("setWalletAddress");
  });

  it("chainId is fixed to 369 (PULSECHAIN_CHAIN_ID)", () => {
    const source = readScreen();
    expect(source).toContain("PULSECHAIN_CHAIN_ID = 369");
  });
});

// ── State messages in source ─────────────────────────────────────────────────

describe("HexMiningScreen — state messages in source", () => {
  it("renders idle EmptyState before first submit with 'No wallet selected'", () => {
    const source = readScreen();
    expect(source).toContain("No wallet selected");
  });

  it("renders EmptyState for no active native pHEX stakes", () => {
    const source = readScreen();
    expect(source).toContain("No active native pHEX stakes found");
  });
});

// ── Backend DTO fields passed through ────────────────────────────────────────

describe("HexMiningScreen — renders backend DTO fields pass-through", () => {
  it("renders stake.stakeId", () => {
    const source = readScreen();
    expect(source).toContain("stake.stakeId");
  });

  it("renders stake.stakeStatus via ProvenanceChip", () => {
    const source = readScreen();
    expect(source).toContain("stake.stakeStatus");
  });

  it("renders stake.principalHex", () => {
    const source = readScreen();
    expect(source).toContain("stake.principalHex");
  });

  it("renders stake.tShares", () => {
    const source = readScreen();
    expect(source).toContain("stake.tShares");
  });

  it("renders stake.warnings", () => {
    const source = readScreen();
    expect(source).toContain("stake.warnings");
  });

  it("renders stake.provenance.observedAtBlock", () => {
    const source = readScreen();
    expect(source).toContain("stake.provenance.observedAtBlock");
  });

  it("renders yield.status as an unsupported field indicator", () => {
    const source = readScreen();
    expect(source).toContain("stake.yield.status");
  });

  it("renders pricing.status as an unsupported field indicator", () => {
    const source = readScreen();
    expect(source).toContain("stake.pricing.status");
  });

  it("renders pnl.status as an unsupported field indicator", () => {
    const source = readScreen();
    expect(source).toContain("stake.pnl.status");
  });

  it("renders list.isComplete for partial-read warning", () => {
    const source = readScreen();
    expect(source).toContain("list.isComplete");
  });
});

// ── Stale results hidden during error ────────────────────────────────────────

describe("HexMiningScreen — stale results not shown during error", () => {
  it("StakeResultView render condition requires errorMessage === null", () => {
    const source = readScreen();
    expect(source).toContain("stakesQuery.data !== undefined && errorMessage === null");
  });
});

// ── Errors are visible ───────────────────────────────────────────────────────

describe("HexMiningScreen — errors are visible", () => {
  it("renders ErrorState when stakesQuery.isError is true", () => {
    const source = readScreen();
    expect(source).toContain("stakesQuery.isError");
    expect(source).toContain("getErrorMessage");
  });

  it("handles ApiClientError with code and message", () => {
    const source = readScreen();
    expect(source).toContain("ApiClientError");
    expect(source).toContain("error.code");
    expect(source).toContain("error.message");
  });
});

// ── No raw log / RPC imports ─────────────────────────────────────────────────

describe("HexMiningScreen — no raw log or RPC imports", () => {
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

describe("HexMiningScreen — no frontend pricing or PnL computation", () => {
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

  it("does not use DexScreener, CoinGecko, or external price APIs", () => {
    const source = readScreen();
    expect(source).not.toContain("DexScreener");
    expect(source).not.toContain("CoinGecko");
    expect(source).not.toContain("GeckoTerminal");
  });
});

// ── Page wiring ──────────────────────────────────────────────────────────────

describe("hexmining page — wiring", () => {
  it("page imports HexMiningScreen", () => {
    const source = readPage();
    expect(source).toContain("HexMiningScreen");
    expect(source).toContain(
      'import { HexMiningScreen } from "@/components/hexmining/hexmining-screen"',
    );
  });

  it("page renders HexMiningScreen as the sole root component", () => {
    const source = readPage();
    expect(source).toContain("<HexMiningScreen />");
  });

  it("page does not import useHexMiningStakesQuery directly", () => {
    const source = readPage();
    expect(source).not.toContain("useHexMiningStakesQuery");
  });
});
