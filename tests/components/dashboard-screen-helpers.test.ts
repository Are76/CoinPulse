import { describe, expect, it } from "vitest";

import { ApiClientError } from "@/lib/api/dashboard-client";
import {
  getDashboardErrorMessage,
  getDashboardMetaErrorMessage,
  resolveDashboardSubmission,
} from "@/components/dashboard/dashboard-screen-helpers";

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
