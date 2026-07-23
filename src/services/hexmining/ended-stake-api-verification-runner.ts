// ─── Purpose ────────────────────────────────────────────────────────────────────
//
// Operator verification tooling only. This is the ended-stake, DB/API counterpart
// of the native active-stake live verification runner. It drives the *existing*
// backend read path
//
//     GET /api/hexmining/ended-stakes → EndedHexStakeListDto
//
// against a running local server for a known PulseChain wallet, and assembles a
// factual PASS/WARN/FAIL report of what the canonical persisted observations look
// like when read through the shipped API contract.
//
// It is strictly READ-ONLY: it issues a single HTTP GET and never writes, never
// triggers discovery, and never calls RPC. Every assertion is a presence /
// consistency / scoping check on the backend DTO — never a numeric, financial,
// pricing, valuation, yield, or PnL comparison. It never fabricates rows: the
// report is built strictly from what the API returned.
//
// PostgreSQL is the source of truth being verified here. The runner asserts on
// the backend DTO only — it does not read RPC, does not compute any value, and
// does not consult any frontend state.

import type { EndedHexStakeListDto } from "@/services/hexmining/types";

const PULSECHAIN_CHAIN_ID = 369;

// Canonical raw unsigned-integer decimal string (uint72 range). stakeShares must
// remain a digit-only string end-to-end; anything else signals a coercion or
// serialization regression. Mirrors the discovery-side pattern intentionally.
const RAW_UNSIGNED_INTEGER_PATTERN = /^\d+$/;

// The incomplete-evidence warning the discovery pipeline attaches to a row that
// lacks START-time evidence. A row that is not complete must carry a warning so
// the degraded state is never silent.
const WARN_INCOMPLETE_START_EVIDENCE = "hexmining-ended-stake-lockedday-unknown";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EndedStakeApiVerificationInput = {
  chainId: number;
  walletAddress: string;
  baseUrl: string;
};

// Minimal fetch surface so the runner is deterministically testable and never
// couples to a specific HTTP client. The CLI wrapper injects global fetch.
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type EndedStakeApiVerificationDeps = {
  fetchImpl: FetchLike;
};

export type EndedStakeApiVerificationChecks = {
  apiReachable: boolean;
  envelopeShapeValid: boolean;
  allScopedToRequestedChain: boolean;
  allScopedToRequestedWallet: boolean;
  everyCompleteHasLockedDay: boolean;
  everyCompleteHasDigitOnlyStakeShares: boolean;
  everyIncompleteHasWarning: boolean;
  stakeSharesAlwaysStringOrNull: boolean;
  noDuplicateObservationIdentities: boolean;
};

export type EndedStakeApiVerificationClassification = "PASS" | "WARN" | "FAIL";

export type EndedStakeApiVerificationReport = {
  schemaVersion: "v1";
  chainId: number;
  walletAddress: string;
  // Presence flag only — the base URL value itself is never recorded or printed.
  baseUrlProvided: boolean;
  httpStatus: number | null;
  totalObservations: number;
  completeObservations: number;
  incompleteObservations: number;
  checks: EndedStakeApiVerificationChecks;
  classification: EndedStakeApiVerificationClassification;
  warnings: string[];
  notes: string[];
};

export function isPulsechainVerificationChain(chainId: number): boolean {
  return chainId === PULSECHAIN_CHAIN_ID;
}

// ─── Runner ─────────────────────────────────────────────────────────────────────

