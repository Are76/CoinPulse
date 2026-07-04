import "server-only";

import { parseAbi, type PublicClient } from "viem";

import { discoverHsiStakeObservations } from "@/services/hexmining/hsi-discovery";
import { enrichHsiStakeObservations } from "@/services/hexmining/hsi-reader";
import {
  readHsiStakeObservations,
  type PersistedHsiStakeObservation,
} from "@/services/hexmining/hsi-observation-store";

// ─── Purpose ────────────────────────────────────────────────────────────────────
//
// Operator verification tooling only. Drives the *already-shipped* HSI pipeline
//
//     discovery → observation persistence → reader enrichment
//
// end-to-end against a known PulseChain HSI and assembles a factual report of
// what each stage produced. It orchestrates the existing services unchanged — it
// contains no discovery, persistence, or reader logic of its own, and it does no
// pricing, valuation, yield, or financial-value comparison. Every check is a
// presence/consistency assertion, never a numeric comparison.
//
// It never fabricates values: the report is built strictly from what the live
// services returned and persisted. When run with mock deps (tests) it exercises
// the same assembly deterministically; when run from the CLI wrapper it uses a
// real viem client and Prisma client.

const PULSECHAIN_CHAIN_ID = 369;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// The discovery warning every incomplete observation carries; enrichment must
// remove it. Kept in sync with the reader/discovery constant of the same value.
const WARN_STAKE_FIELDS_UNKNOWN = "hexmining-hsi-stake-fields-unknown";

