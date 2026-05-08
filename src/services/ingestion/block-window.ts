export type BlockWindow = {
  fromBlock: bigint;
  toBlock: bigint;
};

type BuildAdaptiveWindowsArgs = {
  startBlock: bigint;
  endBlock: bigint;
  maxWindowSize: bigint;
};

export function getBlockWindowSize(window: BlockWindow) {
  return window.toBlock - window.fromBlock + 1n;
}

export function buildAdaptiveWindows(
  args: BuildAdaptiveWindowsArgs,
): BlockWindow[] {
  if (args.maxWindowSize <= 0n) {
    throw new Error("maxWindowSize must be greater than zero");
  }

  if (args.endBlock < args.startBlock) {
    return [];
  }

  const windows: BlockWindow[] = [];
  let cursor = args.startBlock;

  while (cursor <= args.endBlock) {
    const toBlock = minBigInt(
      cursor + args.maxWindowSize - 1n,
      args.endBlock,
    );

    windows.push({
      fromBlock: cursor,
      toBlock,
    });

    cursor = toBlock + 1n;
  }

  return windows;
}

export function splitBlockWindow(window: BlockWindow): BlockWindow[] {
  const size = getBlockWindowSize(window);

  if (size <= 1n) {
    return [window];
  }

  const midpoint = window.fromBlock + size / 2n - 1n;

  return [
    {
      fromBlock: window.fromBlock,
      toBlock: midpoint,
    },
    {
      fromBlock: midpoint + 1n,
      toBlock: window.toBlock,
    },
  ];
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}
