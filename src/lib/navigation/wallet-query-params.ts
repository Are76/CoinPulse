/**
 * Wallet navigation URL parameter helpers.
 *
 * These helpers carry validated wallet/chain navigation context between
 * portfolio screens via URL query parameters. The URL is navigation context
 * only — it is never proof that a query was submitted, and it never replaces
 * backend truth or TanStack Query cache state.
 *
 * Scope is intentionally narrow: read `walletAddress`/`chainId` from search
 * params, validate them for navigation, and build destination hrefs. No API
 * fetching, no React state, no token-amount handling.
 */

import { SUPPORTED_CHAINS } from "@/config/chains";

export const WALLET_ADDRESS_PARAM = "walletAddress";
export const CHAIN_ID_PARAM = "chainId";

export type WalletNavContext = {
  walletAddress: string;
  chainId: number;
};

/** Minimal read surface shared by URLSearchParams and Next's ReadonlyURLSearchParams. */
export type WalletParamSource = { get(name: string): string | null };

/**
 * Parses a chainId query parameter into a safe positive integer.
 * chainId is control metadata, not a token amount, so numeric coercion is
 * allowed here. Rejects empty, non-digit, zero, and unsafe-integer values.
 */
export function parseChainIdParam(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function isSupportedNavChainId(chainId: number): boolean {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CHAINS, chainId);
}

/**
 * Reads validated wallet navigation context from search params.
 * Returns null unless both a non-empty (trimmed) walletAddress and a
 * SUPPORTED_CHAINS chainId are present. Invalid params never produce context.
 */
export function parseWalletNavContext(
  searchParams: WalletParamSource | null | undefined,
): WalletNavContext | null {
  if (searchParams === null || searchParams === undefined) return null;

  const walletAddress = (searchParams.get(WALLET_ADDRESS_PARAM) ?? "").trim();
  if (walletAddress.length === 0) return null;

  const chainId = parseChainIdParam(searchParams.get(CHAIN_ID_PARAM));
  if (chainId === null || !isSupportedNavChainId(chainId)) return null;

  return { walletAddress, chainId };
}

/**
 * Builds a destination href carrying only walletAddress and chainId.
 * With no context, returns the plain path unchanged. Other query parameters
 * (including assetId) are never carried by general navigation.
 */
export function buildWalletNavHref(
  path: string,
  context: WalletNavContext | null,
): string {
  if (context === null) return path;
  const params = new URLSearchParams({
    [WALLET_ADDRESS_PARAM]: context.walletAddress,
    [CHAIN_ID_PARAM]: String(context.chainId),
  });
  return `${path}?${params.toString()}`;
}
