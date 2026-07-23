import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { HexMiningScreen } from "@/components/hexmining/hexmining-screen";
import type {
  EndedHexStakeDto,
  EndedHexStakeListDto,
  HexStakeListDto,
} from "@/services/hexmining/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/query/use-hexmining-stakes-query", () => ({
  useHexMiningStakesQuery: vi.fn(),
}));

vi.mock("@/lib/query/use-hexmining-ended-stakes-query", () => ({
  useHexMiningEndedStakesQuery: vi.fn(),
}));

import { useHexMiningStakesQuery } from "@/lib/query/use-hexmining-stakes-query";
import { useHexMiningEndedStakesQuery } from "@/lib/query/use-hexmining-ended-stakes-query";

function makeIdleQuery() {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    error: null,
  };
}

function makeLoadingQuery() {
  return { ...makeIdleQuery(), isLoading: true, isFetching: true };
}

function makeSuccessQuery<T>(data: T) {
  return { ...makeIdleQuery(), data, isSuccess: true };
}

function makeErrorQuery(error: Error) {
  return { ...makeIdleQuery(), isError: true, error };
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";

const EMPTY_ACTIVE_LIST: HexStakeListDto = {
  schemaVersion: "v1",
  chainId: 369,
  walletAddress: VALID_ADDRESS,
  stakeSource: "native",
  stakes: [],
  totalCount: 0,
  isComplete: true,
  observedAtBlock: "20000000",
  observedAt: "2026-06-06T00:00:00.000Z",
  warnings: [],
};

const EMPTY_ENDED_LIST: EndedHexStakeListDto = {
  schemaVersion: "v1",
  chainId: 369,
  walletAddress: VALID_ADDRESS,
  stakes: [],
  totalCount: 0,
  isComplete: true,
  warnings: [],
};

// Hearts value beyond Number.MAX_SAFE_INTEGER: proves bigint-safe formatting.
// 123456789012345678901234567890 hearts = 1234567890123456789012.3456789 HEX
const LARGE_HEARTS = "123456789012345678901234567890";
const LARGE_HEARTS_AS_HEX = "1234567890123456789012.3456789";

const COMPLETE_ENDED_STAKE: EndedHexStakeDto = {
  schemaVersion: "v1",
  id: "obs-complete",
  chainId: 369,
  walletAddress: VALID_ADDRESS,
  stakeId: "777",
  stakeIndex: 3,
  stakedDays: 365,
  lockedDay: 1200,
  stakeShares: "999999999999999999",
  principalHex: LARGE_HEARTS,
  yieldHex: "250000000000",
  penaltyHex: "0",
  endTxHash: "0xendhash",
  endBlockNumber: "26000123",
  startTxHash: "0xstarthash",
  startBlockNumber: "20000456",
  discoveryMethod: "raw_stake_action",
  observedAt: "2026-07-01T00:00:00.000Z",
  isComplete: true,
  warnings: [],
  evidenceRecoveryMethod: null,
  evidenceRecoveryBlockNumber: null,
  evidenceRecoverySourceContract: null,
  evidenceRecoverySourceFunction: null,
  evidenceRecoveryReturnedStakeId: null,
  evidenceRecoveredAt: null,
};

const RECOVERED_INCOMPLETE_STAKE: EndedHexStakeDto = {
  schemaVersion: "v1",
  id: "obs-incomplete",
  chainId: 369,
  walletAddress: VALID_ADDRESS,
  stakeId: "888",
  stakeIndex: null,
  stakedDays: null,
  lockedDay: null,
  stakeShares: null,
  principalHex: null,
  yieldHex: null,
  penaltyHex: null,
  endTxHash: "0xendhash2",
  endBlockNumber: "26000999",
  startTxHash: null,
  startBlockNumber: null,
  discoveryMethod: "raw_stake_action",
  observedAt: "2026-07-02T00:00:00.000Z",
  isComplete: false,
  warnings: ["ended-stake-locked-day-unavailable"],
  evidenceRecoveryMethod: "historical_state_stake_lists",
  evidenceRecoveryBlockNumber: "26000998",
  evidenceRecoverySourceContract: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
  evidenceRecoverySourceFunction: "stakeLists",
  evidenceRecoveryReturnedStakeId: "888",
  evidenceRecoveredAt: "2026-07-10T00:00:00.000Z",
};

function submitWallet() {
  const input = screen.getByLabelText("Wallet address");
  fireEvent.change(input, { target: { value: VALID_ADDRESS } });
  fireEvent.submit(input.closest("form")!);
}

function renderScreen() {
  render(<HexMiningScreen />, { wrapper: makeWrapper() });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Idle / not submitted ──────────────────────────────────────────────────────

describe("HexMiningScreen — ended stakes before submit", () => {
  it("does not render the ended-stakes section before a wallet is submitted", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(makeIdleQuery() as never);
    renderScreen();
    // Exact string match: the hero copy also mentions ended stakes, but only
    // the section header element's full text is exactly this string.
    expect(screen.queryByText("Ended native pHEX stakes")).not.toBeInTheDocument();
  });
});

// ── Loading / error ───────────────────────────────────────────────────────────

describe("HexMiningScreen — ended stakes loading and error", () => {
  it("shows a loading state for the ended-stakes section", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ACTIVE_LIST) as never,
    );
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(makeLoadingQuery() as never);
    renderScreen();
    submitWallet();
    expect(screen.getByText("Ended native pHEX stakes")).toBeInTheDocument();
  });

  it("shows the backend error message when the ended-stakes query fails", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ACTIVE_LIST) as never,
    );
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(
      makeErrorQuery(new Error("ended-stakes backend failure")) as never,
    );
    renderScreen();
    submitWallet();
    expect(screen.getByText(/ended-stakes backend failure/i)).toBeInTheDocument();
  });

  it("ended-stakes error does not remove the active-stake results", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ACTIVE_LIST) as never,
    );
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(
      makeErrorQuery(new Error("ended-stakes backend failure")) as never,
    );
    renderScreen();
    submitWallet();
    expect(screen.getByText("No active native pHEX stakes found")).toBeInTheDocument();
  });
});

