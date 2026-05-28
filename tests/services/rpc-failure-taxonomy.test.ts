import { describe, expect, it } from "vitest";

import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";

describe("classifyRpcFailure", () => {
  it("classifies HTTP 429 as rate_limited and retryable", () => {
    const result = classifyRpcFailure({ error: { status: 429, message: "Too many requests" }, provider: "pulsechain-rpc" });
    expect(result).toMatchObject({ code: "rate_limited", retryable: true, provider: "pulsechain-rpc" });
  });

  it("classifies timeout-like errors as timeout and retryable", () => {
    const result = classifyRpcFailure({ error: new Error("Request timed out while waiting for rpc") });
    expect(result.code).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("classifies network connectivity failures as network_unreachable and retryable", () => {
    const result = classifyRpcFailure({ error: { code: "ECONNREFUSED", message: "connection refused" } });
    expect(result.code).toBe("network_unreachable");
    expect(result.retryable).toBe(true);
  });

  it("classifies malformed payload failures as invalid_response and non-retryable", () => {
    const result = classifyRpcFailure({ error: new Error("invalid JSON payload from upstream") });
    expect(result.code).toBe("invalid_response");
    expect(result.retryable).toBe(false);
  });

  it("classifies execution revert failures without treating them as provider outage", () => {
    const result = classifyRpcFailure({ error: new Error("execution reverted: ERC20: transfer amount exceeds balance") });
    expect(result.code).toBe("execution_reverted");
    expect(result.retryable).toBe(false);
  });

  it("classifies oversized log range failures as block_range_too_large", () => {
    const result = classifyRpcFailure({ error: new Error("query returned more than 10000 results for block range") });
    expect(result.code).toBe("block_range_too_large");
    expect(result.retryable).toBe(true);
  });

  it("classifies provider disagreement for explicit diagnostics", () => {
    const result = classifyRpcFailure({ error: new Error("provider disagreement for latest block header") });
    expect(result.code).toBe("provider_disagreement");
    expect(result.retryable).toBe(false);
  });

  it("maps unknown errors to unknown with safe fallback message", () => {
    const result = classifyRpcFailure({ error: { foo: "bar" } });
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("Unexpected RPC failure.");
    expect(result.retryable).toBe(false);
    expect(result.message).not.toContain("bar");
  });
});
