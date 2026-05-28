import type { RpcFailureTaxonomy } from "@/services/rpc/rpc-failure-taxonomy";

export const RPC_RETRY_ACTIONS = ["retry", "retry_with_smaller_range", "do_not_retry"] as const;

export type RpcRetryAction = (typeof RPC_RETRY_ACTIONS)[number];

export type RpcRetryPolicyDecision = {
  action: RpcRetryAction;
  delayMs: number;
  reason: string;
  nextAttempt: number;
  failureCode: RpcFailureTaxonomy["code"];
};

type DecideRpcRetryPolicyArgs = {
  failure: RpcFailureTaxonomy;
  attempt: number;
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4_000;

export function decideRpcRetryPolicy(args: DecideRpcRetryPolicyArgs): RpcRetryPolicyDecision {
  const attempt = Math.max(0, args.attempt);
  const maxAttempts = Math.max(0, args.maxAttempts);
  const baseDelayMs = Math.max(0, args.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(0, args.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const canRetry = args.failure.retryable && attempt < maxAttempts;

  if (args.failure.code === "unknown") {
    return buildDecision(args.failure, "do_not_retry", 0, attempt + 1, "unknown_failure_not_retryable");
  }

  if (!args.failure.retryable) {
    return buildDecision(args.failure, "do_not_retry", 0, attempt + 1, "failure_not_retryable");
  }

  if (!canRetry) {
    return buildDecision(args.failure, "do_not_retry", 0, attempt + 1, "max_attempts_reached");
  }

  const delayMs = computeBoundedBackoffDelay({ attempt, baseDelayMs, maxDelayMs });

  if (args.failure.code === "block_range_too_large") {
    return buildDecision(args.failure, "retry_with_smaller_range", delayMs, attempt + 1, "block_range_too_large");
  }

  return buildDecision(args.failure, "retry", delayMs, attempt + 1, "retryable_failure");
}

function computeBoundedBackoffDelay(args: { attempt: number; baseDelayMs: number; maxDelayMs: number }): number {
  const exponential = args.baseDelayMs * 2 ** args.attempt;
  return Math.min(args.maxDelayMs, exponential);
}

function buildDecision(
  failure: RpcFailureTaxonomy,
  action: RpcRetryAction,
  delayMs: number,
  nextAttempt: number,
  reason: string,
): RpcRetryPolicyDecision {
  return {
    action,
    delayMs,
    reason,
    nextAttempt,
    failureCode: failure.code,
  };
}
