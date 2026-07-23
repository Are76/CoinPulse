// HexMining ended-stake historical-state recovery script — focused parse/exit-code tests.
//
// No network, no server, no DB. parseInput and resultExitCode are pure.
//
// Verifies:
//   Import safety:
//     1. Importing the module does not execute main() or mutate process.exitCode.
//   parseInput:
//     2. Missing --wallet → ok:false
//     3. Malformed --wallet → ok:false
//     4. Flag given another flag as its value → ok:false (fail-fast)
//     5. --execute is a boolean flag (no value consumed)
//     6. dry-run is the default (execute:false) when --execute is absent
//     7. chainId defaults to 369 and lowercases the wallet
//     8. Non-369 --chain-id → ok:false (PulseChain-only guard)
//     9. Non-integer --chain-id → ok:false
//    10. Missing RPC URL (no --rpc-url, no env var) → ok:false
//    11. --rpc-url overrides the env default
//    12. A secret RPC URL value never appears in an error message
//   resultExitCode:
//    13. ok:false → 2
//    14. ok:true, totalFailures:0 → 0
//    15. ok:true, totalFailures>0 → 1

import { describe, expect, it } from "vitest";

import {
  parseInput,
  resultExitCode,
} from "../../scripts/hexmining-ended-stake-historical-state-recovery";

const WALLET = "0x1111111111111111111111111111111111111111";
const RPC_URL = "https://rpc.example.test";

describe("hexmining-ended-stake-historical-state-recovery: import safety", () => {
  it("does not run main() or set a non-zero exit code on import", () => {
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });
});

describe("parseInput", () => {
  it("fails when --wallet is missing", () => {
    const result = parseInput(["--rpc-url", RPC_URL], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--wallet is required");
  });

  it("fails when --wallet is malformed", () => {
    const result = parseInput(["--wallet", "not-an-address", "--rpc-url", RPC_URL], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("0x-prefixed");
  });

  it("fails fast when a flag is given another flag as its value", () => {
    const result = parseInput(["--wallet", "--rpc-url"], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--wallet requires a value");
  });

  it("treats --execute as a boolean flag that consumes no value", () => {
    const result = parseInput(["--wallet", WALLET, "--execute", "--rpc-url", RPC_URL], {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.execute).toBe(true);
      expect(result.input.rpcUrl).toBe(RPC_URL);
    }
  });

  it("defaults to dry-run (execute: false) when --execute is absent", () => {
    const result = parseInput(["--wallet", WALLET, "--rpc-url", RPC_URL], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.execute).toBe(false);
  });

  it("defaults chainId to 369 and lowercases the wallet", () => {
    const result = parseInput(
      ["--wallet", WALLET.toUpperCase().replace("0X", "0x"), "--rpc-url", RPC_URL],
      {},
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.chainId).toBe(369);
      expect(result.input.wallet).toBe(WALLET);
    }
  });

  it("rejects a non-369 chainId (PulseChain-only)", () => {
    const result = parseInput(
      ["--wallet", WALLET, "--chain-id", "1", "--rpc-url", RPC_URL],
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("369");
  });

  it("rejects a non-integer chainId", () => {
    const result = parseInput(
      ["--wallet", WALLET, "--chain-id", "369.5", "--rpc-url", RPC_URL],
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("positive integer");
  });

  it("requires an RPC URL from --rpc-url or PULSECHAIN_RPC_URL", () => {
    const result = parseInput(["--wallet", WALLET], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("PULSECHAIN_RPC_URL");
  });

  it("falls back to the PULSECHAIN_RPC_URL env var when --rpc-url is absent", () => {
    const result = parseInput(["--wallet", WALLET], { PULSECHAIN_RPC_URL: RPC_URL });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.rpcUrl).toBe(RPC_URL);
  });

  it("lets an explicit --rpc-url override the env default", () => {
    const result = parseInput(["--wallet", WALLET, "--rpc-url", "https://override.test"], {
      PULSECHAIN_RPC_URL: RPC_URL,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.rpcUrl).toBe("https://override.test");
  });

  it("never leaks an RPC URL value in an error message", () => {
    const secret = "https://secret-host.internal:8443/abc123";
    const result = parseInput(
      ["--wallet", WALLET, "--rpc-url", secret, "--chain-id", "1"],
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("secret-host.internal");
      expect(result.error).not.toContain("8443");
    }
  });
});

describe("resultExitCode", () => {
  it("maps ok:false → 2", () => {
    expect(resultExitCode({ ok: false, code: "x" })).toBe(2);
  });

  it("maps ok:true with zero failures → 0", () => {
    expect(
      resultExitCode({
        ok: true,
        dryRun: true,
        scanned: 0,
        planned: 0,
        alreadyComplete: 0,
        recovered: 0,
        updated: 0,
        noMatch: 0,
        multipleMatch: 0,
        concurrentMatchingCompletion: 0,
        concurrentConflict: 0,
        stateChanged: 0,
        observationMissing: 0,
        rpcFailures: 0,
        validationFailures: 0,
        totalFailures: 0,
        outcomes: [],
      }),
    ).toBe(0);
  });

  it("maps ok:true with any failures → 1", () => {
    expect(
      resultExitCode({
        ok: true,
        dryRun: true,
        scanned: 1,
        planned: 1,
        alreadyComplete: 0,
        recovered: 0,
        updated: 0,
        noMatch: 1,
        multipleMatch: 0,
        concurrentMatchingCompletion: 0,
        concurrentConflict: 0,
        stateChanged: 0,
        observationMissing: 0,
        rpcFailures: 0,
        validationFailures: 0,
        totalFailures: 1,
        outcomes: [],
      }),
    ).toBe(1);
  });
});