// Minimal read used only to record the resolved per-stake HSI contract in the
// report. This is the same resolution the reader performs internally; the reader
// does not expose it, so the runner independently resolves it for the report.
const HSIM_ABI = parseAbi([
  "function hsiToken(uint256 tokenId) view returns (address)",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type HsiLiveVerificationReadClient = Pick<
  PublicClient,
  "readContract" | "getBlockNumber"
>;

type DiscoveryDeps = Parameters<typeof discoverHsiStakeObservations>[1];
type ReaderDeps = Parameters<typeof enrichHsiStakeObservations>[1];

// The persistence client must satisfy discovery (create/findFirst/findMany) and
// the reader (adds update). The reader's dep is the superset, so use it.
export type HsiLiveVerificationPersistenceClient = NonNullable<
  ReaderDeps["persistenceClient"]
>;

export type HsiLiveVerificationInput = {
  chainId: number;
  walletAddress: string;
  /** Hedron HEXStakeInstanceManager (ERC-721) address discovery enumerates. */
  hsiManagerAddress: string;
  /** The known token ID the operator expects discovery to find. */
  expectedHsiTokenId: string;
  observedAt?: Date;
};

export type HsiLiveVerificationDeps = {
  publicClient: HsiLiveVerificationReadClient;
  persistenceClient: HsiLiveVerificationPersistenceClient;
};

export type HsiLiveVerificationChecks = {
  discoveryFoundToken: boolean;
  tokenIdMatches: boolean;
  observedAtBlockCaptured: boolean;
  hsiContractResolved: boolean;
  stakeIdPopulated: boolean;
  stakeSharesPopulated: boolean;
  principalHexPopulated: boolean;
  lockedDayPopulated: boolean;
  stakedDaysPopulated: boolean;
  isCompleteBecameTrue: boolean;
  stakeFieldsUnknownWarningRemoved: boolean;
};

export type HsiLiveVerificationReport = {
  schemaVersion: "v1";
  chainId: number;
  walletAddress: string;
  hsiManagerAddress: string;
  expectedHsiTokenId: string;
  discovery: {
    ok: boolean;
    discovered: number | null;
    persisted: number | null;
    skipped: number | null;
    observedAtBlock: string | null;
    code: string | null;
  };
  target: {
    found: boolean;
    hsiTokenId: string | null;
    observedAtBlock: string | null;
    resolvedHsiContract: string | null;
    isCompleteBefore: boolean | null;
    warningsBefore: string[] | null;
  };
  enrichment: {
    ok: boolean;
    outcomeStatus: string | null;
    outcomeCode: string | null;
    code: string | null;
  };
  afterEnrichment: {
    isComplete: boolean | null;
    stakeId: string | null;
    stakeIndex: number | null;
    stakeShares: string | null;
    principalHex: string | null;
    lockedDay: number | null;
    stakedDays: number | null;
    warningsAfter: string[] | null;
  };
  checks: HsiLiveVerificationChecks;
  allChecksPassed: boolean;
};

// ─── Runner ─────────────────────────────────────────────────────────────────────

export async function runHsiLiveVerification(
  input: HsiLiveVerificationInput,
  deps: HsiLiveVerificationDeps,
): Promise<HsiLiveVerificationReport> {
  const walletAddress = input.walletAddress.toLowerCase();
  const hsiManagerAddress = input.hsiManagerAddress.toLowerCase();
  const expectedHsiTokenId = input.expectedHsiTokenId;

  const report: HsiLiveVerificationReport = {
    schemaVersion: "v1",
    chainId: input.chainId,
    walletAddress,
    hsiManagerAddress,
    expectedHsiTokenId,
    discovery: {
      ok: false,
      discovered: null,
      persisted: null,
      skipped: null,
      observedAtBlock: null,
      code: null,
    },
    target: {
      found: false,
      hsiTokenId: null,
      observedAtBlock: null,
      resolvedHsiContract: null,
      isCompleteBefore: null,
      warningsBefore: null,
    },
    enrichment: { ok: false, outcomeStatus: null, outcomeCode: null, code: null },
    afterEnrichment: {
      isComplete: null,
      stakeId: null,
      stakeIndex: null,
      stakeShares: null,
      principalHex: null,
      lockedDay: null,
      stakedDays: null,
      warningsAfter: null,
    },
    checks: {
      discoveryFoundToken: false,
      tokenIdMatches: false,
      observedAtBlockCaptured: false,
      hsiContractResolved: false,
      stakeIdPopulated: false,
      stakeSharesPopulated: false,
      principalHexPopulated: false,
      lockedDayPopulated: false,
      stakedDaysPopulated: false,
      isCompleteBecameTrue: false,
      stakeFieldsUnknownWarningRemoved: false,
    },
    allChecksPassed: false,
  };

  const discoveryDeps: DiscoveryDeps = {
    publicClient: deps.publicClient,
    persistenceClient:
      deps.persistenceClient as unknown as DiscoveryDeps["persistenceClient"],
  };
  const readerDeps: ReaderDeps = {
    publicClient: deps.publicClient,
    persistenceClient: deps.persistenceClient,
  };

  // ── Stage 1: discovery ──────────────────────────────────────────────────────
  const discovery = await discoverHsiStakeObservations(
    {
      chainId: input.chainId,
      walletAddress,
      hsiAddress: hsiManagerAddress,
      observedAt: input.observedAt,
    },
    discoveryDeps,
  );

  if (discovery.ok) {
    report.discovery = {
      ok: true,
      discovered: discovery.discovered,
      persisted: discovery.persisted,
      skipped: discovery.skipped,
      observedAtBlock: discovery.observedAtBlock,
      code: null,
    };
  } else {
    report.discovery.code = discovery.code;
    return finalize(report);
  }

  // ── Locate the target observation (pre-enrichment snapshot) ──────────────────
  const before = await readObservations(input.chainId, walletAddress, deps.persistenceClient);
  const targetBefore = before.find((o) => o.hsiTokenId === expectedHsiTokenId);

  if (targetBefore) {
    report.target.found = true;
    report.target.hsiTokenId = targetBefore.hsiTokenId;
    report.target.observedAtBlock = targetBefore.observedAtBlock.toString();
    report.target.isCompleteBefore = targetBefore.isComplete;
    report.target.warningsBefore = targetBefore.warnings;
    report.target.resolvedHsiContract = await resolveHsiContract(
      deps.publicClient,
      hsiManagerAddress,
      targetBefore.hsiTokenId,
      targetBefore.observedAtBlock,
    );
  }

  // ── Stage 2: reader enrichment ───────────────────────────────────────────────
  const enrichment = await enrichHsiStakeObservations(
    { chainId: input.chainId, walletAddress },
    readerDeps,
  );

  if (enrichment.ok) {
    report.enrichment.ok = true;
    const outcome = enrichment.outcomes.find((o) => o.hsiTokenId === expectedHsiTokenId);
    if (outcome) {
      report.enrichment.outcomeStatus = outcome.status;
      report.enrichment.outcomeCode = "code" in outcome ? outcome.code : null;
    }
  } else {
    report.enrichment.code = enrichment.code;
  }

  // ── Post-enrichment snapshot ─────────────────────────────────────────────────
  const after = await readObservations(input.chainId, walletAddress, deps.persistenceClient);
  const targetAfter = after.find((o) => o.hsiTokenId === expectedHsiTokenId);

  if (targetAfter) {
    report.afterEnrichment = {
      isComplete: targetAfter.isComplete,
      stakeId: targetAfter.stakeId,
      stakeIndex: targetAfter.stakeIndex,
      stakeShares: targetAfter.stakeShares,
      principalHex: targetAfter.principalHex,
      lockedDay: targetAfter.lockedDay,
      stakedDays: targetAfter.stakedDays,
      warningsAfter: targetAfter.warnings,
    };
  }

  // ── Checks (presence/consistency only — never financial comparisons) ─────────
  report.checks = {
    discoveryFoundToken: report.target.found,
    tokenIdMatches: report.target.hsiTokenId === expectedHsiTokenId,
    observedAtBlockCaptured:
      report.target.observedAtBlock != null && report.target.observedAtBlock !== "",
    hsiContractResolved:
      report.target.resolvedHsiContract != null &&
      report.target.resolvedHsiContract.toLowerCase() !== ZERO_ADDRESS,
    stakeIdPopulated: report.afterEnrichment.stakeId != null,
    stakeSharesPopulated: report.afterEnrichment.stakeShares != null,
    principalHexPopulated: report.afterEnrichment.principalHex != null,
    lockedDayPopulated: report.afterEnrichment.lockedDay != null,
    stakedDaysPopulated: report.afterEnrichment.stakedDays != null,
    isCompleteBecameTrue:
      report.target.isCompleteBefore === false && report.afterEnrichment.isComplete === true,
    stakeFieldsUnknownWarningRemoved:
      (report.target.warningsBefore?.includes(WARN_STAKE_FIELDS_UNKNOWN) ?? false) &&
      (report.afterEnrichment.warningsAfter?.includes(WARN_STAKE_FIELDS_UNKNOWN) === false),
  };

  return finalize(report);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function finalize(report: HsiLiveVerificationReport): HsiLiveVerificationReport {
  report.allChecksPassed = Object.values(report.checks).every(Boolean);
  return report;
}

async function readObservations(
  chainId: number,
  walletAddress: string,
  client: HsiLiveVerificationPersistenceClient,
): Promise<PersistedHsiStakeObservation[]> {
  return readHsiStakeObservations(
    { chainId, walletAddress },
    client as unknown as Parameters<typeof readHsiStakeObservations>[1],
  );
}

async function resolveHsiContract(
  publicClient: HsiLiveVerificationReadClient,
  hsiManagerAddress: string,
  hsiTokenId: string,
  observedAtBlock: bigint,
): Promise<string | null> {
  try {
    const resolved = (await publicClient.readContract({
      address: hsiManagerAddress as `0x${string}`,
      abi: HSIM_ABI,
      functionName: "hsiToken",
      args: [BigInt(hsiTokenId)],
      blockNumber: observedAtBlock,
    })) as string;
    return resolved;
  } catch {
    return null;
  }
}

export function isPulsechainVerificationChain(chainId: number): boolean {
  return chainId === PULSECHAIN_CHAIN_ID;
}
