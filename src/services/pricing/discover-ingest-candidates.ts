import "server-only";

import {
  CORE_ASSETS,
  PULSECHAIN_NATIVE_ASSET_ID,
  PULSECHAIN_NATIVE_TOKEN_ADDRESS,
} from "@/config/assets";
import { getDb } from "@/lib/db";
import {
  computeMaterializationFreshness,
  type MaterializationFreshnessInput,
} from "@/services/dashboard/portfolio-dashboard";
import type { DashboardMaterializationFreshnessDto } from "@/services/dashboard/types";
import { detectDecimalsConflict } from "@/services/dashboard/token-metadata-status";

/**
 * Read-only wallet-scoped preview of price-ingestion candidates.
 *
 * Discovers assets from current non-zero canonical `PortfolioTokenBalance`
 * rows for exactly one tracked wallet on chainId 369, and classifies each as
 * eligible or excluded for a *future*, manually operator-reviewed call to
 * `POST /api/prices/ingest`. This module never calls RPC, never runs price
 * ingestion, and never mutates the database — it only reads already-persisted
 * canonical backend state.
 *
 * Deterministic given the same persisted database state and the same `asOf`
 * timestamp (used only to evaluate materialization freshness against the
 * repository's existing staleness threshold — never for pricing math).
 *
 * Eligibility does not prove priceability, a valid PulseX route, or a
 * verified USD price. See docs/project-decisions.md D-004/D-006 — the
 * existing pricing resolver remains the sole authority on quote truth.
 *
 * `quoteAsset` on every eligible candidate is the canonical pDAI asset
 * identity, not `"fiat:usd"`. The existing PulseX fetcher
 * (`fetchOnchainPulseXPrice`) always routes token → WPLS → pDAI, and
 * `isUnverifiedPulseXQuoteAssumption` (src/services/pricing/price-resolver.ts,
 * PR #351) rejects every PulseX-routed observation unless it was persisted
 * under the exact canonical pDAI quote identity. Emitting `"fiat:usd"` here
 * would produce an ingest payload whose resulting observation the resolver
 * can never select. A future pDAI-denominated observation is not a verified
 * USD price and does not increase Dashboard USD valuation coverage — see
 * `PREVIEW_WARNINGS` in scripts/preview-price-ingest-candidates.ts.
 */

const SUPPORTED_CHAIN_ID = 369;
const CANDIDATE_CAP = 50;
const MIN_ACCEPTED_DECIMALS = 0;
const MAX_ACCEPTED_DECIMALS = 18; // matches tokenDecimalsSchema in src/services/api/validation.ts

// Real persisted assetId strings embed a lowercased token address (see
// src/services/sync/sync-common.ts buildAssetId equivalent). CORE_ASSETS.pdai
// uses a checksummed (mixed-case) address for viem Address typing, so the
// comparison must lowercase it first — same approach as
// src/services/pricing/price-resolver.ts PDAI_QUOTE_ASSET_ID.
const PDAI_ASSET_ID = CORE_ASSETS.pdai.assetId.toLowerCase();

// The only quoteAsset value under which the resolver will ever select a
// PulseX-routed observation (see isUnverifiedPulseXQuoteAssumption). Every
// eligible candidate's price would, if actually ingested, be pDAI-routed —
// so this is the only safe quoteAsset to advertise.
const QUOTE_ASSET = PDAI_ASSET_ID;

// Canonical assets that must remain reachable ahead of the 50-item cap, in
// this explicit stable order. Currently just native PLS — the only core
// asset whose canonical assetId this service special-cases (for its
// zero-address tokenAddress derivation). Matched by exact canonical assetId,
// never by symbol.
const PRIORITY_ASSET_IDS: readonly string[] = [PULSECHAIN_NATIVE_ASSET_ID];

const CANONICAL_ASSET_ID_PATTERN = /^chain:(\d+):(erc20|native):(0x[0-9a-f]{40})$/;
const ZERO_DECIMAL_STRING_PATTERN = /^-?0(\.0+)?$/;

export type IngestCandidateExclusionReason =
  | "ZERO_BALANCE"
  | "MISSING_DECIMALS"
  | "INVALID_DECIMALS"
  | "CONFLICTING_DECIMALS"
  | "IGNORED_ASSET"
  | "PDAI_ROUTING_REFERENCE"
  | "UNSUPPORTED_ASSET_CLASS"
  | "INVALID_CANONICAL_IDENTITY"
  | "DUPLICATE_ASSET";

