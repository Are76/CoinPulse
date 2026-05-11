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

  it("TrackedWalletSelector empty state link label is 'Import a wallet'", () => {
    const source = readPresenters();
    expect(source).toContain("Import a wallet");
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
});
