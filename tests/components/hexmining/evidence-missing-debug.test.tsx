import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { EvidenceMissingDebug } from "@/components/hexmining/evidence-missing-debug";
import type { HexMiningEvidenceCoverageReportDto, HexMiningEvidenceCoverageStakeDto } from "@/services/hexmining/evidence-coverage-report";

// ── Mocks ────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/query/use-hexmining-evidence-missing-query", () => ({
  useHexMiningEvidenceMissingQuery: vi.fn(),
}));

import { useHexMiningEvidenceMissingQuery } from "@/lib/query/use-hexmining-evidence-missing-query";

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

function makeSuccessQuery(data: HexMiningEvidenceCoverageReportDto) {
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

const COVERED_STAKE: HexMiningEvidenceCoverageStakeDto = {
  stakeId: "99001",
  lockedDay: 5000,
  currentDay: 5300,
  rangeStartDay: 5000,
  rangeEndDay: 5299,
  covered: true,
  observationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  missingReason: null,
};

const MISSING_STAKE: HexMiningEvidenceCoverageStakeDto = {
  stakeId: "99002",
  lockedDay: 5100,
  currentDay: 5300,
  rangeStartDay: 5100,
  rangeEndDay: 5299,
  covered: false,
  observationId: null,
  missingReason: "missing_exact_observation",
};

const NO_ELAPSED_STAKE: HexMiningEvidenceCoverageStakeDto = {
  stakeId: "99003",
  lockedDay: 5300,
  currentDay: 5300,
  rangeStartDay: 5300,
  rangeEndDay: 5299,
  covered: false,
  observationId: null,
  missingReason: "no_elapsed_days",
};

const BASE_REPORT: HexMiningEvidenceCoverageReportDto = {
  schemaVersion: "v1",
  summary: {
    chainId: 369,
    sourceFamily: "HEXMINING",
    totalActiveStakes: 0,
    coveredStakes: 0,
    missingEvidenceStakes: 0,
    stakeReadIsComplete: true,
    stakeReadWarnings: [],
  },
  stakes: [],
};

// ── Idle state ────────────────────────────────────────────────────────────────────────

describe("EvidenceMissingDebug — idle state", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows idle empty state before any submission", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.getByText("No diagnostic run")).toBeInTheDocument();
  });

  it("query is not triggered before form submission — enabled: false", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(vi.mocked(useHexMiningEvidenceMissingQuery)).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("no fetch occurs with empty wallet address — validation error shown instead", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/Wallet address is required/i)).toBeInTheDocument();
    // query remains disabled
    expect(vi.mocked(useHexMiningEvidenceMissingQuery)).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("shows required copy — Diagnostic only", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.getByText("Diagnostic only")).toBeInTheDocument();
  });

  it("shows required copy — Does not estimate yield", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.getByText("Does not estimate yield")).toBeInTheDocument();
  });

  it("shows required copy — Does not fetch or persist observations", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.getByText("Does not fetch or persist observations")).toBeInTheDocument();
  });

  it("shows required copy — Missing evidence does not mean yield is zero", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.getByText("Missing evidence does not mean yield is zero")).toBeInTheDocument();
  });
});

// ── Validation and request ─────────────────────────────────────────────────────────────

describe("EvidenceMissingDebug — wallet validation and request", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("valid wallet + submit enables query with correct walletAddress and chainId=369", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    expect(vi.mocked(useHexMiningEvidenceMissingQuery)).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: VALID_ADDRESS,
        chainId: 369,
        enabled: true,
      }),
    );
  });

  it("normalizes wallet address to lowercase before querying", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" } });
    fireEvent.submit(input.closest("form")!);
    expect(vi.mocked(useHexMiningEvidenceMissingQuery)).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
      }),
    );
  });

  it("submit button disabled while loading", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeLoadingQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    const btn = screen.getByRole("button", { name: /Loading/i });
    expect(btn).toBeDisabled();
  });
});

// ── Summary rendering ──────────────────────────────────────────────────────────────────

