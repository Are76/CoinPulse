/**
 * Shared safety-critical primitives for wallet-forward TRANSFERS sync runners.
 *
 * Extracted from `scripts/wallet-forward-sync-runner.ts` (the existing,
 * tested, 5-window-hard-capped batch runner) so that a separate campaign
 * layer (`scripts/wallet-forward-campaign-runner.ts`) can compose the exact
 * same tested atomic-window gates, request builder, terminal-state/cursor
 * verification, duplicate/contamination checks, and evidence primitives
 * without copy-pasting safety logic.
 *
 * This module is intentionally free of any runner-specific policy: no
 * MAX_WINDOWS_HARD_CAP, no CLI parsing, no orchestration loop. Those stay in
 * each runner file so each runner keeps its own independent safety ceiling.
 *
 * Behavior here must remain byte-for-byte equivalent to what
 * `wallet-forward-sync-runner.ts` had before extraction — this file changes
 * only *where* the code lives, never what it does.
 */

import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

// ─── Fixed safety constants (not operator-overridable) ────────────────────────

/** PulseChain only — CoinPulse V1 execution target (D-009). No other chain,
 * including 8453 (Base), is accepted by any runner built on this module. */
export const SUPPORTED_CHAIN_ID = 369;

export const WALLET_FORWARD_SYNC_SOURCE_FAMILIES = ["TRANSFERS"] as const;

/** Max inclusive blocks per window: mirrors MANUAL_SYNC_MAX_BLOCK_SPAN + 1
 * (src/services/api/validation.ts) — the schema caps endBlock - startBlock at
 * MANUAL_SYNC_MAX_BLOCK_SPAN, which permits at most that + 1 inclusive
 * blocks. */
export const WINDOW_SIZE_HARD_CAP_BLOCKS = 1_001n;
export const MIN_WINDOW_SIZE_BLOCKS = 1n;

/** Manual-sync policyLabel schema limit (src/services/api/validation.ts:
 * `policyLabel: z.string().trim().min(1).max(128)`). Not a database-unique
 * constraint — `policyLabel` on `SyncRun` carries no `@unique` in
 * prisma/schema.prisma — so collision checks must query existing rows, never
 * assume the schema enforces uniqueness. */
export const POLICY_LABEL_MAX_LENGTH = 128;

// ─── Window planning (pure) ────────────────────────────────────────────────────

export type WindowPlan = {
  windowNumber: number;
  startBlock: bigint;
  endBlock: bigint;
  policyLabel: string;
  blockCount: bigint;
};

/**
 * Computes the next forward [startBlock, endBlock] range from the current
 * cursor's upper edge. This is the shared range arithmetic underneath both
 * the 5-window runner's `computeForwardWindowPlan` (invocation-local window
 * numbering + `<prefix>-<n>` labels) and the campaign runner's block-derived
 * logical window planning — each of those attaches its own `windowNumber`
 * and `policyLabel` scheme on top of this pure range calculation.
 */
export function computeNextWindowRange(args: {
  liveCursorToBlock: bigint;
  windowSizeBlocks: bigint;
}): { startBlock: bigint; endBlock: bigint; blockCount: bigint } {
  const startBlock = args.liveCursorToBlock + 1n;
  const endBlock = startBlock + args.windowSizeBlocks - 1n;
  return { startBlock, endBlock, blockCount: endBlock - startBlock + 1n };
}

// ─── Pre-submit validation gates (pure) ────────────────────────────────────────

export type GateResult = { ok: true } | { ok: false; reason: string };

export function validateSupportedChain(args: { chainId: number }): GateResult {
  if (args.chainId !== SUPPORTED_CHAIN_ID) {
    return {
      ok: false,
      reason: `chainId must be ${SUPPORTED_CHAIN_ID} (PulseChain); got ${args.chainId}. This runner accepts no other chain, including 8453 (Base).`,
    };
  }
  return { ok: true };
}

export function validateWindowSize(args: { windowSizeBlocks: bigint }): GateResult {
  if (args.windowSizeBlocks < MIN_WINDOW_SIZE_BLOCKS) {
    return { ok: false, reason: `--window-size must be a positive integer, got ${args.windowSizeBlocks}` };
  }
  if (args.windowSizeBlocks > WINDOW_SIZE_HARD_CAP_BLOCKS) {
    return {
      ok: false,
      reason: `--window-size ${args.windowSizeBlocks} exceeds the project hard cap of ${WINDOW_SIZE_HARD_CAP_BLOCKS} inclusive blocks (MANUAL_SYNC_MAX_BLOCK_SPAN + 1)`,
    };
  }
  return { ok: true };
}

