import { describe, expect, it } from "vitest";

import { mergeCursorWindow } from "@/services/sync/sync-state-store";

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
