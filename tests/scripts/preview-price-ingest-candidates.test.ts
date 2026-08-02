// Wallet-scoped price-ingest candidate preview CLI — focused unit tests.
//
// Only parseInput/checkEnv are exercised directly (matches the deferred-import
// pattern used by other operator scripts, e.g. scripts/repair-fabricated-token-transfers.ts).
// No live database, no RPC, no server-only service import happens at test-collection time.

import { describe, expect, it } from "vitest";

import {
  checkEnv,
  parseInput,
  PREVIEW_WARNINGS,
} from "../../scripts/preview-price-ingest-candidates";

const VALID_WALLET = "0x1111111111111111111111111111111111111111";

describe("preview-price-ingest-candidates: import safety", () => {
  it("importing the module does not execute main() or mutate process.exitCode", () => {
    expect(process.exitCode).toBeFalsy();
  });
});

describe("preview-price-ingest-candidates: parseInput", () => {
  it("accepts a valid wallet and chainId 369", () => {
    const result = parseInput(["--wallet", VALID_WALLET, "--chain-id", "369"]);
    expect(result).toEqual({
      ok: true,
      input: { wallet: VALID_WALLET.toLowerCase(), chainId: 369 },
    });
  });

  it("lowercases the wallet address", () => {
    const mixedCase = "0xAbCdEf1234567890AbCdEf1234567890aBcDeF12";
    const result = parseInput(["--wallet", mixedCase, "--chain-id", "369"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.wallet).toBe(mixedCase.toLowerCase());
    }
  });

  it("rejects a missing --wallet", () => {
    const result = parseInput(["--chain-id", "369"]);
    expect(result).toEqual({ ok: false, error: "--wallet is required" });
  });

  it("rejects a malformed wallet address", () => {
    const result = parseInput(["--wallet", "not-an-address", "--chain-id", "369"]);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing --chain-id", () => {
    const result = parseInput(["--wallet", VALID_WALLET]);
    expect(result).toEqual({ ok: false, error: "--chain-id is required" });
  });

  it("rejects an unsupported chainId", () => {
    const result = parseInput(["--wallet", VALID_WALLET, "--chain-id", "1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/369/);
    }
  });

  it("rejects a non-integer chainId", () => {
    const result = parseInput(["--wallet", VALID_WALLET, "--chain-id", "abc"]);
    expect(result.ok).toBe(false);
  });
});

describe("preview-price-ingest-candidates: checkEnv", () => {
  it("returns ok:true when all required vars are present", () => {
    expect(checkEnv({ DATABASE_URL: "postgres://x", REDIS_URL: "redis://x" })).toEqual({
      ok: true,
    });
  });

  it("returns ok:false with DATABASE_URL in missing when absent", () => {
    const result = checkEnv({ REDIS_URL: "redis://x" });
    expect(result).toEqual({ ok: false, missing: ["DATABASE_URL"] });
  });

  it("returns ok:false with REDIS_URL in missing when absent", () => {
    const result = checkEnv({ DATABASE_URL: "postgres://x" });
    expect(result).toEqual({ ok: false, missing: ["REDIS_URL"] });
  });

  it("returns all missing vars when both are absent", () => {
    const result = checkEnv({});
    expect(result).toEqual({ ok: false, missing: ["DATABASE_URL", "REDIS_URL"] });
  });
});

describe("preview-price-ingest-candidates: warnings", () => {
  it("declares no RPC, no ingestion, no writes, and mandates manual review", () => {
    const joined = PREVIEW_WARNINGS.join(" ").toLowerCase();
    expect(joined).toMatch(/no rpc call/);
    expect(joined).toMatch(/no price ingestion/);
    expect(joined).toMatch(/no priceobservation/i);
    expect(joined).toMatch(/manual operator review/);
    expect(joined).toMatch(/does not prove priceability/);
  });

  it("contains no secret-shaped values (env values, connection strings)", () => {
    const joined = PREVIEW_WARNINGS.join(" ");
    expect(joined).not.toMatch(/postgres:\/\//);
    expect(joined).not.toMatch(/DATABASE_URL=/);
    expect(joined).not.toMatch(/REDIS_URL=/);
  });
});