export function validateExpectedLiveCursor(args: {
  liveCursor: { fromBlock: bigint; toBlock: bigint } | null;
  expectedCursorFromBlock: bigint;
  expectedCursorToBlock: bigint;
}): GateResult {
  if (!args.liveCursor) {
    return {
      ok: false,
      reason:
        "TRANSFERS SyncCursor does not exist for this wallet; this runner only extends an existing cursor forward",
    };
  }
  if (
    args.liveCursor.fromBlock !== args.expectedCursorFromBlock ||
    args.liveCursor.toBlock !== args.expectedCursorToBlock
  ) {
    return {
      ok: false,
      reason: `live TRANSFERS cursor [${args.liveCursor.fromBlock}, ${args.liveCursor.toBlock}] does not match the operator-supplied expected cursor [${args.expectedCursorFromBlock}, ${args.expectedCursorToBlock}]`,
    };
  }
  return { ok: true };
}

export function validateFirstWindowStart(args: {
  computedStartBlock: bigint;
  expectedFirstWindowStart: bigint;
}): GateResult {
  if (args.computedStartBlock !== args.expectedFirstWindowStart) {
    return {
      ok: false,
      reason: `computed first window startBlock ${args.computedStartBlock} does not match the operator-supplied --first-window-start ${args.expectedFirstWindowStart}`,
    };
  }
  return { ok: true };
}

export function validateForwardAdjacency(args: {
  liveCursorToBlock: bigint;
  proposedStartBlock: bigint;
}): GateResult {
  if (args.proposedStartBlock !== args.liveCursorToBlock + 1n) {
    return {
      ok: false,
      reason: `proposed startBlock ${args.proposedStartBlock} is not directly adjacent to the live cursor toBlock ${args.liveCursorToBlock}`,
    };
  }
  return { ok: true };
}

export function validateNoActiveOperation(args: { activeRunCount: number }): GateResult {
  if (args.activeRunCount > 0) {
    return {
      ok: false,
      reason: `${args.activeRunCount} active (PENDING/RUNNING) SyncRun(s) exist; refusing to submit while an operation is active`,
    };
  }
  return { ok: true };
}

export function validateNoPolicyLabelCollision(args: {
  policyLabel: string;
  existingPolicyLabels: readonly string[];
}): GateResult {
  if (args.existingPolicyLabels.includes(args.policyLabel)) {
    return {
      ok: false,
      reason: `a SyncRun with policyLabel "${args.policyLabel}" already exists`,
    };
  }
  return { ok: true };
}

export function validatePolicyLabelLength(args: { policyLabel: string }): GateResult {
  if (args.policyLabel.length > POLICY_LABEL_MAX_LENGTH) {
    return {
      ok: false,
      reason: `policyLabel "${args.policyLabel}" is ${args.policyLabel.length} characters, exceeding the manual-sync limit of ${POLICY_LABEL_MAX_LENGTH}`,
    };
  }
  return { ok: true };
}

// ─── Request body builder (pure) ───────────────────────────────────────────────

export function buildManualSyncRequestBody(args: {
  walletAddress: string;
  chainId: number;
  window: Pick<WindowPlan, "startBlock" | "endBlock" | "policyLabel">;
}) {
  return {
    walletAddress: args.walletAddress,
    chainId: args.chainId,
    sourceFamilies: [...WALLET_FORWARD_SYNC_SOURCE_FAMILIES],
    startBlock: args.window.startBlock.toString(),
    endBlock: args.window.endBlock.toString(),
    policyLabel: args.window.policyLabel,
  };
}

// ─── Terminal-state / postcondition verification (pure) ───────────────────────

