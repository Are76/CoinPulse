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

  // The bounded policy applies to how far back we inspect for possible reorgs.
  // Once a mismatch is found, every descendant block through the latest ingested
  // block is affected and must stop being treated as canonical in the raw layer.
  return {
    fromBlock: args.detectedBlockNumber,
    toBlock: args.latestIngestedBlockNumber,
  };
}
