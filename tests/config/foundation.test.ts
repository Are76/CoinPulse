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
    expect(PULSECHAIN_REFERENCE.rpcUrl).toBe("https://rpc.pulsechainstats.com");
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
    process.env.PULSECHAIN_RPC_URL = "https://rpc.pulsechainstats.com";

    const { createPublicClientForChain: createClient } = await import(
      "@/services/chains/public-client"
    );

    expect(createClient().chain?.id).toBe(369);
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