export type EligibleIngestCandidate = {
  assetId: string;
  tokenAddress: string;
  tokenDecimals: number;
  /** Canonical pDAI asset identity — never "fiat:usd". See module docstring. */
  quoteAsset: string;
  walletAddress: string;
  chainId: number;
  /** Provenance summary for the decimals value, when a Token record exists. */
  decimalsSource: string | null;
};

export type ExcludedIngestCandidate = {
  assetId: string;
  chainId: number;
  tokenAddress: string | null;
  reason: IngestCandidateExclusionReason;
  detail: string;
};

export type MaterializationHealth = {
  /**
   * True only when the persisted `PortfolioMaterializationState` row for
   * this wallet+chain is COMPLETED, `completedSuccessfully`, carries zero
   * persisted warnings, and is fresh under the existing
   * `MATERIALIZATION_STALE_AFTER_SECONDS` repository threshold
   * (src/services/dashboard/portfolio-dashboard.ts). When false, the
   * service refuses to classify any candidate as eligible.
   */
  healthy: boolean;
  status: "RUNNING" | "FAILED" | "COMPLETED" | null;
  completedSuccessfully: boolean | null;
  freshnessStatus: DashboardMaterializationFreshnessDto["status"];
  freshnessReason: string | null;
  latestMaterializedAt: string | null;
  warningCount: number;
  errorMessage: string | null;
};

export type DiscoverIngestCandidatesResult = {
  chainId: number;
  walletAddress: string;
  totalBalanceRowsInspected: number;
  totalEligibleBeforeCap: number;
  totalReturned: number;
  totalExcluded: number;
  cap: number;
  truncated: boolean;
  eligible: EligibleIngestCandidate[];
  excluded: ExcludedIngestCandidate[];
  materializationHealth: MaterializationHealth;
};

export class UnsupportedIngestDiscoveryChainError extends Error {
  constructor(chainId: number) {
    super(
      `Unsupported chainId for price ingest candidate discovery: ${chainId}. Only chainId ${SUPPORTED_CHAIN_ID} (PulseChain) is supported.`,
    );
    this.name = "UnsupportedIngestDiscoveryChainError";
  }
}

type BalanceRow = {
  assetId: string;
  assetAddress: string | null;
  decimals: number | null;
  balanceQuantity: { toString(): string };
};

type TokenRow = {
  id: string;
  assetId: string;
  isIgnored: boolean;
  decimalsSource: string | null;
};

type MetadataSourceRow = {
  tokenId: string;
  decimals: number | null;
};

type MaterializationStateRow = {
  status: "RUNNING" | "FAILED" | "COMPLETED";
  completedSuccessfully: boolean;
  latestMaterializedAt: Date | null;
  warningCount: number;
  errorMessage: string | null;
};

export type DiscoveryDbClient = {
  portfolioTokenBalance: {
    findMany(args: {
      where: { walletId: string; chainId: number };
    }): Promise<BalanceRow[]>;
  };
  // Scoped to the wallet's own discovered assetIds (never a chain-wide scan) —
  // see the `assetId: { in: ... }` narrowing in discoverPriceIngestCandidates.
  token: {
    findMany(args: {
      where: { chainId: number; assetId: { in: string[] } };
    }): Promise<TokenRow[]>;
  };
  tokenMetadataSource: {
    findMany(args: {
      where: { tokenId: { in: string[] } };
    }): Promise<MetadataSourceRow[]>;
  };
  portfolioLpPosition: {
    findMany(args: {
      where: { walletId: string; chainId: number };
    }): Promise<Array<{ lpAssetId: string }>>;
  };
  // Canonical materialization-health source — see MaterializationHealth doc.
  portfolioMaterializationState: {
    findUnique(args: {
      where: { walletId_chainId: { walletId: string; chainId: number } };
    }): Promise<MaterializationStateRow | null>;
  };
};

export type DiscoverIngestCandidatesArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
  /**
   * Evaluation timestamp for materialization freshness only (never used for
   * pricing math). Defaults to the current time when omitted; callers that
   * need a deterministic result (e.g. the CLI, or tests) should pass an
   * explicit value.
   */
  asOf?: Date;
  db?: DiscoveryDbClient;
};

