import { describe, expect, it } from "vitest";

import {
  buildWalletNavHref,
  isSupportedNavChainId,
  parseChainIdParam,
  parseWalletNavContext,
} from "@/lib/navigation/wallet-query-params";

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";

// ── parseChainIdParam ─────────────────────────────────────────────────────────

describe("parseChainIdParam", () => {
  it("parses a plain positive integer", () => {
    expect(parseChainIdParam("369")).toBe(369);
  });

  it("trims surrounding whitespace", () => {
    expect(parseChainIdParam(" 369 ")).toBe(369);
  });

  it("accepts leading zeros as the same integer", () => {
    expect(parseChainIdParam("00369")).toBe(369);
  });

  it("rejects null and empty strings", () => {
    expect(parseChainIdParam(null)).toBeNull();
    expect(parseChainIdParam("")).toBeNull();
    expect(parseChainIdParam("   ")).toBeNull();
  });

  it("rejects zero", () => {
    expect(parseChainIdParam("0")).toBeNull();
  });

  it("rejects negative numbers", () => {
    expect(parseChainIdParam("-1")).toBeNull();
  });

  it("rejects decimals", () => {
    expect(parseChainIdParam("1.5")).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parseChainIdParam("abc")).toBeNull();
    expect(parseChainIdParam("369abc")).toBeNull();
    expect(parseChainIdParam("0x171")).toBeNull();
  });

  it("rejects unsafe-integer magnitudes", () => {
    expect(parseChainIdParam("999999999999999999999999")).toBeNull();
  });
});

// ── isSupportedNavChainId ─────────────────────────────────────────────────────

describe("isSupportedNavChainId", () => {
  it("accepts PulseChain (369)", () => {
    expect(isSupportedNavChainId(369)).toBe(true);
  });

  it("rejects chains outside SUPPORTED_CHAINS", () => {
    expect(isSupportedNavChainId(1)).toBe(false);
    expect(isSupportedNavChainId(8453)).toBe(false);
  });
});

// ── parseWalletNavContext ─────────────────────────────────────────────────────

describe("parseWalletNavContext", () => {
  it("parses a valid walletAddress + supported chainId", () => {
    const params = new URLSearchParams({ walletAddress: VALID_ADDRESS, chainId: "369" });
    expect(parseWalletNavContext(params)).toEqual({
      walletAddress: VALID_ADDRESS,
      chainId: 369,
    });
  });

  it("trims the walletAddress", () => {
    const params = new URLSearchParams({ walletAddress: `  ${VALID_ADDRESS}  `, chainId: "369" });
    expect(parseWalletNavContext(params)?.walletAddress).toBe(VALID_ADDRESS);
  });

  it("returns null when searchParams are absent", () => {
    expect(parseWalletNavContext(null)).toBeNull();
    expect(parseWalletNavContext(undefined)).toBeNull();
  });

  it("returns null when walletAddress is missing or blank", () => {
    expect(parseWalletNavContext(new URLSearchParams({ chainId: "369" }))).toBeNull();
    expect(
      parseWalletNavContext(new URLSearchParams({ walletAddress: "   ", chainId: "369" })),
    ).toBeNull();
  });

  it("returns null when chainId is missing", () => {
    expect(
      parseWalletNavContext(new URLSearchParams({ walletAddress: VALID_ADDRESS })),
    ).toBeNull();
  });

  it("returns null for non-integer chainId", () => {
    expect(
      parseWalletNavContext(
        new URLSearchParams({ walletAddress: VALID_ADDRESS, chainId: "abc" }),
      ),
    ).toBeNull();
    expect(
      parseWalletNavContext(
        new URLSearchParams({ walletAddress: VALID_ADDRESS, chainId: "1.5" }),
      ),
    ).toBeNull();
  });

  it("returns null for unsupported chainId", () => {
    expect(
      parseWalletNavContext(new URLSearchParams({ walletAddress: VALID_ADDRESS, chainId: "1" })),
    ).toBeNull();
  });

  it("ignores unrelated parameters when parsing", () => {
    const params = new URLSearchParams({
      walletAddress: VALID_ADDRESS,
      chainId: "369",
      assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
      foo: "bar",
    });
    expect(parseWalletNavContext(params)).toEqual({
      walletAddress: VALID_ADDRESS,
      chainId: 369,
    });
  });
});

// ── buildWalletNavHref ────────────────────────────────────────────────────────

describe("buildWalletNavHref", () => {
  it("returns the plain path when there is no context", () => {
    expect(buildWalletNavHref("/transactions", null)).toBe("/transactions");
  });

  it("preserves the destination path and appends walletAddress + chainId", () => {
    const href = buildWalletNavHref("/transactions", {
      walletAddress: VALID_ADDRESS,
      chainId: 369,
    });
    expect(href).toBe(`/transactions?walletAddress=${VALID_ADDRESS}&chainId=369`);
  });

  it("works for the dashboard root path", () => {
    const href = buildWalletNavHref("/", { walletAddress: VALID_ADDRESS, chainId: 369 });
    expect(href).toBe(`/?walletAddress=${VALID_ADDRESS}&chainId=369`);
  });

  it("carries only walletAddress and chainId — never assetId or other params", () => {
    const source = new URLSearchParams({
      walletAddress: VALID_ADDRESS,
      chainId: "369",
      assetId: "chain:369:erc20:0x2222222222222222222222222222222222222222",
      cursor: "abc",
    });
    const href = buildWalletNavHref("/hexmining", parseWalletNavContext(source));
    expect(href).toBe(`/hexmining?walletAddress=${VALID_ADDRESS}&chainId=369`);
    expect(href).not.toContain("assetId");
    expect(href).not.toContain("cursor");
  });

  it("URL-encodes the walletAddress value", () => {
    const href = buildWalletNavHref("/", { walletAddress: "0xabc def", chainId: 369 });
    expect(href).toBe("/?walletAddress=0xabc+def&chainId=369");
  });
});