// ── Empty ─────────────────────────────────────────────────────────────────────

describe("HexMiningScreen — ended stakes empty state", () => {
  it("shows an empty state when no ended stakes are persisted", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ACTIVE_LIST) as never,
    );
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ENDED_LIST) as never,
    );
    renderScreen();
    submitWallet();
    expect(screen.getByText("No ended native pHEX stakes recorded")).toBeInTheDocument();
  });
});

// ── Complete stake rendering ──────────────────────────────────────────────────

describe("HexMiningScreen — complete ended stake", () => {
  function renderWithCompleteStake() {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ACTIVE_LIST) as never,
    );
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(
      makeSuccessQuery({
        ...EMPTY_ENDED_LIST,
        stakes: [COMPLETE_ENDED_STAKE],
        totalCount: 1,
      }) as never,
    );
    renderScreen();
    submitWallet();
  }

  it("renders stake id, locked day, staked days, and end evidence", () => {
    renderWithCompleteStake();
    expect(screen.getByText("777")).toBeInTheDocument();
    expect(screen.getByText("1200")).toBeInTheDocument();
    expect(screen.getByText("365")).toBeInTheDocument();
    expect(screen.getByText(/end tx: 0xendhash/)).toBeInTheDocument();
    expect(screen.getByText(/end block: 26000123/)).toBeInTheDocument();
    expect(screen.getByText(/observed at: 2026-07-01T00:00:00.000Z/)).toBeInTheDocument();
  });

  it("formats large principal hearts through the bigint-safe formatter without precision loss", () => {
    renderWithCompleteStake();
    expect(screen.getByText(`${LARGE_HEARTS_AS_HEX} HEX`)).toBeInTheDocument();
    // Sanity: the naive Number path would have lost precision.
    expect(String(Number(LARGE_HEARTS) / 1e8)).not.toBe(LARGE_HEARTS_AS_HEX);
  });

  it("formats yield and penalty hearts through the bigint-safe formatter", () => {
    renderWithCompleteStake();
    // 250000000000 hearts = 2500 HEX
    expect(screen.getByText("2500 HEX")).toBeInTheDocument();
    // 0 hearts = 0 HEX — a real backend zero, not a fabricated default.
    expect(screen.getByText("0 HEX")).toBeInTheDocument();
  });

  it("shows the discovery method and does not mark complete evidence as incomplete", () => {
    renderWithCompleteStake();
    expect(screen.getByText("discovery: raw_stake_action")).toBeInTheDocument();
    expect(screen.queryByText("incomplete evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("historically recovered")).not.toBeInTheDocument();
  });
});

