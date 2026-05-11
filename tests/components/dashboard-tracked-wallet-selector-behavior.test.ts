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
  SubmittedWalletSourceIndicator,
} from "@/components/dashboard/dashboard-presenters";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import { resolveDashboardSubmission, findTrackedWalletLabel, resolveSubmittedWalletSource } from "@/components/dashboard/dashboard-screen-helpers";
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

    const selectedTrackedWalletLabel = findTrackedWalletLabel(
      harnessArgs.wallets,
      walletAddress,
      chainId,
    );

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
        selectedTrackedWalletLabel,
        onWalletAddressChange: setWalletAddress,
        onChainIdChange: setChainId,
        onSubmit: handleSubmit,
      }),
    );
  }

  return Harness;
}

// ---------------------------------------------------------------------------
// Source harness – extends makeHarness to also track submittedParams and
// render SubmittedWalletSourceIndicator. Mirrors the DashboardScreen logic.
// ---------------------------------------------------------------------------

function makeSourceHarness(harnessArgs: {
  wallets: TrackedWalletDto[] | undefined;
  isError: boolean;
}) {
  function Harness() {
    const [walletAddress, setWalletAddress] = React.useState("");
    const [chainId, setChainId] = React.useState("369");
    const [submittedParams, setSubmittedParams] = React.useState<SubmittedParams | null>(null);

    const selectedTrackedWalletLabel = findTrackedWalletLabel(
      harnessArgs.wallets,
      walletAddress,
      chainId,
    );

    const submittedWalletSource = resolveSubmittedWalletSource(
      submittedParams,
      harnessArgs.wallets,
    );

    function handleSelectWallet(address: string, selectedChainId: string) {
      setWalletAddress(address);
      setChainId(selectedChainId);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const result = resolveDashboardSubmission({ walletAddress, chainId });
      if (result.validationError === null) {
        setSubmittedParams(result.submittedParams);
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
        selectedTrackedWalletLabel,
        onWalletAddressChange: setWalletAddress,
        onChainIdChange: setChainId,
        onSubmit: handleSubmit,
      }),
      React.createElement(SubmittedWalletSourceIndicator, { source: submittedWalletSource }),
    );
  }

  return Harness;
}


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

    it("empty state includes a link to /debug/wallets/import", () => {
      render(
        React.createElement(TrackedWalletSelector, {
          wallets: [],
          isLoading: false,
          isError: false,
          onSelectWallet: vi.fn(),
        }),
      );

      const link = screen.getByRole("link", { name: /Import a wallet/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/debug/wallets/import");
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

    it("rendering the empty state with import link does not trigger a dashboard submit", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      // The import link is visible but no submit has fired
      expect(screen.getByRole("link", { name: /Import a wallet/i })).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
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

  // -------------------------------------------------------------------------
  // Suite 7 – selected wallet submit context helper message
  // -------------------------------------------------------------------------

  describe("selected wallet submit context helper", () => {
    const LABELED_WALLET: TrackedWalletDto = {
      ...TRACKED_WALLET,
      label: "Primary",
    };

    const UNLABELED_WALLET: TrackedWalletDto = {
      ...TRACKED_WALLET,
      id: "wallet-2",
      address: "0x2222222222222222222222222222222222222222",
      label: null,
    };

    it("shows the helper message after selecting a labeled tracked wallet", () => {
      const Harness = makeHarness({
        wallets: [LABELED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      // No helper before selection
      expect(
        screen.queryByText(/Selected tracked wallet:/i),
      ).toBeNull();

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${LABELED_WALLET.address}`,
        }),
      );

      expect(
        screen.getByText(/Selected tracked wallet: Primary/i),
      ).toBeInTheDocument();
    });

    it("helper message includes the wallet label", () => {
      const Harness = makeHarness({
        wallets: [LABELED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${LABELED_WALLET.address}`,
        }),
      );

      const message = screen.getByText(/Selected tracked wallet: Primary/i);
      expect(message.textContent).toContain("Load dashboard");
    });

    it("helper message shows Unlabeled fallback when wallet has no label", () => {
      const Harness = makeHarness({
        wallets: [UNLABELED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${UNLABELED_WALLET.address}`,
        }),
      );

      expect(
        screen.getByText(/Selected tracked wallet: Unlabeled/i),
      ).toBeInTheDocument();
    });

    it("helper message disappears when wallet address is manually edited to non-matching value", () => {
      const Harness = makeHarness({
        wallets: [LABELED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${LABELED_WALLET.address}`,
        }),
      );
      expect(screen.getByText(/Selected tracked wallet: Primary/i)).toBeInTheDocument();

      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: "0xDEAD" },
      });

      expect(screen.queryByText(/Selected tracked wallet:/i)).toBeNull();
    });

    it("helper message disappears when chain ID is manually edited to non-matching value", () => {
      const Harness = makeHarness({
        wallets: [LABELED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${LABELED_WALLET.address}`,
        }),
      );
      expect(screen.getByText(/Selected tracked wallet: Primary/i)).toBeInTheDocument();

      fireEvent.change(screen.getByRole("textbox", { name: "Chain ID" }), {
        target: { value: "1" },
      });

      expect(screen.queryByText(/Selected tracked wallet:/i)).toBeNull();
    });

    it("no helper message for manual wallet entry that does not match any tracked wallet", () => {
      const Harness = makeHarness({
        wallets: [LABELED_WALLET],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      });

      expect(screen.queryByText(/Selected tracked wallet:/i)).toBeNull();
    });

    it("helper message does not appear when there are no tracked wallets", () => {
      const Harness = makeHarness({
        wallets: [],
        isError: false,
        onSubmit: vi.fn(),
      });

      render(React.createElement(Harness));

      expect(screen.queryByText(/Selected tracked wallet:/i)).toBeNull();
    });

    it("helper message does not trigger a dashboard fetch", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [LABELED_WALLET],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${LABELED_WALLET.address}`,
        }),
      );

      // Helper is visible but no fetch has been triggered
      expect(screen.getByText(/Selected tracked wallet: Primary/i)).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("explicit Load dashboard submit still fires after helper is shown", () => {
      const onSubmit = vi.fn();
      const Harness = makeHarness({
        wallets: [LABELED_WALLET],
        isError: false,
        onSubmit,
      });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", {
          name: `Select wallet ${LABELED_WALLET.address}`,
        }),
      );
      expect(screen.getByText(/Selected tracked wallet: Primary/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        walletAddress: LABELED_WALLET.address,
        chainId: 369,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Suite 8 – submitted wallet source indicator
  // -------------------------------------------------------------------------

  describe("submitted wallet source indicator", () => {
    const LABELED_WALLET: TrackedWalletDto = {
      ...TRACKED_WALLET,
      label: "Primary",
    };

    const UNLABELED_WALLET: TrackedWalletDto = {
      ...TRACKED_WALLET,
      id: "wallet-unlabeled",
      address: "0x3333333333333333333333333333333333333333",
      label: null,
    };

    const MANUAL_ADDRESS = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    it("no submitted source indicator before explicit submit", () => {
      const Harness = makeSourceHarness({ wallets: [LABELED_WALLET], isError: false });

      render(React.createElement(Harness));

      expect(screen.queryByText(/Submitted from/i)).toBeNull();
    });

    it("submitting a tracked wallet shows 'Submitted from tracked wallet: {label}'", () => {
      const Harness = makeSourceHarness({ wallets: [LABELED_WALLET], isError: false });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", { name: `Select wallet ${LABELED_WALLET.address}` }),
      );
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(
        screen.getByText("Submitted from tracked wallet: Primary"),
      ).toBeInTheDocument();
    });

    it("submitting an unlabeled tracked wallet shows 'Submitted from tracked wallet: Unlabeled'", () => {
      const Harness = makeSourceHarness({ wallets: [UNLABELED_WALLET], isError: false });

      render(React.createElement(Harness));

      fireEvent.click(
        screen.getByRole("button", { name: `Select wallet ${UNLABELED_WALLET.address}` }),
      );
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(
        screen.getByText("Submitted from tracked wallet: Unlabeled"),
      ).toBeInTheDocument();
    });

    it("submitting a manually entered address shows 'Submitted from manual entry'", () => {
      const Harness = makeSourceHarness({ wallets: [LABELED_WALLET], isError: false });

      render(React.createElement(Harness));

      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: MANUAL_ADDRESS },
      });
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(screen.getByText("Submitted from manual entry")).toBeInTheDocument();
    });

    it("indicator reflects last submitted tracked wallet even after editing the form address field", () => {
      const Harness = makeSourceHarness({ wallets: [LABELED_WALLET], isError: false });

      render(React.createElement(Harness));

      // Submit tracked wallet
      fireEvent.click(
        screen.getByRole("button", { name: `Select wallet ${LABELED_WALLET.address}` }),
      );
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(
        screen.getByText("Submitted from tracked wallet: Primary"),
      ).toBeInTheDocument();

      // Edit the form field without submitting again
      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: MANUAL_ADDRESS },
      });

      // Indicator must still reflect the last submitted tracked wallet
      expect(
        screen.getByText("Submitted from tracked wallet: Primary"),
      ).toBeInTheDocument();
    });

    it("indicator reflects last submitted manual wallet even after selecting a tracked wallet", () => {
      const Harness = makeSourceHarness({ wallets: [LABELED_WALLET], isError: false });

      render(React.createElement(Harness));

      // Submit manual wallet
      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: MANUAL_ADDRESS },
      });
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      expect(screen.getByText("Submitted from manual entry")).toBeInTheDocument();

      // Select a tracked wallet without submitting again
      fireEvent.click(
        screen.getByRole("button", { name: `Select wallet ${LABELED_WALLET.address}` }),
      );

      // Indicator must still reflect the last submitted manual wallet
      expect(screen.getByText("Submitted from manual entry")).toBeInTheDocument();
    });

    it("explicit submit after selecting tracked wallet updates the indicator", () => {
      const Harness = makeSourceHarness({ wallets: [LABELED_WALLET], isError: false });

      render(React.createElement(Harness));

      // First: submit manual wallet
      fireEvent.change(screen.getByRole("textbox", { name: "Wallet address" }), {
        target: { value: MANUAL_ADDRESS },
      });
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));
      expect(screen.getByText("Submitted from manual entry")).toBeInTheDocument();

      // Then: select tracked wallet and submit explicitly
      fireEvent.click(
        screen.getByRole("button", { name: `Select wallet ${LABELED_WALLET.address}` }),
      );
      fireEvent.click(screen.getByRole("button", { name: /Load dashboard/i }));

      // Indicator must now reflect the newly submitted tracked wallet
      expect(
        screen.getByText("Submitted from tracked wallet: Primary"),
      ).toBeInTheDocument();
    });
  });
});