function excludeRow(
  excluded: ExcludedIngestCandidate[],
  args: {
    assetId: string;
    chainId: number;
    tokenAddress: string | null;
    reason: IngestCandidateExclusionReason;
    detail: string;
  },
): void {
  excluded.push(args);
}

type CanonicalIdentityValidation =
  | { ok: true; tokenAddress: string }
  | { ok: false; detail: string };

/**
 * Pure canonical-identity validator. Proves — never guesses — that a
 * balance row's assetId is internally consistent and matches the requested
 * chain and the row's own persisted assetAddress. This never rewrites a
 * contradictory persisted identity into an eligible one; contradictions are
 * always reported as INVALID_CANONICAL_IDENTITY.
 */
function validateCanonicalIdentity(args: {
  assetId: string;
  requestedChainId: number;
  assetAddress: string | null;
}): CanonicalIdentityValidation {
  const match = CANONICAL_ASSET_ID_PATTERN.exec(args.assetId);
  if (!match) {
    return {
      ok: false,
      detail: "assetId does not match the canonical chain:<id>:(erc20|native):0x... format.",
    };
  }

  const [, chainIdSegment, kind, embeddedAddress] = match;
  const embeddedChainId = Number(chainIdSegment);
  if (embeddedChainId !== args.requestedChainId) {
    return {
      ok: false,
      detail: `assetId embeds chainId ${embeddedChainId}, which does not match the requested chainId ${args.requestedChainId}.`,
    };
  }

  if (kind === "native") {
    if (args.assetId !== PULSECHAIN_NATIVE_ASSET_ID || embeddedAddress !== PULSECHAIN_NATIVE_TOKEN_ADDRESS) {
      return {
        ok: false,
        detail: "native assetId does not match the canonical PulseChain native asset identity.",
      };
    }
    return { ok: true, tokenAddress: PULSECHAIN_NATIVE_TOKEN_ADDRESS };
  }

  // kind === "erc20"
  if (!args.assetAddress) {
    return {
      ok: false,
      detail: "ERC-20 assetId has no persisted assetAddress to validate against.",
    };
  }

  const normalizedAddress = args.assetAddress.toLowerCase();
  if (embeddedAddress !== normalizedAddress) {
    return {
      ok: false,
      detail: "assetId token address does not match the persisted assetAddress for this row.",
    };
  }

  // Return the normalized (lowercase) address — matching the embedded
  // assetId casing exactly — rather than the persisted row's original
  // casing, since operators submit this value directly to
  // POST /api/prices/ingest.
  return { ok: true, tokenAddress: normalizedAddress };
}

/**
 * Computes materialization health for one wallet+chain from the canonical
 * `PortfolioMaterializationState` row, reusing the exact freshness rule and
 * staleness threshold already used by the portfolio dashboard
 * (src/services/dashboard/portfolio-dashboard.ts) rather than inventing a
 * second one. A wallet with no persisted row is never healthy — absence of
 * evidence is not evidence of health.
 */
function buildMaterializationHealth(
  row: MaterializationStateRow | null,
  asOf: Date,
): MaterializationHealth {
  const freshnessInput: MaterializationFreshnessInput = row
    ? {
        status: row.status,
        latestMaterializedAt: row.latestMaterializedAt,
        errorMessage: row.errorMessage,
      }
    : null;
  const freshness = computeMaterializationFreshness(freshnessInput, asOf);

  const healthy =
    row !== null &&
    row.status === "COMPLETED" &&
    row.completedSuccessfully === true &&
    row.warningCount === 0 &&
    freshness.status === "fresh";

  return {
    healthy,
    status: row?.status ?? null,
    completedSuccessfully: row?.completedSuccessfully ?? null,
    freshnessStatus: freshness.status,
    freshnessReason: freshness.reason,
    latestMaterializedAt: row?.latestMaterializedAt?.toISOString() ?? null,
    warningCount: row?.warningCount ?? 0,
    errorMessage: row?.errorMessage ?? null,
  };
}

