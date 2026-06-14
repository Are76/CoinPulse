import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { HexMiningScreen } from "@/components/hexmining/hexmining-screen";
import type { HexStakeDto, HexStakeListDto } from "@/services/hexmining/types";

// ── Mocks ────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/query/use-hexmining-stakes-query", () => ({
  useHexMiningStakesQuery: vi.fn(),
}));

import { useHexMiningStakesQuery } from "@/lib/query/use-hexmining-stakes-query";

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

function makeSuccessQuery(data: HexStakeListDto) {
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

const MOCK_STAKE: HexStakeDto = {
  schemaVersion: "v1",
  stakeId: "12345",
  stakeIndex: 0,
  stakeSource: "native",
  chainId: 369,
  assetId: "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
  walletAddress: VALID_ADDRESS,
  stakeStatus: "active",
  lockedDay: 5000,
  stakedDays: 365,
  unlockedDay: 5365,
  principalHex: "1000.000000",
  stakeShares: "1000000000000000",
  tShares: "1000.000000",
  isAutoStake: false,
  pricing: { status: "unsupported", sourceType: null, sourceId: null, observedAt: null },
  valuation: { status: "unsupported", valueQuote: null },
  pnl: {
    status: "unsupported",
    averageCost: null,
    realizedPnl: null,
    unrealizedPnl: null,
    markPrice: null,
    costBasisPolicy: null,
  },
  yield: { status: "unsupported", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null, provenance: null, warnings: [] },
  provenance: {
    chainId: 369,
    walletAddress: VALID_ADDRESS,
    stakeId: "12345",
    stakeIndex: 0,
    stakeSource: "native",
    observedAtBlock: "20000000",
    observedAt: "2026-06-06T00:00:00.000Z",
    rpcEndpoint: null,
    warnings: [],
  },
  warnings: [],
};

const BASE_LIST: HexStakeListDto = {
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

// ── Idle state ────────────────────────────────────────────────────────────────────────

describe("HexMiningScreen — idle state before submit", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows idle empty state before any submission", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText("No wallet selected")).toBeInTheDocument();
  });

  it("does not show a loading spinner before submit", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("submit button is labeled 'Load stakes' when idle", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /Load stakes/i })).toBeInTheDocument();
  });

  it("query is not triggered before form submission", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    expect(vi.mocked(useHexMiningStakesQuery)).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});

// ── Validation ────────────────────────────────────────────────────────────────────

describe("HexMiningScreen — wallet address validation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows validation error for empty wallet address", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/Wallet address is required/i)).toBeInTheDocument();
  });

  it("shows validation error for whitespace-only wallet address", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/Wallet address is required/i)).toBeInTheDocument();
  });

  it("normalizes wallet address to lowercase before querying", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeIdleQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" } });
    fireEvent.submit(input.closest("form")!);
    expect(vi.mocked(useHexMiningStakesQuery)).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
      }),
    );
  });
});

// ── Loading state ───────────────────────────────────────────────────────────────────

describe("HexMiningScreen — loading state", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("submit button is disabled while loading", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeLoadingQuery() as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    const btn = screen.getByRole("button", { name: /Loading/i });
    expect(btn).toBeDisabled();
  });
});

// ── Error rendering ──────────────────────────────────────────────────────────────────

describe("HexMiningScreen — error rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows error message when query fails", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(
      makeErrorQuery(new Error("Network error")) as never,
    );
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  it("does not show stale results alongside an error", () => {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeErrorQuery(new Error("err")) as never);
    render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.queryByText(/Native pHEX stakes/i)).not.toBeInTheDocument();
  });
});

// ── Empty state ──────────────────────────────────────────────────────────────────────

describe("HexMiningScreen — empty stakes rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithData(list: HexStakeListDto) {
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeSuccessQuery(list) as never);
    const { getByLabelText } = render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
  }

  it("shows empty state when stakes array is empty", () => {
    renderWithData(BASE_LIST);
    expect(screen.getByText("No active native pHEX stakes found")).toBeInTheDocument();
  });

  it("shows partial read warning when isComplete is false", () => {
    renderWithData({ ...BASE_LIST, isComplete: false });
    expect(screen.getByText("Partial read")).toBeInTheDocument();
  });

  it("shows list-level warnings when present", () => {
    renderWithData({ ...BASE_LIST, warnings: ["hexmining-list-warn-partial-read"] });
    expect(screen.getByText("hexmining-list-warn-partial-read")).toBeInTheDocument();
  });
});

// ── Stake table rendering ──────────────────────────────────────────────────────────

