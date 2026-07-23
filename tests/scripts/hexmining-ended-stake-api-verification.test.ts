// HexMining ended-stake API verification script — focused parse/exit-code tests.
//
// No network, no server, no DB. parseInput and classificationExitCode are pure.
//
// Verifies:
//   Import safety:
//     1. Importing the module does not execute main() or mutate process.exitCode.
//   parseInput:
//     2. Missing --wallet → ok:false
//     3. Malformed --wallet → ok:false
//     4. Flag given another flag as its value → ok:false (fail-fast)
//     5. Defaults base URL from OPERATOR_RUNNER_BASE_URL, else localhost:3000
//     6. --base-url overrides the env default
//     7. chainId defaults to 369 and lowercases the wallet
//     8. Non-369 --chain-id → ok:false (PulseChain-only guard)
//     9. Non-integer --chain-id → ok:false
//    10. A secret base URL value never appears in an error message
//   classificationExitCode:
//    11. PASS→0, WARN→2, FAIL→1

import { describe, expect, it } from "vitest";

import {
  parseInput,
  classificationExitCode,
} from "../../scripts/hexmining-ended-stake-api-verification";

const WALLET = "0x1111111111111111111111111111111111111111";

describe("hexmining-ended-stake-api-verification: import safety", () => {
  it("does not run main() or set a non-zero exit code on import", () => {
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });
});

describe("parseInput", () => {
  it("fails when --wallet is missing", () => {
    const result = parseInput([], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--wallet is required");
  });

  it("fails when --wallet is malformed", () => {
    const result = parseInput(["--wallet", "not-an-address"], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("0x-prefixed");
  });

  it("fails fast when a flag is given another flag as its value", () => {
    const result = parseInput(["--wallet", "--base-url"], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--wallet requires a value");
  });

  it("defaults base URL from OPERATOR_RUNNER_BASE_URL when set", () => {
    const result = parseInput(["--wallet", WALLET], {
      OPERATOR_RUNNER_BASE_URL: "http://example.test:4000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.baseUrl).toBe("http://example.test:4000");
  });

  it("defaults base URL to localhost:3000 when env is unset", () => {
    const result = parseInput(["--wallet", WALLET], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.baseUrl).toBe("http://localhost:3000");
  });

  it("lets an explicit --base-url override the env default", () => {
    const result = parseInput(["--wallet", WALLET, "--base-url", "http://override:9000"], {
      OPERATOR_RUNNER_BASE_URL: "http://example.test:4000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.baseUrl).toBe("http://override:9000");
  });

  it("defaults chainId to 369 and lowercases the wallet", () => {
    const result = parseInput(["--wallet", WALLET.toUpperCase().replace("0X", "0x")], {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.chainId).toBe(369);
      expect(result.input.wallet).toBe(WALLET);
    }
  });

  it("rejects a non-369 chainId (PulseChain-only)", () => {
    const result = parseInput(["--wallet", WALLET, "--chain-id", "1"], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("369");
  });

  it("rejects a non-integer chainId", () => {
    const result = parseInput(["--wallet", WALLET, "--chain-id", "369.5"], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("positive integer");
  });

  it("never leaks a base URL value in an error message", () => {
    const secret = "https://secret-host.internal:8443";
    // Force an error path (bad chain) while a secret base URL is present.
    const result = parseInput(["--wallet", WALLET, "--base-url", secret, "--chain-id", "1"], {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("secret-host.internal");
      expect(result.error).not.toContain("8443");
    }
  });
});

describe("classificationExitCode", () => {
  it("maps PASS→0, WARN→2, FAIL→1", () => {
    expect(classificationExitCode("PASS")).toBe(0);
    expect(classificationExitCode("WARN")).toBe(2);
    expect(classificationExitCode("FAIL")).toBe(1);
  });
});
