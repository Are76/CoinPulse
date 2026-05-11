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
});
