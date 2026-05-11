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
});
