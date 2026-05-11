import { describe, expect, it } from "vitest";

import { ApiClientError } from "@/lib/api/dashboard-client";
import {
  getDashboardErrorMessage,
  getDashboardMetaErrorMessage,
  resolveDashboardSubmission,
  findTrackedWalletMatch,
  findTrackedWalletLabel,
} from "@/components/dashboard/dashboard-screen-helpers";
import type { TrackedWalletDto } from "@/lib/api/debug-client";

const WALLET: TrackedWalletDto = {
  id: "w1",
  address: "0x1111111111111111111111111111111111111111",
  chainId: 369,
  label: "Primary",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("dashboard screen helpers", () => {
  it("rejects blank wallet submissions through the existing error path", () => {
    expect(
      resolveDashboardSubmission({
        walletAddress: "   ",
        chainId: "369",
      }),
    ).toEqual({
      validationError: "Wallet address is required.",
      submittedParams: null,
    });
  });

  it("trims valid wallet submissions before storing submitted params", () => {
    expect(
      resolveDashboardSubmission({
        walletAddress: "  0x1111111111111111111111111111111111111111  ",
        chainId: "369",
      }),
    ).toEqual({
      validationError: null,
      submittedParams: {
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 369,
      },
    });
  });

  it("preserves backend-provided health/status ApiClientError messages", () => {
    expect(
      getDashboardMetaErrorMessage({
        healthError: new ApiClientError({
          status: 503,
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Redis unavailable.",
        }),
        statusError: null,
      }),
    ).toBe("Redis unavailable.");
  });

  it("falls back to generic unknown frontend errors only when needed", () => {
    expect(getDashboardErrorMessage("boom")).toBe("Unknown frontend error.");
  });
});

describe("findTrackedWalletMatch", () => {
  it("returns the matching wallet for exact address and chainId", () => {
    expect(findTrackedWalletMatch([WALLET], WALLET.address, "369")).toEqual(WALLET);
  });

  it("returns the matching wallet with case-insensitive address comparison", () => {
    expect(
      findTrackedWalletMatch([WALLET], WALLET.address.toUpperCase(), "369"),
    ).toEqual(WALLET);
  });

  it("returns null when chainId does not match", () => {
    expect(findTrackedWalletMatch([WALLET], WALLET.address, "1")).toBeNull();
  });

  it("returns null when address does not match", () => {
    expect(
      findTrackedWalletMatch(
        [WALLET],
        "0x0000000000000000000000000000000000000000",
        "369",
      ),
    ).toBeNull();
  });

  it("returns null when wallets is undefined", () => {
    expect(findTrackedWalletMatch(undefined, WALLET.address, "369")).toBeNull();
  });

  it("returns null when wallets is empty", () => {
    expect(findTrackedWalletMatch([], WALLET.address, "369")).toBeNull();
  });

  it("returns null when walletAddress is empty string", () => {
    expect(findTrackedWalletMatch([WALLET], "", "369")).toBeNull();
  });

  it("returns null when chainId is empty string", () => {
    expect(findTrackedWalletMatch([WALLET], WALLET.address, "")).toBeNull();
  });
});

describe("findTrackedWalletLabel", () => {
  it("returns the label for a matching wallet", () => {
    expect(findTrackedWalletLabel([WALLET], WALLET.address, "369")).toBe("Primary");
  });

  it("returns Unlabeled when a matching wallet has no label", () => {
    const unlabeled: TrackedWalletDto = { ...WALLET, label: null };
    expect(findTrackedWalletLabel([unlabeled], unlabeled.address, "369")).toBe("Unlabeled");
  });

  it("returns null when no wallet matches", () => {
    expect(findTrackedWalletLabel([WALLET], WALLET.address, "1")).toBeNull();
  });
});