export type RunnerSyncRunRecord = {
  id: string;
  trigger: string;
  status: string;
  stage: string;
  chainId: number;
  walletId: string | null;
  policyLabel: string;
  sourceFamilies: readonly string[];
  startBlock: bigint | null;
  endBlock: bigint | null;
  latestSafeBlock: bigint | null;
  warningCount: number;
  warningDetails: unknown;
  /**
   * Additive, optional structured-warning classification (see
   * src/services/sync/sync-warning-codes.ts). Not read by
   * verifyWindowTerminalState or any other gate in this file — the runner's
   * hard-stop behavior is unchanged by PR A and continues to key off
   * warningCount/warningDetails only.
   */
  structuredWarnings?: unknown;
  errorMessage: string | null;
  failedSourceFamily: string | null;
  failedFromBlock: bigint | null;
  failedToBlock: bigint | null;
};

export function verifyWindowTerminalState(args: {
  run: RunnerSyncRunRecord;
  expectedWalletId: string;
  expectedChainId: number;
  expectedPolicyLabel: string;
  expectedStartBlock: bigint;
  expectedEndBlock: bigint;
}): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const { run } = args;

  if (run.trigger !== "MANUAL") {
    reasons.push(`expected trigger MANUAL, got ${run.trigger}`);
  }
  if (run.status !== "COMPLETED") {
    reasons.push(`expected status COMPLETED, got ${run.status}`);
  }
  if (run.warningCount !== 0) {
    reasons.push(`expected warningCount 0, got ${run.warningCount}`);
  }
  if (!Array.isArray(run.warningDetails) || run.warningDetails.length !== 0) {
    reasons.push(`expected warningDetails to be empty, got ${JSON.stringify(run.warningDetails)}`);
  }
  if (run.errorMessage !== null) {
    reasons.push(`expected errorMessage null, got ${JSON.stringify(run.errorMessage)}`);
  }
  if (run.failedSourceFamily !== null) {
    reasons.push(`expected failedSourceFamily null, got ${run.failedSourceFamily}`);
  }
  if (run.failedFromBlock !== null || run.failedToBlock !== null) {
    reasons.push("expected failedFromBlock/failedToBlock null");
  }
  if (
    run.sourceFamilies.length !== 1 ||
    run.sourceFamilies[0] !== WALLET_FORWARD_SYNC_SOURCE_FAMILIES[0]
  ) {
    reasons.push(`expected sourceFamilies ["TRANSFERS"], got ${JSON.stringify(run.sourceFamilies)}`);
  }
  // Every runner built on this module always submits a wallet-scoped
  // request, so the reserved SyncRun must carry the exact resolved wallet
  // id — a null walletId (e.g. a chain-wide run) must never satisfy a
  // wallet-scoped window verification.
  if (run.walletId !== args.expectedWalletId) {
    reasons.push(`expected walletId ${args.expectedWalletId}, got ${run.walletId}`);
  }
  if (run.chainId !== args.expectedChainId) {
    reasons.push(`expected chainId ${args.expectedChainId}, got ${run.chainId}`);
  }
  if (run.policyLabel !== args.expectedPolicyLabel) {
    reasons.push(`expected policyLabel ${args.expectedPolicyLabel}, got ${run.policyLabel}`);
  }
  if (run.startBlock !== args.expectedStartBlock) {
    reasons.push(`expected startBlock ${args.expectedStartBlock}, got ${run.startBlock}`);
  }
  if (run.endBlock !== args.expectedEndBlock) {
    reasons.push(`expected endBlock ${args.expectedEndBlock}, got ${run.endBlock}`);
  }
  if (run.latestSafeBlock !== args.expectedEndBlock) {
    reasons.push(`expected latestSafeBlock ${args.expectedEndBlock}, got ${run.latestSafeBlock}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export function verifyForwardCursorPostcondition(args: {
  cursorAfter: { fromBlock: bigint; toBlock: bigint } | null;
  anchorFromBlock: bigint;
  expectedToBlock: bigint;
}): GateResult {
  if (!args.cursorAfter) {
    return { ok: false, reason: "TRANSFERS SyncCursor is missing after the run completed" };
  }
  if (args.cursorAfter.fromBlock !== args.anchorFromBlock) {
    return {
      ok: false,
      reason: `expected cursor fromBlock to remain anchored at ${args.anchorFromBlock}, got ${args.cursorAfter.fromBlock}`,
    };
  }
  if (args.cursorAfter.toBlock !== args.expectedToBlock) {
    return {
      ok: false,
      reason: `expected cursor toBlock ${args.expectedToBlock} after the run, got ${args.cursorAfter.toBlock}`,
    };
  }
  return { ok: true };
}

/**
 * Builds one distinct, operator-readable failure reason per failed post-run
 * safety gate — never just the generic "post-run invariant check failed"
 * with an empty list. Every gate is independent: a run can fail multiple
 * gates simultaneously (e.g. contamination AND a duplicate group), and every
 * one of them must show up here, not just the first one checked.
 */
export function buildPostRunFailureReasons(args: {
  terminalVerification: { ok: true } | { ok: false; reasons: string[] };
  cursorGatePost: GateResult;
  postContaminationRowCount: number;
  duplicateRawTransactionGroups: number;
  duplicateRawTokenTransferGroups: number;
  duplicateLedgerEntryGroups: number;
  activeOperationsAfter: number;
}): string[] {
  const reasons: string[] = [];

  if (!args.terminalVerification.ok) {
    reasons.push(...args.terminalVerification.reasons);
  }
  if (!args.cursorGatePost.ok) {
    reasons.push(args.cursorGatePost.reason);
  }
  if (args.postContaminationRowCount > 0) {
    reasons.push(
      `post-run fabricated-transfer contamination: ${args.postContaminationRowCount} row(s) detected in the completed window's range`,
    );
  }
  if (args.duplicateRawTransactionGroups > 0) {
    reasons.push(
      `duplicate RawTransaction identity (chainId+txHash+blockHash) groups: ${args.duplicateRawTransactionGroups}`,
    );
  }
  if (args.duplicateRawTokenTransferGroups > 0) {
    reasons.push(
      `duplicate RawTokenTransfer identity (chainId+txHash+logIndex+blockHash) groups: ${args.duplicateRawTokenTransferGroups}`,
    );
  }
  if (args.duplicateLedgerEntryGroups > 0) {
    reasons.push(`duplicate LedgerEntry dedupeKey groups: ${args.duplicateLedgerEntryGroups}`);
  }
  if (args.activeOperationsAfter > 0) {
    reasons.push(
      `${args.activeOperationsAfter} active (PENDING/RUNNING) SyncRun(s) remain after the run completed`,
    );
  }

  return reasons;
}

