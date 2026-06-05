import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCREEN_PATH = path.resolve(
  __dirname,
  "../../src/components/wallets/wallet-import-screen.tsx",
);

function readSource() {
  return fs.readFileSync(SCREEN_PATH, "utf8");
}

describe("wallet-import-screen wiring", () => {
  it("imports useWalletImportMutation from the shared hook", () => {
    const source = readSource();

    expect(source).toContain(
      'import { useWalletImportMutation } from "@/lib/query/use-wallet-import-mutation";',
    );
  });

  it("does not call importWallet directly — all calls go through the mutation hook", () => {
    const source = readSource();

    expect(source).not.toContain("importWallet(");
  });

  it("uses mutateAsync not mutate", () => {
    const source = readSource();

    expect(source).toContain("walletImportMutation.mutateAsync({");
  });

  it("validates that wallet address is required before calling mutateAsync", () => {
    const source = readSource();

    expect(source).toContain('message: "Wallet address is required.",');
  });

  it("validates that chain ID must be a positive integer", () => {
    const source = readSource();

    expect(source).toContain('"Chain ID must be a positive integer."');
  });

  it("renders response.data not a hardcoded value", () => {
    const source = readSource();

    expect(source).toContain("payload: response.data");
    expect(source).toContain("JSON.stringify(state.payload, null, 2)");
  });

  it("uses idle/loading button text matching the spec", () => {
    const source = readSource();

    expect(source).toContain('"Importing..."');
    expect(source).toContain('"Import wallet"');
  });

  it("defaults chainId to 369", () => {
    const source = readSource();

    expect(source).toContain('DEFAULT_CHAIN_ID = "369"');
  });

  it("passes walletAddress and chainId to the mutation", () => {
    const source = readSource();

    expect(source).toContain("walletAddress: walletAddress.trim()");
    expect(source).toContain("chainId: parsedChainId.value");
  });

  it("renders success state with backend payload", () => {
    const source = readSource();

    expect(source).toContain('kind: "success"');
    expect(source).toContain("payload: response.data");
    expect(source).toContain("JSON.stringify(state.payload, null, 2)");
  });

  it("renders error state with backend error message", () => {
    const source = readSource();

    expect(source).toContain('kind: "error"');
    expect(source).toContain("getErrorMessage(error)");
    expect(source).toContain("getErrorDetails(error)");
    expect(source).toContain("instanceof ApiClientError");
  });

  it("does not compute balances, prices, PnL, or accounting values", () => {
    const source = readSource();

    expect(source).not.toMatch(/balance\s*[+\-*/]/);
    expect(source).not.toContain("computeBalance");
    expect(source).not.toContain("computePrice");
    expect(source).not.toContain("pnl");
    expect(source).not.toContain("DexScreener");
    expect(source).not.toContain("eth_call");
    expect(source).not.toContain("eth_getBalance");
  });

  it("does not load or invalidate dashboard after import", () => {
    const source = readSource();

    expect(source).not.toContain("useDashboard");
    expect(source).not.toContain('"dashboard"');
    expect(source).not.toContain("dashboard");
  });
});
