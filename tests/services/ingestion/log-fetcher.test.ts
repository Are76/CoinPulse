import { describe, expect, it, vi } from "vitest";

import { fetchLogsWithAdaptiveRetry, type RpcLog } from "@/services/ingestion/log-fetcher";

describe("fetchLogsWithAdaptiveRetry", () => {
  it("gives split child windows a fresh retry budget", async () => {
    const sleep = vi.fn(async () => {});
    const attempts = new Map<string, number>();
    const client = {
      async getLogs(args: { fromBlock: bigint; toBlock: bigint }) {
        const key = `${args.fromBlock}-${args.toBlock}`;
        const nextAttempt = (attempts.get(key) ?? 0) + 1;

        attempts.set(key, nextAttempt);

        if (key === "10-13") {
          throw new Error("parent window too large");
        }

        if (key === "10-11" && nextAttempt === 1) {
          throw new Error("child window transient failure");
        }

        const log: RpcLog = {
          address: "0xabc",
          blockHash: "0xhash",
          blockNumber: args.fromBlock,
          data: "0x",
          logIndex: 0,
          transactionHash: "0xtx",
          topics: [],
        };

        return [log];
      },
    };

    const result = await fetchLogsWithAdaptiveRetry({
      client,
      windows: [{ fromBlock: 10n, toBlock: 13n }],
      minWindowSize: 2n,
      maxAttemptsPerWindow: 2,
      baseBackoffMs: 1,
      sleep,
    });

    expect(result.logs).toHaveLength(2);
    expect(attempts.get("10-13")).toBe(1);
    expect(attempts.get("10-11")).toBe(2);
    expect(attempts.get("12-13")).toBe(1);
  });

  it("rejects non-positive minWindowSize values", async () => {
    await expect(
      fetchLogsWithAdaptiveRetry({
        client: {
          getLogs: vi.fn(),
        },
        windows: [{ fromBlock: 1n, toBlock: 1n }],
        minWindowSize: 0n,
      }),
    ).rejects.toThrow("minWindowSize must be greater than zero");
  });
});