// ─── Env validation ────────────────────────────────────────────────────────────

export const REQUIRED_ENV_VARS = ["DATABASE_URL", "REDIS_URL"] as const;

export type EnvCheckResult = { ok: true } | { ok: false; missing: readonly string[] };

export function checkEnv(env: Record<string, string | undefined>): EnvCheckResult {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── Evidence records ──────────────────────────────────────────────────────────

export type EvidenceRecord = {
  kind: string;
  at: string;
  [key: string]: unknown;
};

/** JSON.stringify replacer that serializes bigint as a decimal string. */
export function bigintSafeReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function serializeEvidence(record: EvidenceRecord): string {
  return JSON.stringify(record, bigintSafeReplacer);
}

export async function writeEvidenceLine(evidenceFile: string, record: EvidenceRecord): Promise<void> {
  const dir = path.dirname(evidenceFile);
  await mkdir(dir, { recursive: true });
  await appendFile(evidenceFile, `${serializeEvidence(record)}\n`, "utf8");
}

/**
 * Builds a "stop" evidence record with `kind`/`at`/`reason`/`detail` always
 * winning over anything a caller passes in `extra` — a caller can never
 * override the record's `kind` to something other than `"stop"`, which would
 * otherwise let an evidence consumer filtering for stop records silently
 * miss a hard stop.
 */
export function buildStopEvidenceRecord(args: {
  at: string;
  reason: string;
  detail?: string;
  extra?: Record<string, unknown>;
}): EvidenceRecord {
  return {
    ...args.extra,
    kind: "stop",
    at: args.at,
    reason: args.reason,
    detail: args.detail,
  };
}

// ─── Backend response sanitization (for stop evidence only) ───────────────────

const SANITIZED_RESPONSE_TEXT_MAX_LENGTH = 2_000;

/** Key names that must never appear verbatim in evidence, even if a backend
 * response body somehow included one (defense in depth — the API routes
 * these runners call do not emit these fields today). */
const SECRET_LIKE_KEY_PATTERN =
  /(database_url|redis_url|password|secret|token|api[-_]?key|authorization|cookie)/i;

function redactSecretLikeFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecretLikeFields);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_LIKE_KEY_PATTERN.test(key) ? "[redacted]" : redactSecretLikeFields(val);
    }
    return out;
  }
  return value;
}