export async function runEndedStakeApiVerification(
  input: EndedStakeApiVerificationInput,
  deps: EndedStakeApiVerificationDeps,
): Promise<EndedStakeApiVerificationReport> {
  const walletAddress = input.walletAddress.toLowerCase();

  const report: EndedStakeApiVerificationReport = {
    schemaVersion: "v1",
    chainId: input.chainId,
    walletAddress,
    baseUrlProvided: typeof input.baseUrl === "string" && input.baseUrl.length > 0,
    httpStatus: null,
    totalObservations: 0,
    completeObservations: 0,
    incompleteObservations: 0,
    checks: {
      apiReachable: false,
      envelopeShapeValid: false,
      allScopedToRequestedChain: false,
      allScopedToRequestedWallet: false,
      everyCompleteHasLockedDay: false,
      everyCompleteHasDigitOnlyStakeShares: false,
      everyIncompleteHasWarning: false,
      stakeSharesAlwaysStringOrNull: false,
      noDuplicateObservationIdentities: false,
    },
    classification: "FAIL",
    warnings: [],
    notes: [],
  };

  // Guardrail: PulseChain only. Fail closed before any HTTP call.
  if (!isPulsechainVerificationChain(input.chainId)) {
    report.warnings.push("hexmining-ended-stake-verification-unsupported-chain");
    report.classification = "FAIL";
    return report;
  }

  if (!report.baseUrlProvided) {
    report.warnings.push("hexmining-ended-stake-verification-missing-base-url");
    report.classification = "FAIL";
    return report;
  }

  // ── Single read-only GET against the shipped API route ──────────────────────
  const url = buildRequestUrl(input.baseUrl, input.chainId, walletAddress);

  let httpResponse: Awaited<ReturnType<FetchLike>>;
  try {
    httpResponse = await deps.fetchImpl(url, { method: "GET" });
  } catch (error) {
    report.warnings.push(
      `hexmining-ended-stake-verification-fetch-failed:${errorCode(error)}`,
    );
    report.classification = "FAIL";
    return report;
  }

  report.httpStatus = httpResponse.status;
  report.checks.apiReachable = httpResponse.ok && httpResponse.status === 200;

  if (!report.checks.apiReachable) {
    report.warnings.push(
      `hexmining-ended-stake-verification-http-${httpResponse.status}`,
    );
    report.classification = "FAIL";
    return report;
  }

  let payload: unknown;
  try {
    payload = await httpResponse.json();
  } catch (error) {
    report.warnings.push(
      `hexmining-ended-stake-verification-json-parse-failed:${errorCode(error)}`,
    );
    report.classification = "FAIL";
    return report;
  }

  const dto = extractListDto(payload);
  if (dto == null) {
    report.warnings.push("hexmining-ended-stake-verification-envelope-invalid");
    report.classification = "FAIL";
    return report;
  }
  report.checks.envelopeShapeValid = true;

  // Guard: every stake entry must be structurally valid BEFORE any field access.
  // A 200 response can still carry a malformed `stakes` array (null entries,
  // primitives, or objects missing required fields). Without this guard the
  // classification path below would dereference `s.isComplete` /
  // `s.walletAddress.toLowerCase()` and throw, so the operator CLI would crash
  // instead of emitting a sanitized FAIL report. A malformed entry is treated as
  // a hard integrity failure and fails closed, deterministically.
  if (!dto.stakes.every(isStructurallyValidStake)) {
    report.warnings.push("hexmining-ended-stake-verification-malformed-stake-entry");
    report.classification = "FAIL";
    return report;
  }

  const stakes = dto.stakes;
  report.totalObservations = stakes.length;
  report.completeObservations = stakes.filter((s) => s.isComplete === true).length;
  report.incompleteObservations = stakes.filter((s) => s.isComplete !== true).length;

  // ── Presence / consistency / scoping checks (no financial math) ─────────────
  //
  // Scope is validated at BOTH the list level (the top-level DTO fields) and the
  // row level (every stake). List-level validation matters when `stakes` is empty:
  // per-stake `every()` is vacuously true, so a route that ignored/misrouted the
  // request params and returned an empty list for the wrong chain/wallet would
  // otherwise be misclassified as WARN/no-rows instead of a scoping FAIL.
  report.checks.allScopedToRequestedChain =
    dto.chainId === input.chainId &&
    stakes.every((s) => s.chainId === input.chainId);
  report.checks.allScopedToRequestedWallet =
    dto.walletAddress.toLowerCase() === walletAddress &&
    stakes.every(
      (s) =>
        typeof s.walletAddress === "string" &&
        s.walletAddress.toLowerCase() === walletAddress,
    );

  const completeStakes = stakes.filter((s) => s.isComplete === true);
  report.checks.everyCompleteHasLockedDay = completeStakes.every(
    (s) => s.lockedDay != null,
  );
  report.checks.everyCompleteHasDigitOnlyStakeShares = completeStakes.every(
    (s) =>
      typeof s.stakeShares === "string" &&
      RAW_UNSIGNED_INTEGER_PATTERN.test(s.stakeShares),
  );

  const incompleteStakes = stakes.filter((s) => s.isComplete !== true);
  report.checks.everyIncompleteHasWarning = incompleteStakes.every(
    (s) =>
      Array.isArray(s.warnings) &&
      (s.warnings.includes(WARN_INCOMPLETE_START_EVIDENCE) || s.warnings.length > 0),
  );

  report.checks.stakeSharesAlwaysStringOrNull = stakes.every(
    (s) => s.stakeShares === null || typeof s.stakeShares === "string",
  );

  const identities = stakes.map(observationIdentity);
  report.checks.noDuplicateObservationIdentities =
    new Set(identities).size === identities.length;

  // ── Classification ──────────────────────────────────────────────────────────
  //
  // FAIL — any hard integrity check failed (scoping, complete-row evidence,
  //        string-safety, duplicate identity). These indicate a real contract or
  //        serialization defect.
  // WARN — API reachable and integrity intact, but the evidence is not a clean
  //        proof: either there are no observations (honest "no rows" — NOT proof
  //        of successful ended-stake ingestion), or one or more observations are
  //        legitimately incomplete (partial START evidence).
  // PASS — API reachable, at least one observation, all complete, all checks true.

  const hardChecksOk =
    report.checks.envelopeShapeValid &&
    report.checks.allScopedToRequestedChain &&
    report.checks.allScopedToRequestedWallet &&
    report.checks.everyCompleteHasLockedDay &&
    report.checks.everyCompleteHasDigitOnlyStakeShares &&
    report.checks.everyIncompleteHasWarning &&
    report.checks.stakeSharesAlwaysStringOrNull &&
    report.checks.noDuplicateObservationIdentities;

  if (!hardChecksOk) {
    report.classification = "FAIL";
    return report;
  }

  if (report.totalObservations === 0) {
    report.notes.push(
      "no ended-stake observations found for wallet — not proof of successful ended-stake ingestion; run discovery first or choose a wallet with known ended stakes",
    );
    report.classification = "WARN";
    return report;
  }

  if (report.incompleteObservations > 0) {
    report.notes.push(
      `${report.incompleteObservations} observation(s) are legitimately incomplete (partial START evidence) — evidence is partial, not a clean PASS`,
    );
    report.classification = "WARN";
    return report;
  }

  report.classification = "PASS";
  return report;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

export function buildRequestUrl(
  baseUrl: string,
  chainId: number,
  walletAddress: string,
): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    walletAddress,
    chainId: String(chainId),
  });
  return `${trimmed}/api/hexmining/ended-stakes?${params.toString()}`;
}

