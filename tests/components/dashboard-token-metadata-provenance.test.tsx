import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    vi.restoreAllMocks();
  });

  it("renders backend-provided token metadata provenance on token rows", () => {
    const formatTimestamp = vi
      .spyOn(Date.prototype, "toLocaleString")
      .mockReturnValue("backend observed timestamp");

    render(<TokenPositionsTable positions={[makeTokenPosition()]} />);

    expect(screen.getByText("Observed metadata")).toBeInTheDocument();
    expect(screen.getByText("Metadata observed from RPC")).toBeInTheDocument();
    expect(screen.getByText("Metadata confidence: medium")).toBeInTheDocument();
    expect(screen.getByText("metadata observed backend observed timestamp")).toBeInTheDocument();
    expect(formatTimestamp).toHaveBeenCalledWith(
      "en-GB",
      expect.objectContaining({
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        year: "numeric",
      }),
    );
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

  it("renders explicit backend metadata statuses without resolving them in the frontend", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            assetId: "chain:369:erc20:0x3333333333333333333333333333333333333333",
            assetAddress: "0x3333333333333333333333333333333333333333",
            metadataProvenance: {
              status: "verified",
              source: "manual",
              observedAt: "2026-05-08T11:59:00.000Z",
              confidence: "high",
              conflictReason: null,
            },
          }),
          makeTokenPosition({
            assetId: "chain:369:erc20:0x4444444444444444444444444444444444444444",
            assetAddress: "0x4444444444444444444444444444444444444444",
            metadataProvenance: {
              status: "conflicting",
              source: "scanner",
              observedAt: "2026-05-08T11:58:00.000Z",
              confidence: "low",
              conflictReason: "backend conflict fixture",
            },
          }),
          makeTokenPosition({
            assetId: "chain:369:erc20:0x5555555555555555555555555555555555555555",
            assetAddress: "0x5555555555555555555555555555555555555555",
            metadataProvenance: {
              status: "stale",
              source: "derived",
              observedAt: "2026-05-01T11:59:00.000Z",
              confidence: "medium",
              conflictReason: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Metadata status: verified")).toBeInTheDocument();
    expect(screen.getByText("Metadata status: conflicting")).toBeInTheDocument();
    expect(screen.getByText("Metadata conflict: backend conflict fixture")).toBeInTheDocument();
    expect(screen.getByText("Metadata status: stale")).toBeInTheDocument();
    expect(screen.queryByText("Metadata status provided")).not.toBeInTheDocument();
  });

  it("does not derive peg, origin, bridge, or trust labels from stablecoin-like asset identity", () => {
    render(
      <TokenPositionsTable
        positions={[
          makeTokenPosition({
            assetId: "chain:369:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            assetAddress: null,
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

    // Current dashboard token DTOs do not carry symbol/name fields, so this
    // stablecoin-like fixture uses an assetId associated with common USDC examples.
    expect(screen.getByText("chain:369:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toBeInTheDocument();
    expect(screen.getByText("Metadata status unknown")).toBeInTheDocument();
    expect(screen.getByText("Metadata source unknown")).toBeInTheDocument();
    expect(screen.getByText("Metadata confidence: unknown")).toBeInTheDocument();
    expect(
      screen.queryByText(/peg|stablecoin|verified|native|bridged|wrapped|canonical|trusted/i),
    ).not.toBeInTheDocument();
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
