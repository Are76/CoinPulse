import type { BlockWindow } from "@/services/ingestion/block-window";
import { getBlockWindowSize, splitBlockWindow } from "@/services/ingestion/block-window";

export type RpcLog = {
  address: string;
  blockHash: string | null;
  blockNumber: bigint | null;
  data: string;
  logIndex: number | null;
  transactionHash: string | null;
  topics: readonly string[];
};

export type LogFetcherClient = {
  getLogs(args: {
    address?: string | readonly string[];
    topics?: readonly (string | readonly string[] | null)[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly RpcLog[]>;
};

type FetchLogsWithAdaptiveRetryArgs = {
  client: LogFetcherClient;
  windows: readonly BlockWindow[];
  address?: string | readonly string[];
  topics?: readonly (string | readonly string[] | null)[];
  minWindowSize?: bigint;
  maxAttemptsPerWindow?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type WindowAttempt = BlockWindow & {
  attempt: number;
};

export async function fetchLogsWithAdaptiveRetry(
  args: FetchLogsWithAdaptiveRetryArgs,
) {
  const sleep = args.sleep ?? defaultSleep;
  const minWindowSize = args.minWindowSize ?? 32n;
  const maxAttemptsPerWindow = args.maxAttemptsPerWindow ?? 3;
  const baseBackoffMs = args.baseBackoffMs ?? 250;
  const queue: WindowAttempt[] = args.windows.map((window) => ({
    ...window,
    attempt: 1,
  }));
  const logs: RpcLog[] = [];
  const attemptedWindows: BlockWindow[] = [];

  while (queue.length > 0) {
    const currentWindow = queue.shift();

    if (!currentWindow) {
      break;
    }

    attemptedWindows.push({
      fromBlock: currentWindow.fromBlock,
      toBlock: currentWindow.toBlock,
    });

    try {
      const result = await args.client.getLogs({
        address: args.address,
        topics: args.topics,
        fromBlock: currentWindow.fromBlock,
        toBlock: currentWindow.toBlock,
      });

      logs.push(...result);
    } catch (error) {
      const size = getBlockWindowSize(currentWindow);

      if (size > minWindowSize) {
        await sleep(baseBackoffMs * currentWindow.attempt);
        const splitWindows = splitBlockWindow(currentWindow);

        queue.unshift(
          ...splitWindows.map((window) => ({
            ...window,
            attempt: currentWindow.attempt + 1,
          })),
        );

        continue;
      }

      if (currentWindow.attempt < maxAttemptsPerWindow) {
        await sleep(baseBackoffMs * 2 ** (currentWindow.attempt - 1));
        queue.unshift({
          ...currentWindow,
          attempt: currentWindow.attempt + 1,
        });

        continue;
      }

      throw new Error(
        `Failed to fetch logs for ${currentWindow.fromBlock}-${currentWindow.toBlock}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    logs,
    attemptedWindows,
  };
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
