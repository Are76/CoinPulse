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
}): ReorgWindow {
  if (args.detectedBlockNumber > args.latestIngestedBlockNumber) {
    throw new Error("detected block cannot be ahead of the latest ingested block");
  }

  // The bounded policy is in the detection phase that decides whether we inspect
  // a block for reorg mismatch. Once a mismatch is detected, every descendant
  // raw record through the latest ingested block must stop being treated as
  // canonical.
  return {
    fromBlock: args.detectedBlockNumber,
    toBlock: args.latestIngestedBlockNumber,
  };
}
