import { describe, expect, it } from "vitest";

import {
  capWarningDetails,
  mergeCursorWindow,
  WARNING_DETAIL_LIMIT,
} from "@/services/sync/sync-state-store";

describe("capWarningDetails", () => {
  it("passes through arrays within the limit unchanged", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT }, (_, i) => `warning-${i}`);
    const result = capWarningDetails(warnings);
    expect(result).toHaveLength(WARNING_DETAIL_LIMIT);
    expect(result[0]).toBe("warning-0");
    expect(result[WARNING_DETAIL_LIMIT - 1]).toBe(`warning-${WARNING_DETAIL_LIMIT - 1}`);
  });

  it("caps at WARNING_DETAIL_LIMIT and appends a truncation sentinel", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT + 5 }, (_, i) => `w-${i}`);
    const result = capWarningDetails(warnings);
    expect(result).toHaveLength(WARNING_DETAIL_LIMIT + 1);
    expect(result[WARNING_DETAIL_LIMIT]).toBe("[truncated: 5 additional warnings not stored]");
  });

  it("uses singular form when exactly 1 entry is omitted", () => {
    const warnings = Array.from({ length: WARNING_DETAIL_LIMIT + 1 }, (_, i) => `w-${i}`);
    const result = capWarningDetails(warnings);
    expect(result[WARNING_DETAIL_LIMIT]).toBe("[truncated: 1 additional warning not stored]");
  });

  it("returns a copy — does not mutate the input array", () => {
    const warnings = ["a", "b"];
    const result = capWarningDetails(warnings);
    result.push("c");
    expect(warnings).toHaveLength(2);
  });

  it("handles an empty array", () => {
    expect(capWarningDetails([])).toEqual([]);
  });
});

describe("mergeCursorWindow", () => {
  it("does not overstate coverage when a later rerun leaves a gap after the current high-water mark", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 120n,
          blockHash: "0x120",
        },
        next: {
          fromBlock: 200n,
          toBlock: 250n,
          blockHash: "0x250",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 120n,
      blockHash: "0x120",
      changed: false,
    });
  });

  it("preserves the high-water mark when rerunning an older historical range", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 150n,
          blockHash: "0xnewest",
        },
        next: {
          fromBlock: 50n,
          toBlock: 120n,
          blockHash: "0xolder",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 150n,
      blockHash: "0xnewest",
      changed: false,
    });
  });

  it("advances the cursor when a later range completes", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 120n,
          blockHash: "0xold",
        },
        next: {
          fromBlock: 121n,
          toBlock: 150n,
          blockHash: "0xnew",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 150n,
      blockHash: "0xnew",
      changed: true,
    });
  });

  it("preserves the existing high-water hash when a rerun ends at the same block", () => {
    expect(
      mergeCursorWindow({
        existing: {
          fromBlock: 0n,
          toBlock: 150n,
          blockHash: "0xexisting",
        },
        next: {
          fromBlock: 100n,
          toBlock: 150n,
          blockHash: "0xreplacement",
        },
      }),
    ).toEqual({
      fromBlock: 0n,
      toBlock: 150n,
      blockHash: "0xexisting",
      changed: false,
    });
  });
});
