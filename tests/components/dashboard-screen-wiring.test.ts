import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/dashboard/dashboard-screen.tsx",
);

const PRESENTERS_PATH = path.resolve(
  __dirname,
  "../../src/components/dashboard/dashboard-presenters.tsx",
);

function readScreen() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

function readPresenters() {
  return fs.readFileSync(PRESENTERS_PATH, "utf8");
}

describe("dashboard-screen wiring", () => {
  it("screen imports useTrackedWalletsQuery from the shared hook", () => {
    const source = readScreen();
    expect(source).toContain(
      'import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query"',
    );
  });

  it("screen does not call fetchTrackedWallets directly", () => {
    const source = readScreen();
    expect(source).not.toContain("fetchTrackedWallets");
  });

  it("screen renders TrackedWalletSelector", () => {
    const source = readScreen();
    expect(source).toContain("TrackedWalletSelector");
  });

  it("screen still contains WalletQueryForm for manual wallet entry", () => {
    const source = readScreen();
    expect(source).toContain("WalletQueryForm");
  });

  it("screen still has walletAddress and chainId form state", () => {
    const source = readScreen();
    expect(source).toContain("walletAddress");
    expect(source).toContain("chainId");
    expect(source).toContain("setWalletAddress");
    expect(source).toContain("setChainId");
  });

  it("handleSelectTrackedWallet sets address and chainId without calling submit", () => {
    const source = readScreen();
    expect(source).toContain("handleSelectTrackedWallet");
    expect(source).toContain("setWalletAddress(address)");
    expect(source).toContain("setChainId(selectedChainId)");
    // handleSelectTrackedWallet must not reference setSubmittedParams; submit is only
    // triggered by handleSubmit. We verify the handler body is limited to state setters.
    const handlerMatch = source.match(
      /function handleSelectTrackedWallet\([^)]*\)\s*\{([^}]*)\}/,
    );
    expect(handlerMatch).not.toBeNull();
    expect(handlerMatch?.[1]).not.toContain("setSubmittedParams");
    expect(handlerMatch?.[1]).not.toContain("resolveDashboardSubmission");
  });

  it("screen passes onSelectWallet to TrackedWalletSelector", () => {
    const source = readScreen();
    expect(source).toContain("onSelectWallet={handleSelectTrackedWallet}");
  });

  it("dashboard fetch is only triggered by handleSubmit, not by wallet selection", () => {
    const source = readScreen();
    // submit sets submittedParams; selection only sets address/chainId
    expect(source).toContain("function handleSubmit");
    expect(source).toContain("function handleSelectTrackedWallet");
  });

  it("presenters exports TrackedWalletSelector", () => {
    const source = readPresenters();
    expect(source).toContain("export function TrackedWalletSelector");
  });

  it("TrackedWalletSelector includes no tracked wallets empty message", () => {
    const source = readPresenters();
    expect(source).toContain("No tracked wallets yet");
  });

  it("TrackedWalletSelector empty state imports Link from next/link", () => {
    const source = readPresenters();
    expect(source).toContain('import Link from "next/link"');
  });

  it("TrackedWalletSelector empty state links to /debug/wallets/import", () => {
    const source = readPresenters();
    expect(source).toContain("/debug/wallets/import");
  });

  it("TrackedWalletSelector includes Unlabeled fallback for wallets without a label", () => {
    const source = readPresenters();
    expect(source).toContain("Unlabeled");
  });

  it("TrackedWalletSelector includes error fallback message", () => {
    const source = readPresenters();
    expect(source).toContain("Could not load tracked wallets");
  });

  it("TrackedWalletSelector includes loading message", () => {
    const source = readPresenters();
    expect(source).toContain("Loading tracked wallets");
  });

  it("screen computes selectedTrackedWalletLabel from tracked wallets state", () => {
    const source = readScreen();
    expect(source).toContain("selectedTrackedWalletLabel");
    expect(source).toContain("findTrackedWalletLabel");
  });

  it("screen passes selectedTrackedWalletLabel to WalletQueryForm", () => {
    const source = readScreen();
    expect(source).toContain("selectedTrackedWalletLabel={selectedTrackedWalletLabel}");
  });

  it("WalletQueryForm accepts selectedTrackedWalletLabel prop", () => {
    const source = readPresenters();
    expect(source).toContain("selectedTrackedWalletLabel");
  });

  it("WalletQueryForm renders helper message text referencing Load dashboard", () => {
    const source = readPresenters();
    expect(source).toContain("will be used when you click Load dashboard");
  });

  it("presenters exports MaterializationFreshnessSection", () => {
    const source = readPresenters();
    expect(source).toContain("export function MaterializationFreshnessSection");
  });

  it("MaterializationFreshnessSection consumes freshness.status", () => {
    const source = readPresenters();
    expect(source).toContain("freshness.status");
  });

  it("MaterializationFreshnessSection renders reason when present", () => {
    const source = readPresenters();
    expect(source).toContain("freshness.reason");
  });

  it("MaterializationFreshnessSection renders lastMaterializedAt via TimestampLabel", () => {
    const source = readPresenters();
    // Extract only the MaterializationFreshnessSection block so that TimestampLabel
    // references elsewhere in the file cannot cause a false-positive.
    const sectionStart = source.indexOf("export function MaterializationFreshnessSection");
    expect(sectionStart).not.toBe(-1);
    // Find the next exported function after the section start to bound the block.
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).toContain("TimestampLabel");
    expect(sectionSource).toContain('value={freshness.lastMaterializedAt}');
  });

  it("MaterializationFreshnessSection renders staleAfterSeconds when present", () => {
    const source = readPresenters();
    expect(source).toContain("freshness.staleAfterSeconds");
  });

  it("dashboard metadata links to the pricing status debug page", () => {
    const source = readPresenters();
    expect(source).toContain('href="/debug/prices/status"');
    expect(source).toContain("View pricing source status");
  });

  it("dashboard does not import or fetch pricing status directly", () => {
    const screenSource = readScreen();
    const presentersSource = readPresenters();
    expect(screenSource).not.toContain("usePricingStatusQuery");
    expect(presentersSource).not.toContain("usePricingStatusQuery");
    expect(screenSource).not.toContain("fetchPricingStatus");
    expect(presentersSource).not.toContain("fetchPricingStatus");
  });

  it("dashboard metadata link does not add external provider or RPC calls", () => {
    const source = `${readScreen()}\n${readPresenters()}`;
    expect(source).not.toContain("DexScreener");
    expect(source).not.toContain("CoinGecko");
    expect(source).not.toContain("GeckoTerminal");
    expect(source).not.toContain("Piteas");
    expect(source).not.toContain("Moralis");
    expect(source).not.toContain("PULSECHAIN_RPC_URL");
    expect(source).not.toContain("createPublicClient");
    expect(source).not.toContain("http(");
    expect(source).not.toContain("fetch(");
  });

  it("screen imports MaterializationFreshnessSection from dashboard-presenters", () => {
    const source = readScreen();
    expect(source).toContain("MaterializationFreshnessSection");
  });

  it("screen passes dashboard.materialization.freshness to MaterializationFreshnessSection", () => {
    const source = readScreen();
    expect(source).toContain("materialization.freshness");
  });

  it("presenters exports LedgerCoverageSection", () => {
    const source = readPresenters();
    expect(source).toContain("export function LedgerCoverageSection");
  });

  it("LedgerCoverageSection consumes ledgerCoverage.status", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function LedgerCoverageSection");
    expect(sectionStart).not.toBe(-1);
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).toContain("ledgerCoverage.status");
    expect(sectionSource).toContain('"covered"');
    expect(sectionSource).toContain('"partial"');
    expect(sectionSource).toContain('"Covered"');
    expect(sectionSource).toContain('"Partial"');
    expect(sectionSource).toContain('"Unknown"');
  });

  it("LedgerCoverageSection renders reason when present", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function LedgerCoverageSection");
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).toContain("ledgerCoverage.reason");
  });

  it("LedgerCoverageSection renders fromBlock when present", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function LedgerCoverageSection");
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).toContain("ledgerCoverage.fromBlock");
    expect(sectionSource).toContain("From block:");
  });

  it("LedgerCoverageSection renders toBlock when present", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function LedgerCoverageSection");
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).toContain("ledgerCoverage.toBlock");
    expect(sectionSource).toContain("To block:");
  });

  it("LedgerCoverageSection renders sourceFamilies when present", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function LedgerCoverageSection");
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).toContain("ledgerCoverage.sourceFamilies");
    expect(sectionSource).toContain("Sources:");
  });

  it("LedgerCoverageSection does not reference RPC, latest block, or frontend computation", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function LedgerCoverageSection");
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).not.toContain("rpc");
    expect(sectionSource).not.toContain("RPC");
    expect(sectionSource).not.toContain("latestBlock");
    expect(sectionSource).not.toContain("useQuery");
    expect(sectionSource).not.toContain("fetch(");
  });

  it("screen imports LedgerCoverageSection from dashboard-presenters", () => {
    const source = readScreen();
    expect(source).toContain("LedgerCoverageSection");
  });

  it("screen passes dashboard.ledgerCoverage to LedgerCoverageSection", () => {
    const source = readScreen();
    expect(source).toContain("ledgerCoverage={dashboardQuery.data.ledgerCoverage}");
  });

  it("presenters exports PnlCoverageSection", () => {
    const source = readPresenters();
    expect(source).toContain("export function PnlCoverageSection");
  });

  it("PnlCoverageSection consumes dashboard pnlCoverage fields only", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function PnlCoverageSection");
    expect(sectionStart).not.toBe(-1);
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);

    expect(sectionSource).toContain("pnlCoverage.status");
    expect(sectionSource).toContain("pnlCoverage.reasons");
    expect(sectionSource).toContain("pnlCoverage.affectedSections");
    expect(sectionSource).toContain("pnlCoverage.pricedPositionsCount");
    expect(sectionSource).toContain("pnlCoverage.unpricedPositionsCount");
    expect(sectionSource).toContain("pnlCoverage.unsupportedPositionsCount");
    expect(sectionSource).toContain("pnlCoverage.incompleteBasisPositionsCount");
    expect(sectionSource).toContain("pnlCoverage.stalePricePositionsCount");
    expect(sectionSource).toContain("pnlCoverage.sourceDisabledPositionsCount");
    expect(sectionSource).toContain("pnlCoverage.asOf");
    expect(sectionSource).toContain("TimestampLabel");

    expect(sectionSource).not.toContain("tokenPositions");
    expect(sectionSource).not.toContain("lpPositions");
    expect(sectionSource).not.toContain("stakePositions");
  });

  it("PnlCoverageSection maps backend status values to display labels", () => {
    const source = readPresenters();
    expect(source).toContain('case "valued"');
    expect(source).toContain('label: "Valued"');
    expect(source).toContain('case "partial"');
    expect(source).toContain('label: "Partial"');
    expect(source).toContain('case "unavailable"');
    expect(source).toContain('label: "Unavailable"');
    expect(source).toContain('case "unsupported"');
    expect(source).toContain('label: "Unsupported"');
    expect(source).toContain('case "unknown"');
    expect(source).toContain('label: "Unknown"');
  });

  it("screen imports PnlCoverageSection from dashboard-presenters", () => {
    const source = readScreen();
    expect(source).toContain("PnlCoverageSection");
  });

  it("screen passes dashboard.pnlCoverage to PnlCoverageSection", () => {
    const source = readScreen();
    expect(source).toContain("pnlCoverage={dashboardQuery.data.pnlCoverage}");
  });

  it("dashboard PnL coverage rendering avoids backend pricing and PnL service imports", () => {
    const source = `${readScreen()}\n${readPresenters()}`;
    expect(source).not.toContain("@/services/pricing");
    expect(source).not.toContain("@/services/pnl");
    expect(source).not.toContain('"@/services/pricing');
    expect(source).not.toContain('"@/services/pnl');
  });

  it("dashboard PnL coverage rendering does not compute coverage from position arrays", () => {
    const source = readPresenters();
    const sectionStart = source.indexOf("export function PnlCoverageSection");
    expect(sectionStart).not.toBe(-1);
    const nextExportIdx = source.indexOf("\nexport function ", sectionStart + 1);
    const sectionSource =
      nextExportIdx === -1 ? source.slice(sectionStart) : source.slice(sectionStart, nextExportIdx);
    expect(sectionSource).not.toContain("tokenPositions");
    expect(sectionSource).not.toContain("lpPositions");
    expect(sectionSource).not.toContain("stakePositions");
    expect(sectionSource).not.toContain("reduce");
    expect(sectionSource).not.toContain("filter");
  });

});

