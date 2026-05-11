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
        selectedWalletAddress: walletAddress,
        selectedChainId: chainId,
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

  // -------------------------------------------------------------------------
  // Suite 4 – selected state indicator
  // -------------------------------------------------------------------------

  describe("selected state indicator", () => {
    it("shows Selected badge on the matching row after wallet is clicked", () => {
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      // Before selection, no Selected badge
      expect(screen.queryByText("Selected")).toBeNull();

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );

      expect(screen.getByText("Selected")).toBeInTheDocument();
    });

    it("Selected badge is visible for the matching wallet even with case-insensitive address", () => {
      render(
        React.createElement(TrackedWalletSelector, {
          wallets: [TRACKED_WALLET],
          isLoading: false,
          isError: false,
          onSelectWallet: vi.fn(),
          selectedWalletAddress: TRACKED_WALLET.address.toUpperCase(),
          selectedChainId: "369",
        }),
      );

      expect(screen.getByText("Selected")).toBeInTheDocument();
    });

    it("no Selected badge when chainId does not match", () => {
      render(
        React.createElement(TrackedWalletSelector, {
          wallets: [TRACKED_WALLET],
          isLoading: false,
          isError: false,
          onSelectWallet: vi.fn(),
          selectedWalletAddress: TRACKED_WALLET.address,
          selectedChainId: "1",
        }),
      );

      expect(screen.queryByText("Selected")).toBeNull();
    });

    it("Selected badge disappears after the wallet address field is manually edited", () => {
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      // Select the wallet
      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );
      expect(screen.getByText("Selected")).toBeInTheDocument();

      // Manually edit the wallet address field
      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: "0xDEAD" },
      });

      expect(screen.queryByText("Selected")).toBeNull();
    });

    it("Selected badge disappears after the chain ID field is manually edited", () => {
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      // Select the wallet
      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );
      expect(screen.getByText("Selected")).toBeInTheDocument();

      // Manually edit the chain ID field
      fireEvent.change(screen.getByRole("textbox", { name: "Chain ID" }), {
        target: { value: "1" },
      });

      expect(screen.queryByText("Selected")).toBeNull();
    });

    it("selecting a wallet with selected state shown still does not trigger dashboard fetch", () => {
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

      // Selected indicator visible but no fetch triggered
      expect(screen.getByText("Selected")).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("explicit Load dashboard submit still triggers fetch when wallet is selected", () => {
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
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        walletAddress: TRACKED_WALLET.address,
        chainId: 369,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Suite 5 – manual entry submit
  // -------------------------------------------------------------------------

  describe("manual entry submit", () => {
    const MANUAL_ADDRESS = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    it("submit is not triggered before the explicit Load dashboard button click", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: MANUAL_ADDRESS },
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("typing a wallet address manually and submitting passes the typed address to the query flow", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: MANUAL_ADDRESS },
      });

      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        walletAddress: MANUAL_ADDRESS,
        chainId: 369,
      });
    });

    it("typing a custom chain ID and submitting passes the typed chain ID to the query flow", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: MANUAL_ADDRESS },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Chain ID" }), {
        target: { value: "1" },
      });

      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        walletAddress: MANUAL_ADDRESS,
        chainId: 1,
      });
    });

    it("blank wallet address does not trigger the query flow on submit", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      // Wallet address field is blank (default); submit should be rejected
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Suite 6 – regression: select then edit then submit
  // -------------------------------------------------------------------------

  describe("regression: manually edited address after tracked wallet selection", () => {
    const EDITED_ADDRESS = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    it("submitting after editing the address uses the edited address, not the selected wallet address", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      // Step 1: select the tracked wallet
      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );
      expect(screen.getByRole("textbox", { name: "Wallet address" })).toHaveValue(
        TRACKED_WALLET.address,
      );

      // Step 2: manually edit the wallet address
      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: EDITED_ADDRESS },
      });
      expect(screen.getByRole("textbox", { name: "Wallet address" })).toHaveValue(EDITED_ADDRESS);

      // Step 3: submit
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      // Assert the edited address was submitted, not the original tracked wallet address
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        walletAddress: EDITED_ADDRESS,
        chainId: 369,
      });
      expect(onSubmit).not.toHaveBeenCalledWith({
        walletAddress: TRACKED_WALLET.address,
        chainId: 369,
      });
    });

    it("submitting after editing the chain ID uses the edited chain ID, not the selected wallet chain", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      // Step 1: select the tracked wallet (chainId 369)
      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );

      // Step 2: manually change chain ID
      fireEvent.change(screen.getByRole("textbox", { name: "Chain ID" }), {
        target: { value: "1" },
      });

      // Step 3: submit
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        walletAddress: TRACKED_WALLET.address,
        chainId: 1,
      });
    });

    it("submit is not triggered by selection or editing – only by the explicit button click", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [TRACKED_WALLET],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      // select
      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${TRACKED_WALLET.address}`,
        }),
      );
      expect(onSubmit).not.toHaveBeenCalled();

      // edit
      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: EDITED_ADDRESS },
      });
      expect(onSubmit).not.toHaveBeenCalled();

      // explicit submit
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
