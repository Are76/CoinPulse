import { ApiClientError } from "@/lib/api/dashboard-client";
import type { TrackedWalletDto } from "@/lib/api/debug-client";

export type SubmittedParams = {
  walletAddress: string;
  chainId: number;
};

/**
 * Returns a UI-ready string describing the source of the submitted wallet.
 * Returns null when no params have been submitted yet (before first submit).
 * - Tracked wallet match: "Submitted from tracked wallet: {label}"
 * - No match: "Submitted from manual entry"
 */
export function resolveSubmittedWalletSource(
  submittedParams: SubmittedParams | null,
  wallets: TrackedWalletDto[] | undefined,
): string | null {
  if (submittedParams === null) return null;
  const label = findTrackedWalletLabel(
    wallets,
    submittedParams.walletAddress,
    String(submittedParams.chainId),
  );
  if (label !== null) {
    return `Submitted from tracked wallet: ${label}`;
  }
  return "Submitted from manual entry";
}

/**
 * Returns the label of the tracked wallet that matches the given address and
 * chainId, or null if no match is found. Case-insensitive address comparison.
 * Returns "Unlabeled" when a match is found but the wallet has no label.
 */
export function findTrackedWalletLabel(
  wallets: TrackedWalletDto[] | undefined,
  walletAddress: string,
  chainId: string,
): string | null {
  if (!wallets || !walletAddress || !chainId) return null;
  const match = wallets.find(
    (w) =>
      w.address.toLowerCase() === walletAddress.toLowerCase() &&
      String(w.chainId) === chainId,
  );
  return match !== undefined ? (match.label ?? "Unlabeled") : null;
}

export function resolveDashboardSubmission(args: {
  walletAddress: string;
  chainId: string;
}):
  | { validationError: string; submittedParams: null }
  | { validationError: null; submittedParams: SubmittedParams } {
  const walletAddress = args.walletAddress.trim();
  if (walletAddress.length === 0) {
    return {
      validationError: "Wallet address is required.",
      submittedParams: null,
    };
  }

  const chainId = Number(args.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return {
      validationError: "Chain ID must be a positive integer.",
      submittedParams: null,
    };
  }

  return {
    validationError: null,
    submittedParams: {
      walletAddress,
      chainId,
    },
  };
}

export function getDashboardMetaErrorMessage(args: {
  healthError: unknown;
  statusError: unknown;
}) {
  if (args.healthError !== null && args.healthError !== undefined) {
    return getDashboardErrorMessage(args.healthError);
  }

  if (args.statusError !== null && args.statusError !== undefined) {
    return getDashboardErrorMessage(args.statusError);
  }

  return null;
}

export function getDashboardErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown frontend error.";
}
