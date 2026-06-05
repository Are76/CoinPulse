import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

import { DashboardHero } from "@/components/dashboard/dashboard-presenters";

// DashboardHero uses no query hooks — no QueryClientProvider needed.

const DEFAULT_PROPS = {
  backendStatusLabel: "backend ok",
  backendStatusTone: "fresh" as const,
  pricingStatusLabel: "pricing persisted only",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardHero — /transactions navigation link", () => {
  it("renders a link to /transactions", () => {
    render(<DashboardHero {...DEFAULT_PROPS} />);
    const link = screen.getByRole("link", { name: /transaction history/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/transactions");
  });

  it("link text contains 'Transaction history'", () => {
    render(<DashboardHero {...DEFAULT_PROPS} />);
    expect(screen.getByText(/Transaction history/i)).toBeInTheDocument();
  });
});
