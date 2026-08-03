import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LiveSnapshotCard } from "@/components/dashboard/live-snapshot-card";
import type { LiveHoldingsSnapshotDto } from "@/services/portfolio/live-snapshot-types";

const NATIVE_ASSET_ID = "chain:369:native:0x0000000000000000000000000000000000000000";
const TOKEN_ASSET_ID = "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const UNPRICED_PROVENANCE = {
  sourceType: null,
  sourceId: null,
  confidence: null,
  observedAt: null,
  observedBlock: null,
  staleAfterSeconds: null,
  rejectedReasons: [] as string[],
};

const SNAPSHOT: LiveHoldingsSnapshotDto = {
  schemaVersion: "v1",
  wallet: { address: "0x1111111111111111111111111111111111111111", chainId: 369 },
  quoteAsset: "fiat:usd",
  asOf: "2026-08-03T12:00:00.000Z",
  sourceType: "LIVE_RPC_SNAPSHOT",
  observedBlock: "12345678",
  coverage: "known_assets_only",
  coverageNote: "Only assets already known to CoinPulse are included in this live snapshot.",
  pnlStatus: "unsupported",
  assets: [
    {
      // Native PLS: matches assembleLiveHoldingsSnapshot's real output shape
      // — `chain:369:native:0x0...` assetId, `assetAddress: null` (never a
      // real contract address). Must not be represented as an ERC-20.
      assetId: NATIVE_ASSET_ID,
      assetAddress: null,
      symbol: "PLS",
      decimals: 18,
      balanceQuantity: "1000000000000000000",
      priceStatus: "priced",
      valueQuote: "0.50",
      pricing: {
        sourceType: "PULSEX_ONCHAIN",
        sourceId: "pulsex:pulsex_v2:route:wpls-pdai",
        confidence: "0.9",
        observedAt: "2026-08-03T11:59:00.000Z",
        observedBlock: "12345670",
        staleAfterSeconds: 300,
        rejectedReasons: [],
      },
    },
    {
      assetId: TOKEN_ASSET_ID,
      assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      symbol: null,
      decimals: 18,
      balanceQuantity: "500000000000000000",
      priceStatus: "unpriced",
      valueQuote: null,
      pricing: UNPRICED_PROVENANCE,
    },
  ],
  totalValueQuote: "0.50",
  valuationStatus: "partial",
  warnings: [],
};

describe("LiveSnapshotCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Live Portfolio header with a live indicator and known-assets-only coverage chip", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByRole("heading", { name: "Live Portfolio" })).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Known assets only")).toBeInTheDocument();
  });

  it("renders wallet context, observed block, and observed time in the header", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByText(/Wallet 0x1111…1111 · chain 369/)).toBeInTheDocument();
    expect(screen.getByText(/Observed block 12345678/)).toBeInTheDocument();
    expect(screen.getByText(/Source: backend live RPC snapshot/)).toBeInTheDocument();
  });

  it("renders the coverage notice from the backend and states this is not historical PnL, cost basis, or accounting truth", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(
      screen.getByText(/Only assets already known to CoinPulse are included in this live snapshot\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Historical sync, cost basis, and\s*PnL are separate/),
    ).toBeInTheDocument();
  });

  it("states that liquidity, farming, lending, and other DeFi positions are not yet included in Live Portfolio V1, without implying they are permanently out of scope", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(
      screen.getByText(
        /Liquidity, farming, lending, and\s*other DeFi positions are not included in this Live Portfolio V1 snapshot yet\. They are planned as\s*separate backend-supported portfolio sections\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders backend-provided summary values without frontend calculation", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText("1 priced / 1 unpriced (2 total)")).toBeInTheDocument();
    expect(screen.getAllByText("fiat:usd").length).toBeGreaterThan(0);
  });

  it("renders a priced native PLS asset with its symbol, quote value, and price provenance, without a confidence display", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByText("PLS")).toBeInTheDocument();
    expect(screen.getByText(/Balance 1000000000000000000 raw units \(18 decimals\)/)).toBeInTheDocument();
    expect(screen.getByText(/≈ fiat:usd 0\.50/)).toBeInTheDocument();
    expect(screen.getByText(/Source PULSEX_ONCHAIN/)).toBeInTheDocument();
    expect(screen.getByText(/Priced at block 12345670/)).toBeInTheDocument();
    // `confidence` is not an Atlas-approved user-facing display concept
    // (docs/design/atlas-design-system-v1.md, Restricted decisions).
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
  });

  it("falls back to a truncated address and shows price unavailable for an unpriced asset with no symbol", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByText("0xbbbb…bbbb")).toBeInTheDocument();
    expect(screen.getByText("Price unavailable")).toBeInTheDocument();
  });

  it("renders the partial total value with its valuation status", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    // "0.50" appears twice: once for the summary total, once for the priced
    // PLS asset row — both are backend-provided values, not duplicates of a
    // frontend calculation.
    expect(screen.getAllByText(/fiat:usd 0\.50/).length).toBe(2);
    expect(screen.getByText("partial")).toBeInTheDocument();
  });

  it("renders an explicit empty state when the snapshot has zero assets, without implying the wallet is globally empty", () => {
    render(
      <LiveSnapshotCard
        snapshot={{ ...SNAPSHOT, assets: [], totalValueQuote: null, valuationStatus: "unavailable" }}
      />,
    );

    expect(screen.getByText("No known balances found")).toBeInTheDocument();
    expect(screen.getByText(/does not confirm the wallet holds nothing/)).toBeInTheDocument();
    expect(screen.queryByText("PLS")).not.toBeInTheDocument();
  });

  it("groups failed balance reads separately from other coverage warnings", () => {
    render(
      <LiveSnapshotCard
        snapshot={{
          ...SNAPSHOT,
          warnings: [`balance-read-failed:${TOKEN_ASSET_ID}`, "some-other-warning"],
        }}
      />,
    );

    expect(screen.getByText("Balances that could not be read")).toBeInTheDocument();
    expect(screen.getByText(`balance-read-failed:${TOKEN_ASSET_ID}`)).toBeInTheDocument();
    expect(screen.getByText("Other coverage warnings")).toBeInTheDocument();
    expect(screen.getByText("some-other-warning")).toBeInTheDocument();
  });

  it("does not render a warnings banner when there are no warnings", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.queryByText("Balances that could not be read")).not.toBeInTheDocument();
    expect(screen.queryByText("Other coverage warnings")).not.toBeInTheDocument();
  });
});
