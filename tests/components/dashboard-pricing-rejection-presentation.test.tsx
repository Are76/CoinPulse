/**
 * Dashboard presentation of backend pricing.rejectedReasons.
 *
 * PR #351 taught the pricing resolver to reject pDAI-based observations
 * that carry an unverified pDAI/USD parity assumption
 * (UNVERIFIED_QUOTE_ASSUMPTION). This file proves the Dashboard token table
 * turns that backend-provided reason into a clear, non-fabricated
 * explanation — only when the backend itself reports pricing as
 * unavailable, never rendering the raw backend enum, and never coercing the
 * resulting null valuation/PnL into zero.
 *
 * The resolver can also reject a pDAI-based candidate while still selecting
 * a different, independently verified observation (pricing.status stays
 * "available" with the reason retained in rejectedReasons for provenance).
 * The explanation must never appear in that case — it would contradict the
 * accepted, displayed price.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TokenPositionsTable } from "@/components/dashboard/dashboard-presenters";
import type { DashboardTokenPositionDto } from "@/services/dashboard/types";

const EXPLANATION_TITLE = "USD price unavailable";
const EXPLANATION_MESSAGE =
  "A pDAI-based observation was rejected because CoinPulse does not have independent evidence that pDAI equals USD. Current USD valuation and unrealized PnL are therefore unavailable.";

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

  it("explains an unverified pDAI quote assumption in clear, non-fabricated language when pricing is unavailable", () => {
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

    expect(screen.getByText(EXPLANATION_TITLE)).toBeInTheDocument();
    expect(screen.getByText(EXPLANATION_MESSAGE)).toBeInTheDocument();
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

  it("does not claim an available route exists, that all PnL is unavailable, or that pDAI equals USD", () => {
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
      screen.queryByText(/worthless|no market value|depegged|equals \$1|zero value|available pulsex route|available route/i),
    ).not.toBeInTheDocument();
    // The copy scopes the claim to current valuation and unrealized PnL —
    // it must not say realized PnL, or PnL as a whole, is unavailable.
    expect(screen.queryByText(/realized pnl is unavailable|no pnl is shown|no usd valuation or pnl/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
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

    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
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

    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(/pDAI/i)).not.toBeInTheDocument();
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

  it("does not show the explanation when a valid USD price was selected despite a rejected pDAI candidate", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "available",
              sourceType: "ORACLE",
              sourceId: "manual:verified-fiat-usd",
              confidence: "high",
              observedAt: "2026-07-31T12:00:00.000Z",
              staleAfterSeconds: 300,
              rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION"],
            },
            valuation: { status: "available", valueQuote: "42.50" },
          }),
        ]}
      />,
    );

    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(/pDAI/i)).not.toBeInTheDocument();
    expect(screen.queryByText("UNVERIFIED_QUOTE_ASSUMPTION")).not.toBeInTheDocument();
    // The accepted price/valuation is not hidden or altered.
    expect(screen.getByText("42.50")).toBeInTheDocument();
    expect(screen.getAllByText("available").length).toBeGreaterThan(0);
  });

  it("presents the pDAI explanation exactly once and preserves the raw STALE warning for mixed rejection reasons", () => {
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
              rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION", "STALE"],
            },
          }),
        ]}
      />,
    );

    expect(screen.getAllByText(EXPLANATION_TITLE)).toHaveLength(1);
    expect(screen.getAllByText(EXPLANATION_MESSAGE)).toHaveLength(1);
    expect(screen.getByText("STALE")).toBeInTheDocument();
    expect(screen.queryByText("UNVERIFIED_QUOTE_ASSUMPTION")).not.toBeInTheDocument();
  });

  it("does not present the pDAI explanation for mixed rejection reasons when the backend reports an available price", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            pricing: {
              status: "available",
              sourceType: "ORACLE",
              sourceId: "manual:verified-fiat-usd",
              confidence: "high",
              observedAt: "2026-07-31T12:00:00.000Z",
              staleAfterSeconds: 300,
              rejectedReasons: ["UNVERIFIED_QUOTE_ASSUMPTION", "STALE"],
            },
            valuation: { status: "available", valueQuote: "10" },
          }),
        ]}
      />,
    );

    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });
});
