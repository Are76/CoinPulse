/**
 * Dashboard presentation of backend pricing.rejectedReasons.
 *
 * PR #351 taught the pricing resolver to reject PulseX-routed observations
 * that carry an unverified pDAI/USD parity assumption
 * (UNVERIFIED_QUOTE_ASSUMPTION). This file proves the Dashboard token table
 * turns that backend-provided reason into a clear, non-fabricated
 * explanation — without ever rendering the raw backend enum, and without
 * coercing the resulting null valuation/PnL into zero.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TokenPositionsTable } from "@/components/dashboard/dashboard-presenters";
import type { DashboardTokenPositionDto } from "@/services/dashboard/types";

function makeTokenPosition(
  overrides: Partial<DashboardTokenPositionDto> = {},
): DashboardTokenPositionDto {
  return {
    assetId: "chain:369:erc20:0x1111111111111111111111111111111111111111",
    assetAddress: "0x1111111111111111111111111111111111111111",
    balanceQuantity: "5",
    decimals: 18,
    metadataProvenance: {
      status: "observed",
      source: "chain",
      observedAt: "2026-05-08T11:59:00.000Z",
      confidence: "medium",
      conflictReason: null,
    },
    updatedFromBlock: null,
    updatedToBlock: null,
    pricing: {
      status: "unavailable",
      sourceType: null,
      sourceId: null,
      confidence: null,
      observedAt: null,
      staleAfterSeconds: null,
      rejectedReasons: [],
    },
    valuation: { status: "unavailable", valueQuote: null },
    pnl: {
      status: "unavailable",
      holdingsQuantity: null,
      averageCost: null,
      realizedPnl: null,
      unrealizedPnl: null,
      markPrice: null,
      totalAcquiredQuantity: null,
      totalDisposedQuantity: null,
      warnings: [],
    },
    ...overrides,
  };
}

describe("TokenPositionsTable pricing rejection presentation", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains an unverified pDAI quote assumption in clear, non-fabricated language", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "unavailable",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("USD price unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The available PulseX route is priced in pDAI. CoinPulse does not currently have independent evidence that pDAI equals USD, so no USD valuation or PnL is shown.",
      ),
    ).toBeInTheDocument();
  });

  it("never renders the raw backend enum value", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "unavailable",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
            },
          }),
        ]}
      />,
    );

    expect(screen.queryByText("UNVERIFIED_QUOTE_ASSUMPTION")).not.toBeInTheDocument();
    expect(screen.queryByText(/UNVERIFIED_QUOTE_ASSUMPTION/)).not.toBeInTheDocument();
  });

  it("does not imply the asset is worthless, pDAI equals USD, or a zero valuation/PnL", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "unavailable",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
            },
          }),
        ]}
      />,
    );

    expect(
      screen.queryByText(/worthless|no market value|depegged|equals \$1|zero value/i),
    ).not.toBeInTheDocument();
    // Valuation stays the explicit "unavailable" status, never a rendered "0".
    expect(screen.queryByText(/^\$?0(\.0+)?$/)).not.toBeInTheDocument();
  });

  it("leaves existing pricing.status: unavailable behavior intact when no reasons are present", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "unavailable",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: [],
            },
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("USD price unavailable")).not.toBeInTheDocument();
  });

  it("does not show the pDAI explanation for a position without that rejection reason", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "stale_price",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: ["STALE"],
            },
          }),
        ]}
      />,
    );

    expect(screen.queryByText("USD price unavailable")).not.toBeInTheDocument();
    // STALE has no reviewed explanation yet, so existing raw-reason warning
    // behavior is preserved rather than removed silently.
    expect(screen.getByText("STALE")).toBeInTheDocument();
  });

  it("fails safely for an unknown future rejection reason without fabricating pDAI-specific copy", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "unavailable",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: ["SOME_FUTURE_REASON"],
            },
          }),
        ]}
      />,
    );

    expect(screen.queryByText("USD price unavailable")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/pDAI/i),
    ).not.toBeInTheDocument();
    // Falls back to the existing generic unavailable presentation.
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
  });

  it("keeps null valuation and PnL distinct from zero when unverified quote assumption applies", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "unavailable",
              sourceType: null,
              sourceId: null,
              confidence: null,
              observedAt: null,
              staleAfterSeconds: null,
              rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
            },
            valuation: { status: "unavailable", valueQuote: null },
            pnl: {
              status: "unavailable",
              holdingsQuantity: "5",
              averageCost: null,
              realizedPnl: null,
              unrealizedPnl: null,
              markPrice: null,
              totalAcquiredQuantity: null,
              totalDisposedQuantity: null,
              warnings: [],
            },
          }),
        ]}
      />,
    );

    // Two "unavailable" badges: one for valuation, one for pricing/pnl status text.
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
