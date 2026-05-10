import { ApiClientError } from "@/lib/api/dashboard-client";

export type SubmittedParams = {
  walletAddress: string;
  chainId: number;
};

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