// ── Incomplete + recovered stake rendering ────────────────────────────────────

describe("HexMiningScreen — incomplete and recovered ended stake", () => {
  function renderWithIncompleteStake() {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ACTIVE_LIST) as never,
    );
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(
      makeSuccessQuery({
        ...EMPTY_ENDED_LIST,
        stakes: [RECOVERED_INCOMPLETE_STAKE],
        totalCount: 1,
        isComplete: false,
        warnings: ["ended-stake-locked-day-unavailable"],
      }) as never,
    );
    renderScreen();
    submitWallet();
  }

  it("shows a list-level banner when isComplete is false", () => {
    renderWithIncompleteStake();
    expect(screen.getByText("Incomplete ended-stake evidence")).toBeInTheDocument();
  });

  it("surfaces list-level backend warning codes", () => {
    renderWithIncompleteStake();
    expect(screen.getAllByText("ended-stake-locked-day-unavailable").length).toBeGreaterThan(0);
  });

  it("marks the incomplete row visibly", () => {
    renderWithIncompleteStake();
    expect(screen.getByText("incomplete evidence")).toBeInTheDocument();
  });

  it("renders missing financial values as Unavailable, never zero", () => {
    renderWithIncompleteStake();
    // principal, yield, penalty, stake shares are all null on this row.
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("0 HEX")).not.toBeInTheDocument();
  });

  it("renders the recovery provenance section with backend field values", () => {
    renderWithIncompleteStake();
    expect(screen.getByText("historically recovered")).toBeInTheDocument();
    expect(screen.getByText("Evidence recovery")).toBeInTheDocument();
    expect(
      screen.getByText(/recovery method: historical_state_stake_lists/),
    ).toBeInTheDocument();
    expect(screen.getByText(/recovery block: 26000998/)).toBeInTheDocument();
    expect(screen.getByText(/recovery source function: stakeLists/)).toBeInTheDocument();
    expect(screen.getByText(/recovery returned stake id: 888/)).toBeInTheDocument();
    expect(screen.getByText(/recovered at: 2026-07-10T00:00:00.000Z/)).toBeInTheDocument();
  });
});

// ── Stale copy removal ────────────────────────────────────────────────────────

describe("HexMiningScreen — stale ended-stake copy removed", () => {
  it("no longer claims that ended stakes are not tracked", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ACTIVE_LIST) as never,
    );
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(
      makeSuccessQuery(EMPTY_ENDED_LIST) as never,
    );
    renderScreen();
    submitWallet();
    expect(screen.queryByText(/not tracked/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Stakes closed via endStake are not tracked/i),
    ).not.toBeInTheDocument();
  });

  it("hero copy states that active and ended stakes come from backend-provided data", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    vi.mocked(useHexMiningEndedStakesQuery).mockReturnValue(makeIdleQuery() as never);
    renderScreen();
    expect(
      screen.getByText(/Active and ended native pHEX\s+stakes are shown from backend-provided data/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Pricing, valuation, and PnL remain unsupported/)).toBeInTheDocument();
  });
});