describe("HexMiningScreen — stake table rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithStake(stake: HexStakeDto) {
    const list: HexStakeListDto = { ...BASE_LIST, stakes: [stake], totalCount: 1 };
    vi.mocked(useHexMiningStakesQuery).mockReturnValue(makeSuccessQuery(list) as never);
    const { getByLabelText } = render(<HexMiningScreen />, { wrapper: makeWrapper() });
    const input = getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
  }

  it("renders stakeId from the backend DTO", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText("12345")).toBeInTheDocument();
  });

  it("renders stakeStatus from the backend DTO", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("renders principalHex from the backend DTO", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getAllByText("1000.000000").length).toBeGreaterThanOrEqual(1);
  });

  it("shows stake count in table title", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText(/Native pHEX stakes \(1\)/i)).toBeInTheDocument();
  });

  it("renders yield unsupported provenance chip", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText(/yield: unsupported/i)).toBeInTheDocument();
  });

  it("renders pricing unsupported provenance chip", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText(/pricing: unsupported/i)).toBeInTheDocument();
  });

  it("renders valuation unsupported provenance chip", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText(/valuation: unsupported/i)).toBeInTheDocument();
  });

  it("renders pnl unsupported provenance chip", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText(/pnl: unsupported/i)).toBeInTheDocument();
  });

  it("renders backend-provided estimated yield for estimated yield rows", () => {
    renderWithStake({
      ...MOCK_STAKE,
      yield: {
        status: "estimated",
        estimatedYieldHex: "4212345600",
        bpdYieldStatus: "not_applicable",
        bpdYieldHex: null,
        provenance: {
          chainId: 369,
          sourceFamily: "native",
          observationId: "11111111-1111-1111-1111-111111111111",
          rangeStartDay: 5000,
          rangeEndDay: 5365,
        },
        warnings: ["hexmining-yield-bpd-attribution-unresolved"],
      },
    });

    expect(screen.getByText(/yield: estimated/i)).toBeInTheDocument();
    expect(screen.getByText("estimated yield: 4212345600 hearts")).toBeInTheDocument();
    expect(screen.queryByText("estimated yield: 4212345600 HEX")).not.toBeInTheDocument();
  });

  it("renders yield warnings near estimated yield rows", () => {
    renderWithStake({
      ...MOCK_STAKE,
      yield: {
        status: "estimated",
        estimatedYieldHex: "4212345600",
        bpdYieldStatus: "not_applicable",
        bpdYieldHex: null,
        provenance: {
          chainId: 369,
          sourceFamily: "native",
          observationId: "11111111-1111-1111-1111-111111111111",
          rangeStartDay: 5000,
          rangeEndDay: 5365,
        },
        warnings: ["hexmining-yield-bpd-attribution-unresolved"],
      },
    });

    expect(screen.getByText("yield warning: hexmining-yield-bpd-attribution-unresolved")).toBeInTheDocument();
  });

  it("renders yield provenance near estimated yield rows", () => {
    renderWithStake({
      ...MOCK_STAKE,
      yield: {
        status: "estimated",
        estimatedYieldHex: "4212345600",
        bpdYieldStatus: "not_applicable",
        bpdYieldHex: null,
        provenance: {
          chainId: 369,
          sourceFamily: "native",
          observationId: "11111111-1111-1111-1111-111111111111",
          rangeStartDay: 5000,
          rangeEndDay: 5365,
        },
        warnings: [],
      },
    });

    expect(
      screen.getByText("yield observation: 11111111-1111-1111-1111-111111111111"),
    ).toBeInTheDocument();
    expect(screen.getByText("yield days: 5000-5365")).toBeInTheDocument();
  });

  it("does not fabricate yield values for unavailable rows", () => {
    renderWithStake({
      ...MOCK_STAKE,
      yield: {
        status: "unavailable",
        estimatedYieldHex: null,
        bpdYieldStatus: "unknown",
        bpdYieldHex: null,
        provenance: null,
        warnings: ["hexmining-yield-unavailable"],
      },
    });

    expect(screen.getByText(/yield: unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/estimated yield:/i)).not.toBeInTheDocument();
  });

  it("does not fabricate yield values for unsupported rows", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText(/yield: unsupported/i)).toBeInTheDocument();
    expect(screen.queryByText(/estimated yield:/i)).not.toBeInTheDocument();
  });

  it("does not show estimated yield values for non-estimated yield statuses", () => {
    renderWithStake({
      ...MOCK_STAKE,
      yield: {
        status: "exact",
        estimatedYieldHex: "99.000000",
        bpdYieldStatus: "not_applicable",
        bpdYieldHex: null,
        provenance: {
          chainId: 369,
          sourceFamily: "native",
          observationId: "22222222-2222-2222-2222-222222222222",
          rangeStartDay: 5000,
          rangeEndDay: 5365,
        },
        warnings: [],
      },
    });

    expect(screen.getByText(/yield: exact/i)).toBeInTheDocument();
    expect(screen.queryByText(/estimated yield:/i)).not.toBeInTheDocument();
  });

  it("explains estimated yield without saying yield is generally unavailable", () => {
    renderWithStake(MOCK_STAKE);

    expect(
      screen.getByText(/Backend-estimated yield is shown when backend evidence is available/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Yield, pricing, valuation, and PnL are not yet supported/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Yield, pricing, valuation, and PnL are not available in Phase 2/i),
    ).not.toBeInTheDocument();
  });

  it("keeps pricing, valuation, and PnL unsupported in UI copy", () => {
    renderWithStake(MOCK_STAKE);
    expect(
      screen.getAllByText(/pricing, valuation, and PnL remain unsupported/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders stake warnings inline", () => {
    renderWithStake({ ...MOCK_STAKE, warnings: ["hex-stake-read-partial"] });
    expect(screen.getByText("hex-stake-read-partial")).toBeInTheDocument();
  });

  it("renders provenance observedAtBlock", () => {
    renderWithStake(MOCK_STAKE);
    expect(screen.getByText(/block: 20000000/i)).toBeInTheDocument();
  });
});
