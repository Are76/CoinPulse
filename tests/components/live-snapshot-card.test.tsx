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

  it("renders the observed block and coverage note", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByText(/observed directly from PulseChain by the backend at block/)).toBeInTheDocument();
    expect(screen.getByText(/12345678/)).toBeInTheDocument();
    expect(
      screen.getByText(/Only assets already known to CoinPulse are included in this live snapshot\./),
    ).toBeInTheDocument();
  });

  it("states this is not historical PnL, cost basis, or accounting truth", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(
      screen.getByText(/not historical PnL, cost basis, or accounting truth/),
    ).toBeInTheDocument();
  });

  it("renders a priced native PLS asset with its symbol, quote value, and price provenance", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    const listItem = screen.getByText(/PLS: 1000000000000000000 raw units/);
    expect(listItem).toBeInTheDocument();
    const row = listItem.closest("li");
    expect(row).toHaveTextContent("0.50 fiat:usd");
    expect(row).toHaveTextContent("source: PULSEX_ONCHAIN");
    expect(row).toHaveTextContent("confidence: 0.9");
  });

  it("falls back to assetId and shows price unavailable for an unpriced asset with no symbol", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    const listItem = screen.getByText(new RegExp(`${TOKEN_ASSET_ID}: 500000000000000000 raw units`));
    expect(listItem).toBeInTheDocument();
    expect(listItem.closest("li")).toHaveTextContent("price unavailable");
  });

  it("renders the partial total value with its valuation status", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByText(/Estimated total \(partial\): 0.50 fiat:usd/)).toBeInTheDocument();
  });

  it("renders an explicit empty state when the snapshot has zero assets", () => {
    render(<LiveSnapshotCard snapshot={{ ...SNAPSHOT, assets: [], totalValueQuote: null, valuationStatus: "unavailable" }} />);

    expect(screen.getByText("No known balances found")).toBeInTheDocument();
    expect(screen.queryByText(/PLS: /)).not.toBeInTheDocument();
  });

  it("surfaces backend warnings so a failed read is not confused with a confirmed zero balance", () => {
    render(
      <LiveSnapshotCard
        snapshot={{
          ...SNAPSHOT,
          warnings: [`balance-read-failed:${TOKEN_ASSET_ID}`],
        }}
      />,
    );

    expect(screen.getByText("Coverage warnings")).toBeInTheDocument();
    expect(screen.getByText(`balance-read-failed:${TOKEN_ASSET_ID}`)).toBeInTheDocument();
  });

  it("does not render a warnings banner when there are no warnings", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.queryByText("Coverage warnings")).not.toBeInTheDocument();
  });
});
