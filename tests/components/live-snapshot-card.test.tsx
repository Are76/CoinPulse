import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LiveSnapshotCard } from "@/components/dashboard/live-snapshot-card";
import type { LiveHoldingsSnapshotDto } from "@/services/portfolio/live-snapshot-types";

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
      assetId: "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      symbol: "PLS",
      decimals: 18,
      balanceQuantity: "1000000000000000000",
      priceStatus: "priced",
      valueQuote: "0.50",
    },
    {
      assetId: "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      symbol: null,
      decimals: 18,
      balanceQuantity: "500000000000000000",
      priceStatus: "unpriced",
      valueQuote: null,
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

    expect(
      screen.getByText(/Live snapshot as of block 12345678\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only assets already known to CoinPulse are included in this live snapshot\./),
    ).toBeInTheDocument();
  });

  it("renders a priced asset with its symbol and quote value", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    const listItem = screen.getByText(/PLS: 1000000000000000000 raw units/);
    expect(listItem).toBeInTheDocument();
    expect(listItem).toHaveTextContent("0.50 fiat:usd");
  });

  it("falls back to assetId and shows price unavailable for an unpriced asset with no symbol", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(
      screen.getByText(
        /chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: 500000000000000000 raw units/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/price unavailable/)).toBeInTheDocument();
  });

  it("renders the partial total value", () => {
    render(<LiveSnapshotCard snapshot={SNAPSHOT} />);

    expect(screen.getByText(/Total \(partial\): 0.50 fiat:usd/)).toBeInTheDocument();
  });
});
