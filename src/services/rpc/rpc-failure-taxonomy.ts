export const RPC_FAILURE_CODES = [
  "rate_limited",
  "timeout",
  "network_unreachable",
  "provider_unavailable",
  "invalid_response",
  "execution_reverted",
  "block_range_too_large",
  "provider_disagreement",
  "unknown",
] as const;

export type RpcFailureCode = (typeof RPC_FAILURE_CODES)[number];
export type RpcFailureSeverity = "warning" | "error";

export type RpcFailureTaxonomy = {
  code: RpcFailureCode;
  message: string;
  retryable: boolean;
  severity: RpcFailureSeverity;
  provider?: string;
};

type ClassifyRpcFailureArgs = {
  error: unknown;
  provider?: string;
};

export function classifyRpcFailure(args: ClassifyRpcFailureArgs): RpcFailureTaxonomy {
  const detail = normalizeError(args.error);

  if (detail.statusCode === 429 || detail.includes("rate limit") || detail.includes("too many requests")) {
    return buildFailure("rate_limited", args.provider);
  }
  if (detail.includes("timeout") || detail.includes("timed out") || detail.includes("aborted")) {
    return buildFailure("timeout", args.provider);
  }
  if (detail.includes("enotfound") || detail.includes("econnrefused") || detail.includes("failed to fetch") || detail.includes("networkerror")) {
    return buildFailure("network_unreachable", args.provider);
  }
  if (detail.statusCode === 502 || detail.statusCode === 503 || detail.statusCode === 504 || detail.includes("service unavailable") || detail.includes("bad gateway") || detail.includes("gateway timeout")) {
    return buildFailure("provider_unavailable", args.provider);
  }
  if (detail.includes("invalid json") || detail.includes("malformed") || detail.includes("invalid response")) {
    return buildFailure("invalid_response", args.provider);
  }
  if (detail.includes("execution reverted") || detail.includes("reverted")) {
    return buildFailure("execution_reverted", args.provider);
  }
  if (detail.includes("block range") || detail.includes("query returned more than") || detail.includes("too many blocks")) {
    return buildFailure("block_range_too_large", args.provider);
  }
  if (detail.includes("provider disagreement") || detail.includes("inconsistent provider result")) {
    return buildFailure("provider_disagreement", args.provider);
  }

  return buildFailure("unknown", args.provider);
}

const FAILURE_METADATA: Record<RpcFailureCode, { message: string; retryable: boolean; severity: RpcFailureSeverity }> = {
  rate_limited: { message: "RPC provider rate limit reached.", retryable: true, severity: "warning" },
  timeout: { message: "RPC request timed out.", retryable: true, severity: "warning" },
  network_unreachable: { message: "RPC network is currently unreachable.", retryable: true, severity: "warning" },
  provider_unavailable: { message: "RPC provider is temporarily unavailable.", retryable: true, severity: "warning" },
  invalid_response: { message: "RPC provider returned an invalid response.", retryable: false, severity: "error" },
  execution_reverted: { message: "RPC call execution reverted.", retryable: false, severity: "error" },
  block_range_too_large: { message: "Requested block range is too large for provider limits.", retryable: true, severity: "warning" },
  provider_disagreement: { message: "RPC providers returned conflicting results.", retryable: false, severity: "error" },
  unknown: { message: "Unexpected RPC failure.", retryable: false, severity: "error" },
};

function buildFailure(code: RpcFailureCode, provider?: string): RpcFailureTaxonomy {
  const metadata = FAILURE_METADATA[code];
  return { code, provider, message: metadata.message, retryable: metadata.retryable, severity: metadata.severity };
}

function normalizeError(error: unknown): { includes: (token: string) => boolean; statusCode?: number } {
  const candidates: string[] = [];
  let statusCode: number | undefined;

  if (error instanceof Error) candidates.push(error.message);
  if (typeof error === "string") candidates.push(error);

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") candidates.push(record.message);
    if (typeof record.status === "number") statusCode = record.status;
    if (typeof record.code === "string") candidates.push(record.code);
    if (typeof record.details === "string") candidates.push(record.details);
  }

  const normalized = candidates.join(" ").toLowerCase();
  return { statusCode, includes: (token: string) => normalized.includes(token.toLowerCase()) };
}
