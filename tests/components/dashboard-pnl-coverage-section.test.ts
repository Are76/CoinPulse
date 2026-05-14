import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PnlCoverageSection } from "@/components/dashboard/dashboard-presenters";
import type { DashboardPnlCoverageDto } from "@/services/dashboard/types";

const BASE_PNL_COVERAGE: DashboardPnlCoverageDto = {
  status: "partial",
  reasons: ["unpriced", "insufficient_cost_basis", "source_disabled"],
  affectedSections: ["summary", "tokens", "lpPositions", "stakePositions"],
  pricedPositionsCount: 2,
  unpricedPositionsCount: 3,
  unsupportedPositionsCount: 4,
  incompleteBasisPositionsCount: 5,
  stalePricePositionsCount: 6,
  sourceDisabledPositionsCount: 7,
  asOf: "2026-01-01T00:00:00.000Z",
};

function renderCoverage(overrides: Partial<DashboardPnlCoverageDto> = {}) {
  return render(
    React.createElement(PnlCoverageSection, {
      pnlCoverage: {
        ...BASE_PNL_COVERAGE,
        ...overrides,
      },
    }),
  );
}

afterEach(() => {
  cleanup();
});

describe("PnlCoverageSection", () => {
  it.each([
    ["valued", "Valued"],
    ["partial", "Partial"],
    ["unavailable", "Unavailable"],
    ["unsupported", "Unsupported"],
    ["unknown", "Unknown"],
  ] as const)("renders the backend pnlCoverage %s status label", (status, label) => {
    renderCoverage({ status });

    expect(screen.getByText("PnL coverage")).toBeInTheDocument();
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("renders reasons from pnlCoverage.reasons", () => {
    renderCoverage();

    expect(screen.getByText("unpriced")).toBeInTheDocument();
    expect(screen.getByText("insufficient cost basis")).toBeInTheDocument();
    expect(screen.getByText("source disabled")).toBeInTheDocument();
  });

  it("renders affected sections from pnlCoverage.affectedSections", () => {
    renderCoverage();

    expect(
      screen.getByText("Affected sections: summary, tokens, LP positions, stake positions"),
    ).toBeInTheDocument();
  });

  it("renders count fields from pnlCoverage", () => {
    renderCoverage();

    expect(screen.getByText("Priced")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Unsupported")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Incomplete basis")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Stale price")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("Source disabled")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders asOf through the timestamp label", () => {
    renderCoverage();

    expect(screen.getByText(/As of .*2026/)).toBeInTheDocument();
  });
});
