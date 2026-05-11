/**
 * Behavioral tests for the dashboard tracked-wallet selector (PR #43).
 *
 * Tests are driven through React Testing Library's render/fireEvent API.
 * No JSX is used in this file; all elements are built with React.createElement.
 * No production code is changed by this suite.
 */

import React from "react";
import type { FormEvent } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TrackedWalletSelector,
  WalletQueryForm,
} from "@/components/dashboard/dashboard-presenters";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import { resolveDashboardSubmission } from "@/components/dashboard/dashboard-screen-helpers";
import type { SubmittedParams } from "@/components/dashboard/dashboard-screen-helpers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRACKED_WALLET: TrackedWalletDto = {
  id: "wallet-1",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "Primary",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Stateful test harness
//
// Wires TrackedWalletSelector + WalletQueryForm together using the same state
// logic as DashboardScreen (address/chainId set by selection; submit resolved
// by resolveDashboardSubmission). No JSX; only React.createElement.
// ---------------------------------------------------------------------------

function makeHarness(harnessArgs: {
  wallets: TrackedWalletDto[] | undefined;
  isError: boolean;
  onSubmit: (params: SubmittedParams) => void;
}) {
  function Harness() {
    const [walletAddress, setWalletAddress] = React.useState("");
    const [chainId, setChainId] = React.useState("369");

    function handleSelectWallet(address: string, selectedChainId: string) {
      setWalletAddress(address);
      setChainId(selectedChainId);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const result = resolveDashboardSubmission({ walletAddress, chainId });
      if (result.validationError === null) {
        harnessArgs.onSubmit(result.submittedParams);
      }
    }

    return React.createElement(
      "div",
      null,
      React.createElement(TrackedWalletSelector, {
        wallets: harnessArgs.wallets,
        isLoading: false,
        isError: harnessArgs.isError,
        onSelectWallet: handleSelectWallet,
      }),
      React.createElement(WalletQueryForm, {
        walletAddress,
        chainId,
        isLoading: false,
        onWalletAddressChange: setWalletAddress,
        onChainIdChange: setChainId,
        onSubmit: handleSubmit,
      }),
    );
  }

  return Harness;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dashboard tracked wallet selector behavior", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Suite 1 – one tracked wallet in the list
  // -------------------------------------------------------------------------

  describe("with one tracked wallet", () => {
    it("renders the tracked wallet address, chain ID, and label in the selector", () => {
      render(
        React.createElement(TrackedWalletSelector, {
          wallets: [TRACKED_WALLET],
          isLoading: false,
          isError: false,
          onSelectWallet: vi.fn(),
        }),
      );

      expect(screen.getByText(TRACKED_WALLET.address)).toBeInTheDocument();
      expect(screen.getByText("Primary")).toBeInTheDocument();
      expect(screen.getByText("Chain ID: 369")).toBeInTheDocument();
    });

    it("clicking a tracked wallet calls onSelectWallet with the wallet address and string chainId", () => {
      const onSelectWallet = vi.fn();

      render(
        React.createElement(TrackedWalletSelector, {
          wallets: [TRACKED_WALLET],
          isLoading: false,
          isError: false,
          onSelectWallet,
        }),
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );

      expect(onSelectWallet).toHaveBeenCalledTimes(1);
      expect(onSelectWallet).toHaveBeenCalledWith(TRACKED_WALLET.address, "369");
    });

    it("selecting a tracked wallet populates the wallet address form field", () => {
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );

      expect(screen.getByRole("textbox", { name: "Wallet address" })).toHaveValue(
        TRACKED_WALLET.address,
      );
    });

    it("selecting a tracked wallet populates the chain ID form field with 369", () => {
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );

      expect(screen.getByRole("textbox", { name: "Chain ID" })).toHaveValue("369");
    });

    it("selecting a tracked wallet does not trigger a dashboard fetch", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("dashboard fetch is triggered only after the explicit Load dashboard submit", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      // Step 1: select the wallet – onSubmit must stay silent
      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );
      expect(onSubmit).not.toHaveBeenCalled();

      // Step 2: click the explicit submit button – onSubmit fires exactly once
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        walletAddress: TRACKED_WALLET.address,
        chainId: 369,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Suite 2 – empty tracked wallets list
  // -------------------------------------------------------------------------

  describe("with empty tracked wallets", () => {
    it("shows the no-wallets helper text when the wallet list is empty", () => {
      render(
        React.createElement(TrackedWalletSelector, {
          wallets: [],
          isLoading: false,
          isError: false,
          onSelectWallet: vi.fn(),
        }),
      );

      expect(screen.getByText(/No tracked wallets yet/i)).toBeInTheDocument();
    });

    it("manual wallet entry input is still available when there are no tracked wallets", () => {
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      expect(screen.getByRole("textbox", { name: "Wallet address" })).toBeInTheDocument();
    });

    it("the Load dashboard submit button is still available when there are no tracked wallets", () => {
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      expect(screen.getByRole("button", { name: /Load dashboard/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Suite 3 – tracked wallets query error
  // -------------------------------------------------------------------------

  describe("when useTrackedWalletsQuery returns an error", () => {
    it("shows the non-blocking error helper text in the selector", () => {
      render(
        React.createElement(TrackedWalletSelector, {
          wallets: undefined,
          isLoading: false,
          isError: true,
          onSelectWallet: vi.fn(),
        }),
      );

      expect(screen.getByText(/Could not load tracked wallets/i)).toBeInTheDocument();
    });

    it("manual wallet entry input is still available when tracked wallets query fails", () => {
      const Harness = makeHarness({
        wallets: undefined,
        isError: true,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      expect(screen.getByRole("textbox", { name: "Wallet address" })).toBeInTheDocument();
    });

    it("the Load dashboard submit button is still available when tracked wallets query fails", () => {
      const Harness = makeHarness({
        wallets: undefined,
        isError: true,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      expect(screen.getByRole("button", { name: /Load dashboard/i })).toBeInTheDocument();
    });
  });
});
