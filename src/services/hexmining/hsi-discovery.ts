import "server-only";

import { parseAbi, type PublicClient } from "viem";

import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";
import {
  persistHsiStakeObservation,
  type PersistHsiStakeObservationInput,
} from "@/services/hexmining/hsi-observation-store";
import { getDb } from "@/lib/db";

// ─── Hedron ERC-721 ABI ───────────────────────────────────────────────────────
//
// Hedron implements ERC-721 Enumerable. HSI NFT ownership is enumerated via
// balanceOf → tokenOfOwnerByIndex. No stake struct reads are performed here
// — stake data is out of scope for the discovery slice.

const HEDRON_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type HsiDiscoveryReadClient = Pick<PublicClient, "readContract" | "getBlockNumber">;

export type DiscoverHsiStakeObservationsInput = {
  chainId: number;
  walletAddress: string;
  hsiAddress: string;
  observedAt?: Date;
};

export type DiscoverHsiStakeObservationsResult =
  | {
      ok: true;
      discovered: number;
      persisted: number;
      skipped: number;
      observedAtBlock: string;
      warnings: string[];
    }
  | {
      ok: false;
      code: string;
      warnings: string[];
    };

// ─── Narrow persistence client type ──────────────────────────────────────────

type PersistenceClient = Parameters<typeof persistHsiStakeObservation>[1];

export type HsiDiscoveryDeps = {
  publicClient: HsiDiscoveryReadClient;
  persistenceClient?: PersistenceClient;
};

// ─── Warning codes ────────────────────────────────────────────────────────────

const WARN_STAKE_FIELDS_UNKNOWN = "hexmining-hsi-stake-fields-unknown";

// ─── Discovery service ────────────────────────────────────────────────────────
//
// Enumerates all HSI NFTs owned by a wallet via the Hedron ERC-721 contract,
// then persists one RawHsiStakeObservation per token using the existing
// persistence contract. Stake struct fields (stakeId, stakeIndex, etc.) are
// not read here — they are left null and isComplete is set to false to signal
// that enrichment is needed in a future reader slice.
//
// The observed block number is captured once at the start and used for all
// observations in this batch so the set is internally consistent.

export async function discoverHsiStakeObservations(
  input: DiscoverHsiStakeObservationsInput,
  deps: HsiDiscoveryDeps,
): Promise<DiscoverHsiStakeObservationsResult> {
  const persistenceClient =
    deps.persistenceClient ??
    (getDb() as unknown as PersistenceClient);

  const walletAddress = input.walletAddress.toLowerCase();
  const hsiAddress = input.hsiAddress.toLowerCase();
  const observedAt = input.observedAt ?? new Date();
  const warnings: string[] = [];

  // Step 1: Capture the current block number so all observations share a
  // consistent "observed at" snapshot reference.
  let observedAtBlock: bigint;
  try {
    observedAtBlock = await deps.publicClient.getBlockNumber();
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    return {
      ok: false,
      code: `hexmining-hsi-discovery-block-rpc-${failure.code}`,
      warnings,
    };
  }

  // Step 2: Read the wallet's HSI balance from the Hedron contract.
  let balance: bigint;
  try {
    balance = (await deps.publicClient.readContract({
      address: hsiAddress as `0x${string}`,
      abi: HEDRON_ABI,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`],
    })) as bigint;
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    return {
      ok: false,
      code: `hexmining-hsi-discovery-balance-rpc-${failure.code}`,
      warnings,
    };
  }

  const discovered = Number(balance);

  if (discovered === 0) {
    return {
      ok: true,
      discovered: 0,
      persisted: 0,
      skipped: 0,
      observedAtBlock: observedAtBlock.toString(),
      warnings,
    };
  }

  // Step 3: Enumerate each token by index and persist an observation.
  let persisted = 0;
  let skipped = 0;

  for (let i = 0; i < discovered; i++) {
    // Fetch the token ID at this ownership index.
    let tokenId: bigint;
    try {
      tokenId = (await deps.publicClient.readContract({
        address: hsiAddress as `0x${string}`,
        abi: HEDRON_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [walletAddress as `0x${string}`, BigInt(i)],
      })) as bigint;
    } catch (error) {
      const failure = classifyRpcFailure({ error });
      warnings.push(
        `hexmining-hsi-discovery-tokenindex-rpc-${failure.code}:index=${i}`,
      );
      skipped++;
      continue;
    }

    const hsiTokenId = tokenId.toString();

    const observationInput: PersistHsiStakeObservationInput = {
      chainId: input.chainId,
      walletAddress,
      hsiTokenId,
      hsiAddress,
      stakeId: null,
      stakeIndex: null,
      stakedDays: null,
      lockedDay: null,
      stakeShares: null,
      principalHex: null,
      observedAtBlock,
      observedAt,
      isComplete: false,
      warnings: [WARN_STAKE_FIELDS_UNKNOWN],
    };

    const result = await persistHsiStakeObservation(
      observationInput,
      persistenceClient,
    );

    if (result.created) {
      persisted++;
    } else {
      skipped++;
    }
  }

  return {
    ok: true,
    discovered,
    persisted,
    skipped,
    observedAtBlock: observedAtBlock.toString(),
    warnings,
  };
}