/**
 * Prepares a backend HTTP response body for inclusion in stop evidence: caps
 * an oversized/non-JSON string body, redacts any secret-like key a JSON body
 * might carry, and never throws — an unparseable or missing body degrades to
 * a safe placeholder rather than being silently dropped, so the original HTTP
 * failure (status code, caller-provided detail string) is never masked.
 */
export function sanitizeBackendResponseBody(body: unknown): unknown {
  if (body === undefined) {
    return null;
  }
  if (typeof body === "string") {
    return body.length > SANITIZED_RESPONSE_TEXT_MAX_LENGTH
      ? `${body.slice(0, SANITIZED_RESPONSE_TEXT_MAX_LENGTH)}...[truncated]`
      : body;
  }
  try {
    return redactSecretLikeFields(body);
  } catch {
    return "[unavailable: response body could not be sanitized]";
  }
}

// ─── Runner DB client (narrow, injectable) ─────────────────────────────────────

export type RunnerDbClient = {
  syncCursor: {
    findUnique: (args: unknown) => Promise<{
      fromBlock: bigint;
      toBlock: bigint;
      blockHash: string | null;
    } | null>;
  };
  syncRun: {
    findMany: (args: unknown) => Promise<RunnerSyncRunRecord[]>;
    findUnique: (args: unknown) => Promise<RunnerSyncRunRecord | null>;
    count: (args: unknown) => Promise<number>;
  };
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};

export async function getLiveTransfersCursor(
  db: RunnerDbClient,
  walletId: string,
  chainId: number,
): Promise<{ fromBlock: bigint; toBlock: bigint } | null> {
  const cursor = await db.syncCursor.findUnique({
    where: {
      walletId_chainId_sourceFamily: {
        walletId,
        chainId,
        sourceFamily: "TRANSFERS",
      },
    },
    select: { fromBlock: true, toBlock: true, blockHash: true },
  });
  return cursor ? { fromBlock: cursor.fromBlock, toBlock: cursor.toBlock } : null;
}

export async function listActivePolicyLabels(db: RunnerDbClient, chainId: number): Promise<string[]> {
  const runs = await db.syncRun.findMany({
    where: { chainId },
    select: { policyLabel: true },
  });
  return (runs as unknown as Array<{ policyLabel: string }>).map((r) => r.policyLabel);
}

export async function countActiveOperations(db: RunnerDbClient): Promise<number> {
  return db.syncRun.count({
    where: { status: { in: ["PENDING", "RUNNING"] } },
  });
}

const TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function checkFabricatedContamination(
  db: RunnerDbClient,
  args: { chainId: number; walletAddress: string; startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const wallet = args.walletAddress.toLowerCase();
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT t.id
    FROM "RawTokenTransfer" t
    JOIN "RawLog" l
      ON l."chainId" = t."chainId" AND l."txHash" = t."txHash"
     AND l."logIndex" = t."logIndex" AND l."blockHash" = t."blockHash"
    WHERE t."chainId" = ${args.chainId} AND t.status = 'ACTIVE'
      AND t."blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
      AND (lower(t."fromAddress") = ${wallet} OR lower(t."toAddress") = ${wallet})
      AND (l."topic0" IS NULL OR lower(l."topic0") <> ${TRANSFER_TOPIC0})
  `;
  return { rowCount: rows.length };
}

export async function checkDuplicateRawTransactions(
  db: RunnerDbClient,
  args: { chainId: number; startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const rows = await db.$queryRaw<Array<{ txHash: string }>>`
    SELECT "txHash", "blockHash", count(*)
    FROM "RawTransaction"
    WHERE "chainId" = ${args.chainId}
      AND "blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
    GROUP BY "txHash", "blockHash"
    HAVING count(*) > 1
  `;
  return { rowCount: rows.length };
}

export async function checkDuplicateRawTokenTransfers(
  db: RunnerDbClient,
  args: { chainId: number; startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const rows = await db.$queryRaw<Array<{ txHash: string }>>`
    SELECT "txHash", "logIndex", "blockHash", count(*)
    FROM "RawTokenTransfer"
    WHERE "chainId" = ${args.chainId}
      AND "blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
    GROUP BY "txHash", "logIndex", "blockHash"
    HAVING count(*) > 1
  `;
  return { rowCount: rows.length };
}

export async function checkDuplicateLedgerEntries(
  db: RunnerDbClient,
  args: { startBlock: bigint; endBlock: bigint },
): Promise<{ rowCount: number }> {
  const rows = await db.$queryRaw<Array<{ dedupeKey: string }>>`
    SELECT e."dedupeKey", count(*)
    FROM "LedgerEntry" e
    JOIN "LedgerActionGroup" g ON g.id = e."actionGroupId"
    WHERE g."blockNumber" BETWEEN ${args.startBlock} AND ${args.endBlock}
    GROUP BY e."dedupeKey"
    HAVING count(*) > 1
  `;
  return { rowCount: rows.length };
}

// ─── HTTP + polling ─────────────────────────────────────────────────────────────

export type HttpResponse = { status: number; body: unknown };
export type HttpPost = (url: string, body: unknown) => Promise<HttpResponse>;
export type HttpGet = (url: string) => Promise<HttpResponse>;

/**
 * Reads an HTTP response body safely regardless of content type: JSON is
 * parsed; a non-JSON or malformed body falls back to the raw text (still
 * useful in stop evidence, capped later by sanitizeBackendResponseBody)
 * rather than being silently discarded as `undefined`. Never throws.
 */
export async function readHttpResponseBody(res: { text: () => Promise<string> }): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function checkServerHealth(httpGet: HttpGet, baseUrl: string): Promise<GateResult> {
  let response: HttpResponse;
  try {
    response = await httpGet(`${baseUrl}/api/debug/health`);
  } catch (err) {
    return {
      ok: false,
      reason: `health check request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const body = response.body as { data?: { status?: string } } | undefined;
  if (response.status !== 200 || body?.data?.status !== "ok") {
    return { ok: false, reason: `server health check did not report ok (status ${response.status})` };
  }
  return { ok: true };
}

export async function pollSyncRunToTerminal(
  db: RunnerDbClient,
  runId: string,
  deps: { now: () => Date; sleep: (ms: number) => Promise<void>; pollIntervalMs: number; pollTimeoutMs: number },
): Promise<
  | { ok: true; run: RunnerSyncRunRecord }
  | { ok: false; reason: "timeout"; lastRun: RunnerSyncRunRecord | null }
> {
  const deadline = deps.now().getTime() + deps.pollTimeoutMs;

  for (;;) {
    const run = await db.syncRun.findUnique({ where: { id: runId } });
    if (run && (run.status === "COMPLETED" || run.status === "FAILED")) {
      return { ok: true, run };
    }
    if (deps.now().getTime() >= deadline) {
      return { ok: false, reason: "timeout", lastRun: run };
    }
    await deps.sleep(deps.pollIntervalMs);
  }
}

// ─── Wallet lookup (local Prisma client only — no global DB resolver) ─────────
//
// Deliberately narrow and self-contained: takes only the one Prisma method it
// needs, so a CLI can pass its single already-open local client instead of
// pulling in a service function that opens the module-global getDb() client.
// Mirrors resolveTrackedWalletByAddress's exact where/select shape.

export type WalletLookupClient = {
  wallet: {
    findUnique: (args: {
      where: { chainId_addressLower: { chainId: number; addressLower: string } };
      select: { id: true; address: true; chainId: true };
    }) => Promise<{ id: string; address: string; chainId: number } | null>;
  };
};

export async function resolveWalletUsingPrismaClient(
  client: WalletLookupClient,
  args: { walletAddress: string; chainId: number },
): Promise<{ id: string; address: string } | null> {
  const wallet = await client.wallet.findUnique({
    where: {
      chainId_addressLower: {
        chainId: args.chainId,
        addressLower: args.walletAddress.toLowerCase(),
      },
    },
    select: { id: true, address: true, chainId: true },
  });
  return wallet ? { id: wallet.id, address: wallet.address } : null;
}

// ─── Shared JSON stringify for CLI summaries ───────────────────────────────────

export function safeStringify(value: unknown): string {
  return JSON.stringify(value, bigintSafeReplacer, 2);
}
