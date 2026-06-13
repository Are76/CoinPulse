import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PHEX_ADDRESS,
  PHEX_DECIMALS,
  PULSECHAIN_NATIVE_ASSET_ID,
} from "@/config/assets";
import { PULSECHAIN_CHAIN, PULSECHAIN_REFERENCE } from "@/config/chains";
import { CORE_PROTOCOLS } from "@/config/protocols";
import { createPublicClientForChain } from "@/services/chains/public-client";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("foundation config", () => {
  it("defines PulseChain asset identity invariants", () => {
    expect(PULSECHAIN_NATIVE_ASSET_ID).toBe("chain:369:native:PLS");
    expect(PHEX_ADDRESS).toBe("0x2b591e99afe9f32eaa6214f7b7629768c40eeb39");
    expect(PHEX_DECIMALS).toBe(8);
  });

  it("PULSECHAIN_REFERENCE has no hardcoded rpcUrl property", () => {
    expect("rpcUrl" in PULSECHAIN_REFERENCE).toBe(false);
  });

  it("PULSECHAIN_CHAIN has no hardcoded default RPC URL", () => {
    expect(PULSECHAIN_CHAIN.rpcUrls.default.http).toHaveLength(0);
  });

  it("keeps the PulseChain chain as the default public client target", () => {
    const client = createPublicClientForChain();

    expect(PULSECHAIN_CHAIN.id).toBe(369);
    expect(client.chain?.id).toBe(369);
  });

  it("allows chain config import without database or redis env", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;

    const { PULSECHAIN_CHAIN: importedChain } = await import("@/config/chains");

    expect(importedChain.id).toBe(369);
  });

  it("allows public client import with rpc env only", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    process.env.PULSECHAIN_RPC_URL = "https://rpc.example.invalid";

    const { createPublicClientForChain: createClient } = await import(
      "@/services/chains/public-client"
    );

    expect(createClient().chain?.id).toBe(369);
  });

  it("configured PULSECHAIN_RPC_URL is respected by rpcEnv", async () => {
    const testUrl = "https://operator-rpc.example.invalid";
    process.env.PULSECHAIN_RPC_URL = testUrl;

    const { rpcEnv: loadedRpcEnv } = await import("@/lib/rpc-env");
    expect(loadedRpcEnv.PULSECHAIN_RPC_URL).toBe(testUrl);
  });

  it("missing PULSECHAIN_RPC_URL causes explicit configuration failure", async () => {
    delete process.env.PULSECHAIN_RPC_URL;
    await expect(import("@/lib/rpc-env")).rejects.toThrowError(/PULSECHAIN_RPC_URL/);
  });

  it("tracks only the core protocol constants for the bounded foundation slice", () => {
    expect(CORE_PROTOCOLS).toEqual(
      expect.objectContaining({
        pulsex: expect.objectContaining({
          slug: "pulsex",
        }),
        hex: expect.objectContaining({
          slug: "hex",
        }),
      }),
    );
  });
});