describe("dashboard-screen TanStack Query read migration", () => {
  it("screen imports useDashboardQuery from the shared hook, not ad-hoc fetch state", () => {
    const source = readScreen();
    expect(source).toContain(
      'import { useDashboardQuery } from "@/lib/query/use-dashboard-query"',
    );
    expect(source).not.toContain("fetchPortfolioDashboard");
  });

  it("screen imports useDebugHealthQuery from the shared hook", () => {
    const source = readScreen();
    expect(source).toContain(
      'import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query"',
    );
    expect(source).not.toContain("fetchDebugHealth");
  });

  it("screen imports useDebugStatusQuery from the shared hook", () => {
    const source = readScreen();
    expect(source).toContain(
      'import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query"',
    );
    expect(source).not.toContain("fetchDebugStatus");
  });

  it("dashboard query is enabled only when submittedParams is non-null", () => {
    const source = readScreen();
    // The hook must be called with enabled: submittedParams !== null
    expect(source).toContain("enabled: submittedParams !== null");
  });

  it("dashboard query is disabled before explicit submit (submittedParams starts null)", () => {
    const source = readScreen();
    // Initial state: submittedParams = null means enabled is false until Load dashboard
    expect(source).toContain("useState<SubmittedParams | null>(null)");
    expect(source).toContain("enabled: submittedParams !== null");
  });

  it("handleSubmit sets submittedParams to enable the dashboard query", () => {
    const source = readScreen();
    expect(source).toContain("setSubmittedParams(params)");
    // Selecting a wallet must NOT call setSubmittedParams
    const handlerMatch = source.match(
      /function handleSelectTrackedWallet\([^)]*\)\s*\{([^}]*)\}/,
    );
    expect(handlerMatch).not.toBeNull();
    expect(handlerMatch?.[1]).not.toContain("setSubmittedParams");
  });

  it("screen does not call fetch() directly for any dashboard reads", () => {
    const source = readScreen();
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("useEffect");
  });

  it("screen does not introduce balance, price, or PnL computation", () => {
    const source = readScreen();
    expect(source).not.toContain("parseFloat");
    expect(source).not.toContain("toFixed");
    expect(source).not.toContain(".reduce(");
    expect(source).not.toContain("balance *");
    expect(source).not.toContain("price *");
    expect(source).not.toContain("pnl =");
  });

  it("dashboard query key does not use ad-hoc inline key — routes through queryKeys.dashboard", () => {
    const source = readScreen();
    expect(source).toContain('import { queryKeys } from "@/lib/query/query-keys"');
    expect(source).toContain("queryKeys.dashboard(");
  });

  it("debug health and status refetch intervals are disabled on the dashboard (no polling)", () => {
    const source = readScreen();
    // Dashboard shows health/status as supporting metadata without active polling
    expect(source).toContain("DISABLE_REFETCH_INTERVAL");
    expect(source).toContain("refetchInterval: DISABLE_REFETCH_INTERVAL");
  });

  it("screen imports useQueryClient for cache management on explicit submit", () => {
    const source = readScreen();
    expect(source).toContain('import { useQueryClient } from "@tanstack/react-query"');
  });

  it("handleSubmit purges stale dashboard cache via queryClient.removeQueries to preserve always-shows-loading UX on explicit submit", () => {
    const source = readScreen();
    expect(source).toContain("queryClient.removeQueries(");
    expect(source).toContain("queryKey: queryKeys.dashboard(");
  });
});