/**
 * Discovers wallet-scoped, chain-369-scoped price-ingestion candidates from
 * current non-zero canonical `PortfolioTokenBalance` state.
 *
 * Deterministic given the same persisted database state and `asOf` (or the
 * omitted-default current time). Strictly read-only — issues no writes and
 * calls no RPC.
 *
 * Refuses to classify any candidate as eligible when the wallet's canonical
 * `PortfolioMaterializationState` is missing, not COMPLETED, not
 * `completedSuccessfully`, stale under the existing repository threshold, or
 * carries any persisted warning — see `MaterializationHealth`.
 */
export async function discoverPriceIngestCandidates(
  args: DiscoverIngestCandidatesArgs,
): Promise<DiscoverIngestCandidatesResult> {
  if (args.chainId !== SUPPORTED_CHAIN_ID) {
    throw new UnsupportedIngestDiscoveryChainError(args.chainId);
  }

  const db = args.db ?? (getDb() as unknown as DiscoveryDbClient);
  const asOf = args.asOf ?? new Date();

  // Balances, LP positions, and materialization state are all wallet-scoped
  // queries that do not depend on each other, so they run in parallel.
  // Token and TokenMetadataSource lookups are deliberately NOT run in
  // parallel with balances: they must be narrowed to the wallet's own
  // discovered assetIds (never a chain-wide registry scan), so they can
  // only run after the balance rows are known.
  const [balances, lpPositions, materializationStateRow] = await Promise.all([
    db.portfolioTokenBalance.findMany({
      where: { walletId: args.walletId, chainId: args.chainId },
    }),
    db.portfolioLpPosition.findMany({
      where: { walletId: args.walletId, chainId: args.chainId },
    }),
    db.portfolioMaterializationState.findUnique({
      where: { walletId_chainId: { walletId: args.walletId, chainId: args.chainId } },
    }),
  ]);

  const materializationHealth = buildMaterializationHealth(materializationStateRow, asOf);

  if (!materializationHealth.healthy) {
    return {
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      totalBalanceRowsInspected: balances.length,
      totalEligibleBeforeCap: 0,
      totalReturned: 0,
      totalExcluded: 0,
      cap: CANDIDATE_CAP,
      truncated: false,
      eligible: [],
      excluded: [],
      materializationHealth,
    };
  }

  const walletAssetIds = Array.from(new Set(balances.map((balance) => balance.assetId)));

  const tokens =
    walletAssetIds.length > 0
      ? await db.token.findMany({
          where: { chainId: args.chainId, assetId: { in: walletAssetIds } },
        })
      : [];

  const tokenByAssetId = new Map(tokens.map((token) => [token.assetId, token]));
  const tokenIds = tokens.map((token) => token.id);
  const metadataSources =
    tokenIds.length > 0
      ? await db.tokenMetadataSource.findMany({ where: { tokenId: { in: tokenIds } } })
      : [];

  const sourcesByTokenId = new Map<string, MetadataSourceRow[]>();
  for (const source of metadataSources) {
    const list = sourcesByTokenId.get(source.tokenId) ?? [];
    list.push(source);
    sourcesByTokenId.set(source.tokenId, list);
  }

  const lpAssetIds = new Set(lpPositions.map((position) => position.lpAssetId));

  const eligible: EligibleIngestCandidate[] = [];
  const excluded: ExcludedIngestCandidate[] = [];
  const seenAssetIds = new Set<string>();

  // Ordinal comparison, not localeCompare: locale collation is not guaranteed
  // stable/ASCII-ordinal across environments, and canonical assetId ordering
  // must be deterministic regardless of the host locale.
  const sortedBalances = [...balances].sort((a, b) =>
    a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0,
  );

  for (const balance of sortedBalances) {
    if (seenAssetIds.has(balance.assetId)) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress: balance.assetAddress,
        reason: "DUPLICATE_ASSET",
        detail: "Duplicate assetId collapsed after the first canonical occurrence.",
      });
      continue;
    }
    seenAssetIds.add(balance.assetId);

    const identity = validateCanonicalIdentity({
      assetId: balance.assetId,
      requestedChainId: args.chainId,
      assetAddress: balance.assetAddress,
    });

    if (!identity.ok) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress: balance.assetAddress,
        reason: "INVALID_CANONICAL_IDENTITY",
        detail: identity.detail,
      });
      continue;
    }

    const tokenAddress = identity.tokenAddress;

    if (ZERO_DECIMAL_STRING_PATTERN.test(balance.balanceQuantity.toString())) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress,
        reason: "ZERO_BALANCE",
        detail: "Persisted balanceQuantity is zero.",
      });
      continue;
    }

    if (balance.decimals === null || balance.decimals === undefined) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress,
        reason: "MISSING_DECIMALS",
        detail: "Persisted PortfolioTokenBalance.decimals is null.",
      });
      continue;
    }

    if (
      !Number.isInteger(balance.decimals) ||
      balance.decimals < MIN_ACCEPTED_DECIMALS ||
      balance.decimals > MAX_ACCEPTED_DECIMALS
    ) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress,
        reason: "INVALID_DECIMALS",
        detail: `Persisted decimals ${balance.decimals} is outside the range [${MIN_ACCEPTED_DECIMALS}, ${MAX_ACCEPTED_DECIMALS}] accepted by POST /api/prices/ingest.`,
      });
      continue;
    }

    if (balance.assetId === PDAI_ASSET_ID) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress,
        reason: "PDAI_ROUTING_REFERENCE",
        detail: "pDAI is the pricing route's quote reference asset and is never self-priced.",
      });
      continue;
    }

    if (lpAssetIds.has(balance.assetId)) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress,
        reason: "UNSUPPORTED_ASSET_CLASS",
        detail: "assetId matches a canonical LP position identity for this wallet.",
      });
      continue;
    }

    const token = tokenByAssetId.get(balance.assetId);

    if (token?.isIgnored) {
      excludeRow(excluded, {
        assetId: balance.assetId,
        chainId: args.chainId,
        tokenAddress,
        reason: "IGNORED_ASSET",
        detail: "Token.isIgnored is true for this asset.",
      });
      continue;
    }

    if (token) {
      const sources = sourcesByTokenId.get(token.id) ?? [];
      // Include the persisted balance's own decimals in the comparison —
      // a balance row that disagrees with every metadata source is just as
      // much a conflict as metadata sources disagreeing with each other.
      if (detectDecimalsConflict([...sources, { decimals: balance.decimals }])) {
        excludeRow(excluded, {
          assetId: balance.assetId,
          chainId: args.chainId,
          tokenAddress,
          reason: "CONFLICTING_DECIMALS",
          detail:
            "Persisted PortfolioTokenBalance.decimals and TokenMetadataSource decimals evidence disagree for this token.",
        });
        continue;
      }
    }

    eligible.push({
      assetId: balance.assetId,
      tokenAddress,
      tokenDecimals: balance.decimals,
      quoteAsset: QUOTE_ASSET,
      walletAddress: args.walletAddress,
      chainId: args.chainId,
      decimalsSource: token?.decimalsSource ?? null,
    });
  }

  // `eligible` is currently in plain ascending assetId order (the loop
  // processed sortedBalances in that order). Reorder so PRIORITY_ASSET_IDS
  // (currently just native PLS) are placed first, in their documented
  // stable order, ahead of the 50-item cap — otherwise a wallet with 50+
  // eligible ERC-20 balances would always push native PLS past the cap.
  // Matched by exact canonical assetId only, never by symbol.
  const priorityEligible = PRIORITY_ASSET_IDS.map((id) =>
    eligible.find((candidate) => candidate.assetId === id),
  ).filter((candidate): candidate is EligibleIngestCandidate => candidate !== undefined);
  const priorityAssetIdSet = new Set(priorityEligible.map((candidate) => candidate.assetId));
  const restEligible = eligible.filter((candidate) => !priorityAssetIdSet.has(candidate.assetId));
  const orderedEligible = [...priorityEligible, ...restEligible];

  const totalEligibleBeforeCap = orderedEligible.length;
  const truncated = totalEligibleBeforeCap > CANDIDATE_CAP;
  const cappedEligible = orderedEligible.slice(0, CANDIDATE_CAP);

  return {
    chainId: args.chainId,
    walletAddress: args.walletAddress,
    totalBalanceRowsInspected: balances.length,
    totalEligibleBeforeCap,
    totalReturned: cappedEligible.length,
    totalExcluded: excluded.length,
    cap: CANDIDATE_CAP,
    truncated,
    eligible: cappedEligible,
    excluded,
    materializationHealth,
  };
}
