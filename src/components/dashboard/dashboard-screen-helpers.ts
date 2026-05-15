import { ApiClientError } from "@/lib/api/dashboard-client";
import type { TrackedWalletDto } from "@/lib/api/debug-client";

export type SubmittedParams = {
  walletAddress: string;
  chainId: number;
};

type NormalizedWalletSelection = {
  walletAddress: string;
  chainId: number;
};

export function normalizeWalletSelectionInput(args: {
  walletAddress: string;
  chainId: string | number;
}): NormalizedWalletSelection | null {
  const walletAddress = args.walletAddress.trim();
  const chainId = Number(args.chainId);

  if (walletAddress.length === 0 || !Number.isInteger(chainId) || chainId <= 0) {
    return null;
  }

  return {
    walletAddress: walletAddress.toLowerCase(),
    chainId,
  };
}

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
    submittedParams.chainId,
  );
  if (label !== null) {
    return `Submitted from tracked wallet: ${label}`;
  }
  return "Submitted from manual entry";
}

/**
 * Returns the TrackedWalletDto whose address and chainId match the given
 * values, or null if no match is found. Address matching trims input and is
 * case-insensitive. chainId is normalized through Number(...) so equivalent
 * form values such as "0369" and 369 match.
 */
export function findTrackedWalletMatch(
  wallets: TrackedWalletDto[] | undefined,
  walletAddress: string,
  chainId: string | number,
): TrackedWalletDto | null {
  if (!wallets) return null;

  const normalizedSelection = normalizeWalletSelectionInput({
    walletAddress,
    chainId,
  });
  if (normalizedSelection === null) return null;

  return (
    wallets.find((wallet) => {
      const normalizedWallet = normalizeWalletSelectionInput({
        walletAddress: wallet.address,
        chainId: wallet.chainId,
      });

      return (
        normalizedWallet !== null &&
        normalizedWallet.walletAddress === normalizedSelection.walletAddress &&
        normalizedWallet.chainId === normalizedSelection.chainId
      );
    }) ?? null
  );
}

/**
 * Returns the label of the tracked wallet that matches the given address and
 * chainId, or null if no match is found. Case-insensitive address comparison.
 * Returns "Unlabeled" when a match is found but the wallet has no label.
 */
export function findTrackedWalletLabel(
  wallets: TrackedWalletDto[] | undefined,
  walletAddress: string,
  chainId: string | number,
): string | null {
  const match = findTrackedWalletMatch(wallets, walletAddress, chainId);
  return match !== null ? (match.label ?? "Unlabeled") : null;
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
