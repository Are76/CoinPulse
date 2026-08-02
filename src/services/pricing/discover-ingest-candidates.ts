import "server-only";

import {
  CORE_ASSETS,
  PULSECHAIN_NATIVE_ASSET_ID,
  PULSECHAIN_NATIVE_TOKEN_ADDRESS,
} from "@/config/assets";
import { getDb } from "@/lib/db";
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
 * Eligibility does not prove priceability, a valid PulseX route, or a
 * verified USD price. See docs/project-decisions.md D-004/D-006 — the
 * existing pricing resolver remains the sole authority on quote truth.
 */

const SUPPORTED_CHAIN_ID = 369;
const CANDIDATE_CAP = 50;
const QUOTE_ASSET = "fiat:usd";

// Real persisted assetId strings embed a lowercased token address (see
// src/services/sync/sync-common.ts buildAssetId equivalent). CORE_ASSETS.pdai
// uses a checksummed (mixed-case) address for viem Address typing, so the
// comparison must lowercase it first — same approach as
// src/services/pricing/price-resolver.ts PDAI_QUOTE_ASSET_ID.
const PDAI_ASSET_ID = CORE_ASSETS.pdai.assetId.toLowerCase();

const CANONICAL_ASSET_ID_PATTERN = /^chain:(\d+):(erc20|native):(0x[0-9a-f]{40})$/;
const ZERO_DECIMAL_STRING_PATTERN = /^-?0(\.0+)?$/;

export type IngestCandidateExclusionReason =
  | "ZERO_BALANCE"
  | "MISSING_DECIMALS"
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
};

export type DiscoverIngestCandidatesArgs = {
  chainId: number;
  walletId: string;
  walletAddress: string;
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

  if (embeddedAddress !== args.assetAddress.toLowerCase()) {
    return {
      ok: false,
      detail: "assetId token address does not match the persisted assetAddress for this row.",
    };
  }

  return { ok: true, tokenAddress: args.assetAddress };
}

/**
 * Discovers wallet-scoped, chain-369-scoped price-ingestion candidates from
 * current non-zero canonical `PortfolioTokenBalance` state.
 *
 * Pure with respect to time: takes no wall-clock dependency and always
 * returns a deterministic result for the same persisted database state.
 * Strictly read-only — issues no writes and calls no RPC.
 */
export async function discoverPriceIngestCandidates(
  args: DiscoverIngestCandidatesArgs,
): Promise<DiscoverIngestCandidatesResult> {
  if (args.chainId !== SUPPORTED_CHAIN_ID) {
    throw new UnsupportedIngestDiscoveryChainError(args.chainId);
  }

  const db = args.db ?? (getDb() as unknown as DiscoveryDbClient);

  // Balances and LP positions are both wallet-scoped queries that do not
  // depend on each other, so they run in parallel. Token and
  // TokenMetadataSource lookups are deliberately NOT run in parallel with
  // balances: they must be narrowed to the wallet's own discovered assetIds
  // (never a chain-wide registry scan), so they can only run after the
  // balance rows are known.
  const [balances, lpPositions] = await Promise.all([
    db.portfolioTokenBalance.findMany({
      where: { walletId: args.walletId, chainId: args.chainId },
    }),
    db.portfolioLpPosition.findMany({
      where: { walletId: args.walletId, chainId: args.chainId },
    }),
  ]);

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
      if (detectDecimalsConflict(sources)) {
        excludeRow(excluded, {
          assetId: balance.assetId,
          chainId: args.chainId,
          tokenAddress,
          reason: "CONFLICTING_DECIMALS",
          detail: "TokenMetadataSource rows disagree on decimals for this token.",
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

  const totalEligibleBeforeCap = eligible.length;
  const truncated = totalEligibleBeforeCap > CANDIDATE_CAP;
  const cappedEligible = eligible.slice(0, CANDIDATE_CAP);

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
  };
}