// Stable dedupe identity, matching the store's dedupe key
// (chainId, walletAddress, stakeId, endBlockNumber, discoveryMethod).
function observationIdentity(stake: EndedHexStakeListDto["stakes"][number]): string {
  return [
    stake.chainId,
    stake.walletAddress.toLowerCase(),
    stake.stakeId,
    stake.endBlockNumber,
    stake.discoveryMethod,
  ].join(":");
}

// Structural (not value-level) validation of a single stake entry. It asserts
// only the shape required to run every downstream check without throwing —
// notably a non-null object plus the identity/scope/classification fields with
// correct primitive types. Value-level problems (missing lockedDay on a complete
// row, a non-digit or non-string stakeShares, a missing incomplete-row warning)
// are intentionally left to their dedicated checks so those failures stay
// granular; this guard only prevents runtime throws on malformed shapes.
function isStructurallyValidStake(entry: unknown): entry is EndedHexStakeListDto["stakes"][number] {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const s = entry as Record<string, unknown>;
  return (
    typeof s.chainId === "number" &&
    typeof s.walletAddress === "string" &&
    typeof s.stakeId === "string" &&
    typeof s.endBlockNumber === "string" &&
    typeof s.discoveryMethod === "string" &&
    typeof s.isComplete === "boolean" &&
    Array.isArray(s.warnings)
  );
}

// Narrow, defensive envelope extraction. Returns null unless the payload is the
// exact `{ data: EndedHexStakeListDto }` shape with a stakes array.
function extractListDto(payload: unknown): EndedHexStakeListDto | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as Partial<EndedHexStakeListDto>;
  if (!Array.isArray(candidate.stakes)) return null;
  if (typeof candidate.chainId !== "number") return null;
  if (typeof candidate.walletAddress !== "string") return null;
  return candidate as EndedHexStakeListDto;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "unknown";
}
