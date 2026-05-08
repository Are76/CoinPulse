export type ReorgMismatch = {
  blockNumber: bigint;
  expectedBlockHash: string;
  observedBlockHash: string;
};

export type ReorgWindow = {
  fromBlock: bigint;
  toBlock: bigint;
};

export function detectReorgMismatch(args: {
  blockNumber: bigint;
  expectedBlockHash: string;
  observedBlockHash: string;
}): ReorgMismatch | null {
  if (
    args.expectedBlockHash.toLowerCase() === args.observedBlockHash.toLowerCase()
  ) {
    return null;
  }

  return {
    blockNumber: args.blockNumber,
    expectedBlockHash: args.expectedBlockHash,
    observedBlockHash: args.observedBlockHash,
  };
}

export function buildBoundedReorgWindow(args: {
  detectedBlockNumber: bigint;
  latestIngestedBlockNumber: bigint;
  maxDepth: bigint;
}): ReorgWindow {
  if (args.maxDepth < 0n) {
    throw new Error("maxDepth cannot be negative");
  }

  if (args.detectedBlockNumber > args.latestIngestedBlockNumber) {
    throw new Error("detected block cannot be ahead of the latest ingested block");
  }

  const fromBlock = maxBigInt(0n, args.latestIngestedBlockNumber - args.maxDepth);

  return {
    fromBlock,
    toBlock: args.latestIngestedBlockNumber,
  };
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}
