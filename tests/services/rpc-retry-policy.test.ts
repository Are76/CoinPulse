import { describe, expect, it } from "vitest";

import { decideRpcRetryPolicy } from "@/services/rpc/rpc-retry-policy";
import type { RpcFailureTaxonomy } from "@/services/rpc/rpc-failure-taxonomy";

function failure(code: RpcFailureTaxonomy["code"], retryable: boolean): RpcFailureTaxonomy {
  return {
    code,
    retryable,
    severity: retryable ? "warning" : "error",
    message: `${code} message`,
  };
}

describe("decideRpcRetryPolicy", () => {
  it("retries rate_limited with deterministic bounded backoff", () => {
    const result = decideRpcRetryPolicy({
      failure: failure("rate_limited", true),
      attempt: 1,
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    });

    expect(result).toMatchObject({
      action: "retry",
      delayMs: 200,
      reason: "retryable_failure",
      nextAttempt: 2,
      failureCode: "rate_limited",
    });
  });

  it("retries timeout with deterministic bounded backoff", () => {
    const result = decideRpcRetryPolicy({
      failure: failure("timeout", true),
      attempt: 2,
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 500,
    });

    expect(result.action).toBe("retry");
    expect(result.delayMs).toBe(400);
    expect(result.failureCode).toBe("timeout");
  });

  it("retries network_unreachable with deterministic bounded backoff", () => {
    const result = decideRpcRetryPolicy({
      failure: failure("network_unreachable", true),
      attempt: 0,
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 1_000,
    });

    expect(result.action).toBe("retry");
    expect(result.delayMs).toBe(250);
    expect(result.failureCode).toBe("network_unreachable");
  });

  it("retries provider_unavailable with deterministic bounded backoff", () => {
    const result = decideRpcRetryPolicy({
      failure: failure("provider_unavailable", true),
      attempt: 3,
      maxAttempts: 6,
      baseDelayMs: 100,
      maxDelayMs: 700,
    });

    expect(result.action).toBe("retry");
    expect(result.delayMs).toBe(700);
    expect(result.failureCode).toBe("provider_unavailable");
  });

  it("returns retry_with_smaller_range for block_range_too_large before max attempts", () => {
    const result = decideRpcRetryPolicy({
      failure: failure("block_range_too_large", true),
      attempt: 1,
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    });

    expect(result.action).toBe("retry_with_smaller_range");
    expect(result.delayMs).toBe(200);
    expect(result.reason).toBe("block_range_too_large");
  });

  it("stops retryable failures once attempt reaches maxAttempts", () => {
    const result = decideRpcRetryPolicy({
      failure: failure("rate_limited", true),
      attempt: 3,
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    });

    expect(result).toMatchObject({
      action: "do_not_retry",
      delayMs: 0,
      reason: "max_attempts_reached",
      nextAttempt: 4,
      failureCode: "rate_limited",
    });
  });

  it("does not retry invalid_response", () => {
    const result = decideRpcRetryPolicy({ failure: failure("invalid_response", false), attempt: 0, maxAttempts: 3 });
    expect(result.action).toBe("do_not_retry");
    expect(result.failureCode).toBe("invalid_response");
  });

  it("does not retry execution_reverted", () => {
    const result = decideRpcRetryPolicy({ failure: failure("execution_reverted", false), attempt: 0, maxAttempts: 3 });
    expect(result.action).toBe("do_not_retry");
    expect(result.failureCode).toBe("execution_reverted");
  });

  it("does not retry provider_disagreement", () => {
    const result = decideRpcRetryPolicy({ failure: failure("provider_disagreement", false), attempt: 0, maxAttempts: 3 });
    expect(result.action).toBe("do_not_retry");
    expect(result.failureCode).toBe("provider_disagreement");
  });

  it("does not retry unknown", () => {
    const result = decideRpcRetryPolicy({ failure: failure("unknown", false), attempt: 0, maxAttempts: 3 });
    expect(result.action).toBe("do_not_retry");
    expect(result.failureCode).toBe("unknown");
  });

  it("never exceeds maxDelayMs", () => {
    const result = decideRpcRetryPolicy({
      failure: failure("timeout", true),
      attempt: 8,
      maxAttempts: 10,
      baseDelayMs: 100,
      maxDelayMs: 900,
    });

    expect(result.action).toBe("retry");
    expect(result.delayMs).toBe(900);
  });
});
