import { cleanup, render, screen, within } from "@testing-library/react";
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

describe("TokenPositionsTable metadata provenance", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders backend-provided token metadata provenance on token rows", () => {
    render(<TokenPositionsTable positions={[makeTokenPosition()]} />);

    expect(screen.getByText("Observed metadata")).toBeInTheDocument();
    expect(screen.getByText("Metadata observed from RPC")).toBeInTheDocument();
    expect(screen.getByText("Metadata confidence: medium")).toBeInTheDocument();
    expect(screen.getByText(/metadata observed 08 May 2026, 11:59/i)).toBeInTheDocument();
  });

  it("renders unknown provenance neutrally and without synthesized warning language", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            metadataProvenance: {
              status: "unknown",
              source: "unknown",
              observedAt: null,
              confidence: "unknown",
              conflictReason: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Metadata status unknown")).toBeInTheDocument();
    expect(screen.getByText("Metadata source unknown")).toBeInTheDocument();
    expect(screen.getByText("Metadata confidence: unknown")).toBeInTheDocument();
    expect(screen.getByText(/metadata observed Metadata observation unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/risk|scam|safe token|trusted asset|official token/i)).not.toBeInTheDocument();
  });

  it("does not infer provenance when the backend reports unknown metadata for a priced token", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            metadataProvenance: {
              status: "unknown",
              source: "unknown",
              observedAt: null,
              confidence: "unknown",
              conflictReason: null,
            },
            pricing: {
              status: "available",
              sourceType: "DEXSCREENER",
              sourceId: "dexscreener:pulsechain:0xpair",
              confidence: "high",
              observedAt: "2026-05-08T12:00:00.000Z",
              staleAfterSeconds: 300,
              rejectedReasons: [],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Metadata status unknown")).toBeInTheDocument();
    expect(screen.getByText("Metadata source unknown")).toBeInTheDocument();
    expect(screen.queryByText("Observed metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("Metadata confidence: high")).not.toBeInTheDocument();
    expect(screen.getAllByText("available")).toHaveLength(2);
  });

  it("continues to render token identity from asset fields rather than metadata provenance", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
            assetAddress: null,
            metadataProvenance: {
              status: "observed",
              source: "manual",
              observedAt: "2026-05-08T11:59:00.000Z",
              confidence: "high",
              conflictReason: "operator note only",
            },
          }),
        ]}
      />,
    );

    const row = screen.getByRole("row", {
      name: /chain:369:erc20:0x2222222222222222222222222222222222222222/i,
    });
    expect(within(row).getByText("chain:369:erc20:0x2222222222222222222222222222222222222222")).toBeInTheDocument();
    expect(within(row).getByText("Metadata source: manual")).toBeInTheDocument();
    expect(within(row).getByText("Metadata conflict: operator note only")).toBeInTheDocument();
  });
});
