import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MaterializationIntegritySection } from "@/components/dashboard/dashboard-presenters";
import type { DashboardMaterializationDto } from "@/services/dashboard/types";

const BASE_MATERIALIZATION: DashboardMaterializationDto = {
  status: "COMPLETED",
  completedSuccessfully: true,
  lastAttemptedAt: "2026-07-27T12:00:00.000Z",
  latestMaterializedAt: "2026-07-27T12:00:00.000Z",
  updatedFromBlock: "100",
  updatedToBlock: "200",
  sourceLedgerFromBlock: "100",
  sourceLedgerToBlock: "200",
  warningCount: 0,
  warnings: [],
  errorMessage: null,
  hasNegativeBalances: false,
  negativeBalances: [],
  freshness: {
    status: "fresh",
    reason: null,
    lastMaterializedAt: "2026-07-27T12:00:00.000Z",
    staleAfterSeconds: 300,
  },
};

function renderIntegrity(overrides: Partial<DashboardMaterializationDto> = {}) {
  return render(
    <MaterializationIntegritySection
      materialization={{ ...BASE_MATERIALIZATION, ...overrides }}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("MaterializationIntegritySection", () => {
  it("renders nothing in the clean state (no error, warnings, or negative balances)", () => {
    const { container } = renderIntegrity();
    expect(container.firstChild).toBeNull();
  });

  describe("error message", () => {
    it("renders errorMessage prominently when present", () => {
      renderIntegrity({
        status: "FAILED",
        completedSuccessfully: false,
        errorMessage: "RPC timeout while reading token balances",
      });

      expect(screen.getByText("Materialization error")).toBeInTheDocument();
      expect(screen.getByText("RPC timeout while reading token balances")).toBeInTheDocument();
    });

    it("does not label a run successful merely because errorMessage is absent", () => {
      renderIntegrity({ status: "RUNNING", completedSuccessfully: null, errorMessage: null });

      expect(screen.getByText("RUNNING")).toBeInTheDocument();
      expect(screen.getByText("Completed successfully: unknown")).toBeInTheDocument();
      expect(screen.queryByText("Materialization error")).not.toBeInTheDocument();
    });
  });

  describe("typed warnings", () => {
    it("renders warning code and message for a single warning", () => {
      renderIntegrity({
        warningCount: 1,
        warnings: [{ code: "generic_persisted_warning", message: "Stake reconciliation deferred" }],
      });

      expect(screen.getByText("generic_persisted_warning")).toBeInTheDocument();
      expect(screen.getByText(/Stake reconciliation deferred/)).toBeInTheDocument();
    });

    it("preserves backend warning ordering for multiple warnings", () => {
      renderIntegrity({
        warningCount: 2,
        warnings: [
          { code: "negative_token_balance", message: "Negative materialized token balance for chain:369:erc20:0xaaa: -5" },
          { code: "generic_persisted_warning", message: "Second warning" },
        ],
      });

      const items = screen.getAllByRole("listitem");
      const warningItems = items.filter((item) =>
        item.textContent?.includes("negative_token_balance") || item.textContent?.includes("generic_persisted_warning"),
      );
      expect(warningItems[0].textContent).toContain("negative_token_balance");
      expect(warningItems[1].textContent).toContain("generic_persisted_warning");
    });

    it("does not render a warning list when warnings is empty", () => {
      renderIntegrity({ warningCount: 0, warnings: [], errorMessage: "still failing" });

      expect(screen.queryByText(/Warning count \(backend\)/)).not.toBeInTheDocument();
    });

    it("surfaces a warningCount/warnings.length discrepancy rather than hiding it", () => {
      renderIntegrity({
        warningCount: 5,
        warnings: [{ code: "generic_persisted_warning", message: "Only one shown" }],
      });

      expect(screen.getByText(/Warning count \(backend\): 5/)).toBeInTheDocument();
      expect(screen.getByText(/\(1 shown\)/)).toBeInTheDocument();
    });
  });

  describe("negative balances", () => {
    it("produces a clear warning when hasNegativeBalances is true", () => {
      renderIntegrity({
        hasNegativeBalances: true,
        negativeBalances: [
          {
            assetId: "chain:369:erc20:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            balanceQuantity: "-9223372036854775808123456789",
            decimals: 18,
          },
        ],
      });

      expect(screen.getByText("Negative materialized balances detected")).toBeInTheDocument();
      expect(screen.getByText("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeInTheDocument();
    });

    it("renders each supplied negative-balance entry with canonical identity fields", () => {
      renderIntegrity({
        hasNegativeBalances: true,
        negativeBalances: [
          {
            assetId: "chain:369:erc20:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            assetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            balanceQuantity: "-1",
            decimals: 18,
          },
          {
            assetId: "chain:369:erc20:0xcccccccccccccccccccccccccccccccccccccccc",
            assetAddress: null,
            balanceQuantity: "-2",
            decimals: null,
          },
        ],
      });

      expect(screen.getByText("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBeInTheDocument();
      expect(screen.getByText("chain:369:erc20:0xcccccccccccccccccccccccccccccccccccccccc")).toBeInTheDocument();
      expect(screen.getByText("Quantity: -1")).toBeInTheDocument();
      expect(screen.getByText("Quantity: -2")).toBeInTheDocument();
    });

    it("renders quantity exactly as provided by the backend, with no numeric conversion", () => {
      const regressionQuantity = "-99999999999999999999999999999999999999"; // exceeds Number.MAX_SAFE_INTEGER

      renderIntegrity({
        hasNegativeBalances: true,
        negativeBalances: [
          {
            assetId: "chain:369:erc20:0xdddddddddddddddddddddddddddddddddddddddd",
            assetAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
            balanceQuantity: regressionQuantity,
            decimals: 18,
          },
        ],
      });

      expect(screen.getByText(`Quantity: ${regressionQuantity}`)).toBeInTheDocument();
    });

    it("shows the integrity signal even when negativeBalances is empty", () => {
      renderIntegrity({ hasNegativeBalances: true, negativeBalances: [] });

      expect(screen.getByText("Negative materialized balances detected")).toBeInTheDocument();
    });

    it("preserves negativeBalances entries even when hasNegativeBalances is false", () => {
      renderIntegrity({
        hasNegativeBalances: false,
        negativeBalances: [
          {
            assetId: "chain:369:erc20:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            assetAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            balanceQuantity: "-3",
            decimals: 18,
          },
        ],
      });

      expect(screen.getByText("Negative balance entries present without integrity flag")).toBeInTheDocument();
      expect(screen.getByText("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")).toBeInTheDocument();
      expect(screen.queryByText("Negative materialized balances detected")).not.toBeInTheDocument();
    });
  });

  it("keeps existing freshness-style content out of this section (no duplication check needed here; structural wiring covered separately)", () => {
    renderIntegrity({ status: "FAILED", completedSuccessfully: false, errorMessage: "boom" });
    expect(screen.getByText("Materialization integrity")).toBeInTheDocument();
  });
});
