import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("env", () => {
  it("keeps only app-level runtime invariants in shared env", async () => {
    const { env } = await import("@/lib/env");
    const { rpcEnv } = await import("@/lib/rpc-env");

    expect(env.NODE_ENV).toBeDefined();
    expect("DEFAULT_CHAIN_ID" in env).toBe(false);
    expect("NORMALIZER_VERSION" in env).toBe(false);
    expect(() => new URL(rpcEnv.PULSECHAIN_RPC_URL)).not.toThrow();
  });

  it("requires infrastructure connection settings", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.PULSECHAIN_RPC_URL;

    await expect(import("@/lib/server-env")).rejects.toThrow();
    await expect(import("@/lib/rpc-env")).rejects.toThrow();
  });
});