describe("EvidenceMissingDebug — summary counts from DTO", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithReport(report: HexMiningEvidenceCoverageReportDto) {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeSuccessQuery(report) as never);
    const { getByLabelText } = render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    const input = getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
  }

  it("renders totalActiveStakes from DTO", () => {
    renderWithReport({ ...BASE_REPORT, summary: { ...BASE_REPORT.summary, totalActiveStakes: 3 } });
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders coveredStakes from DTO", () => {
    renderWithReport({ ...BASE_REPORT, summary: { ...BASE_REPORT.summary, coveredStakes: 2 } });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders missingEvidenceStakes from DTO", () => {
    renderWithReport({ ...BASE_REPORT, summary: { ...BASE_REPORT.summary, missingEvidenceStakes: 1 } });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders schemaVersion from DTO", () => {
    renderWithReport(BASE_REPORT);
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("renders chainId 369 from DTO", () => {
    renderWithReport(BASE_REPORT);
    expect(screen.getByText("369")).toBeInTheDocument();
  });

  it("renders sourceFamily from DTO", () => {
    renderWithReport(BASE_REPORT);
    expect(screen.getByText("HEXMINING")).toBeInTheDocument();
  });

  it("stakeReadIsComplete: false is surfaced clearly", () => {
    renderWithReport({
      ...BASE_REPORT,
      summary: { ...BASE_REPORT.summary, stakeReadIsComplete: false },
    });
    expect(screen.getByText(/false — read may be incomplete/i)).toBeInTheDocument();
  });

  it("stakeReadIsComplete: true shows true chip", () => {
    renderWithReport(BASE_REPORT);
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("stakeReadWarnings list renders when present", () => {
    renderWithReport({
      ...BASE_REPORT,
      summary: {
        ...BASE_REPORT.summary,
        stakeReadWarnings: ["hexmining-read-warn-partial", "hexmining-read-warn-rpc-timeout"],
      },
    });
    expect(screen.getByText("hexmining-read-warn-partial")).toBeInTheDocument();
    expect(screen.getByText("hexmining-read-warn-rpc-timeout")).toBeInTheDocument();
  });
});

// ── Per-stake table rendering ──────────────────────────────────────────────────────────

describe("EvidenceMissingDebug — per-stake table", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderWithStakes(stakes: HexMiningEvidenceCoverageStakeDto[]) {
    const report: HexMiningEvidenceCoverageReportDto = {
      ...BASE_REPORT,
      summary: {
        ...BASE_REPORT.summary,
        totalActiveStakes: stakes.length,
        coveredStakes: stakes.filter((s) => s.covered).length,
        missingEvidenceStakes: stakes.filter((s) => !s.covered && s.missingReason !== "no_elapsed_days").length,
      },
      stakes,
    };
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeSuccessQuery(report) as never);
    const { getByLabelText } = render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    const input = getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
  }

  it("covered stake row renders observationId", () => {
    renderWithStakes([COVERED_STAKE]);
    expect(screen.getByText("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBeInTheDocument();
  });

  it("covered stake row renders stakeId", () => {
    renderWithStakes([COVERED_STAKE]);
    expect(screen.getByText("99001")).toBeInTheDocument();
  });

  it("missing stake row renders missingReason", () => {
    renderWithStakes([MISSING_STAKE]);
    expect(screen.getByText("missing_exact_observation")).toBeInTheDocument();
  });

  it("missing stake row shows '—' for observationId when absent", () => {
    renderWithStakes([MISSING_STAKE]);
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it("covered stake row shows '—' for missingReason when null", () => {
    renderWithStakes([COVERED_STAKE]);
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it("no_elapsed_days missingReason does not imply missing yield or zero yield", () => {
    renderWithStakes([NO_ELAPSED_STAKE]);
    expect(screen.getByText("no_elapsed_days")).toBeInTheDocument();
    // the phrase "yield is zero" must not appear in any element that is purely that phrase
    // (the page has "Missing evidence does not mean yield is zero" which is expected copy)
    // we verify no element says only "yield is zero"
    const elements = screen.queryAllByText(/^yield is zero$/i);
    expect(elements).toHaveLength(0);
    // the phrase "missing yield" must not appear
    expect(screen.queryAllByText(/missing yield/i)).toHaveLength(0);
  });

  it("renders lockedDay, currentDay, rangeStartDay, rangeEndDay from stake DTO", () => {
    renderWithStakes([COVERED_STAKE]);
    // These values appear in the stake table rows; getAllByText handles multiple occurrences
    expect(screen.getAllByText("5000").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("5300").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("5299").length).toBeGreaterThanOrEqual(1);
  });

  it("empty stakes array shows empty state, not a table", () => {
    renderWithStakes([]);
    expect(screen.getByText("No active native pHEX stakes found")).toBeInTheDocument();
  });
});

// ── Error state ─────────────────────────────────────────────────────────────────────

describe("EvidenceMissingDebug — error state", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders error message when query fails", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(
      makeErrorQuery(new Error("upstream error")) as never,
    );
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    const input = screen.getByLabelText("Wallet address");
    fireEvent.change(input, { target: { value: VALID_ADDRESS } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/upstream error/i)).toBeInTheDocument();
  });
});

// ── Architecture guardrails ────────────────────────────────────────────────────────────

describe("EvidenceMissingDebug — no forbidden UI language", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not render pricing language", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/USD/i)).not.toBeInTheDocument();
  });

  it("does not render estimated yield values", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.queryByText(/estimated yield/i)).not.toBeInTheDocument();
  });

  it("does not render PnL or valuation language", () => {
    vi.mocked(useHexMiningEvidenceMissingQuery).mockReturnValue(makeIdleQuery() as never);
    render(<EvidenceMissingDebug />, { wrapper: makeWrapper() });
    expect(screen.queryByText(/unrealized pnl/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/realized pnl/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/total value/i)).not.toBeInTheDocument();
  });
});
