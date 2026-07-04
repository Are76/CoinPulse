import "server-only";

import { parseAbi, type PublicClient } from "viem";

import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";
import {
  enrichHsiStakeObservation,
  readHsiStakeObservations,
  validateHsiTokenId,
  type EnrichHsiStakeObservationInput,
  type PersistedHsiStakeObservation,
} from "@/services/hexmining/hsi-observation-store";
import { getDb } from "@/lib/db";

// ─── Hedron HSI ABI ─────────────────────────────────────────────────────────────
//
// Enrichment resolves the underlying HEX stake wrapped by each tokenized HSI.
//
//   1. `hsiToken(tokenId)` on the Hedron HEXStakeInstanceManager (the ERC-721
//      contract discovery observed against, stored as `hsiAddress`) returns the
//      per-stake HEXStakeInstance (HSI) contract address for that NFT.
//   2. `stakeDataFetch()` on that HSI contract returns the underlying HEX stake
//      struct — the same seven-field shape HEX `stakeLists` exposes.
//
// No valuation, yield, or pricing is derived here — only the raw stake metadata
// required to complete the observation is read.

const HSIM_ABI = parseAbi([
  "function hsiToken(uint256 tokenId) view returns (address)",
]);

const HSI_ABI = parseAbi([
  "function stakeDataFetch() view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)",
]);

const PULSECHAIN_CHAIN_ID = 369;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Every tokenized HSI wraps exactly one HEX stake, and that stake always lives
// at index 0 of the HSI contract's own HEX stake list. The index is therefore a
// structural invariant of the HSI design, not a value read from (or inferred
// beyond) the stake struct. It is not fabricated financial data.
const HSI_UNDERLYING_STAKE_INDEX = 0;

// Discovery writes this warning on every incomplete observation. Successful
// enrichment removes it because the stake fields are no longer unknown.
const WARN_STAKE_FIELDS_UNKNOWN = "hexmining-hsi-stake-fields-unknown";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HsiReaderReadClient = Pick<PublicClient, "readContract">;

type PersistenceClient = Parameters<typeof enrichHsiStakeObservation>[1];

export type EnrichHsiStakeObservationsInput = {
  chainId: number;
  walletAddress: string;
};

export type HsiReaderDeps = {
  publicClient: HsiReaderReadClient;
  persistenceClient?: PersistenceClient;
};

export type HsiEnrichmentOutcome =
  | { id: string; hsiTokenId: string; status: "enriched" }
  | { id: string; hsiTokenId: string; status: "skipped_already_complete" }
  | { id: string; hsiTokenId: string; status: "missing"; code: string }
  | { id: string; hsiTokenId: string; status: "failed"; code: string };

export type EnrichHsiStakeObservationsResult =
  | {
      ok: true;
      scanned: number;
      enriched: number;
      skipped: number;
      missing: number;
      failed: number;
      outcomes: HsiEnrichmentOutcome[];
      warnings: string[];
    }
  | {
      ok: false;
      code: string;
      warnings: string[];
    };

// ─── Reader service ─────────────────────────────────────────────────────────────
//
// Consumes previously discovered observations and enriches the incomplete ones
// with their underlying HEX stake metadata. It never performs wallet discovery
// and never enumerates NFTs — discovery already did that. Reader responsibilities
// are strictly: read (persisted observations + on-chain stake), validate, enrich,
// and persist the completed row.
//
// Per observation, all reads are pinned to the observation's own captured
// observedAtBlock so the enriched data is a consistent snapshot of the block the
// HSI was discovered at.

export async function enrichHsiStakeObservations(
  input: EnrichHsiStakeObservationsInput,
  deps: HsiReaderDeps,
): Promise<EnrichHsiStakeObservationsResult> {
  if (input.chainId !== PULSECHAIN_CHAIN_ID) {
    return {
      ok: false,
      code: "hexmining-hsi-reader-unsupported-chain",
      warnings: [],
    };
  }

  const persistenceClient =
    deps.persistenceClient ?? (getDb() as unknown as PersistenceClient);

  const walletAddress = input.walletAddress.toLowerCase();

  const observations = await readHsiStakeObservations(
    { chainId: input.chainId, walletAddress },
    persistenceClient,
  );

  const incomplete = observations.filter((o) => !o.isComplete);

  const outcomes: HsiEnrichmentOutcome[] = [];
  let enriched = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;

  for (const observation of observations) {
    if (observation.isComplete) {
      skipped++;
      outcomes.push({
        id: observation.id,
        hsiTokenId: observation.hsiTokenId,
        status: "skipped_already_complete",
      });
      continue;
    }

    const outcome = await enrichOne(observation, deps.publicClient, persistenceClient);
    outcomes.push(outcome);

    if (outcome.status === "enriched") enriched++;
    else if (outcome.status === "missing") missing++;
    else if (outcome.status === "failed") failed++;
  }

  return {
    ok: true,
    scanned: incomplete.length,
    enriched,
    skipped,
    missing,
    failed,
    outcomes,
    warnings: [],
  };
}

// ─── Single-observation enrichment ──────────────────────────────────────────────
//
// Returns a structured outcome and never throws. On any missing/failed path the
// observation row is left completely unchanged (no partial writes, no fabricated
// values).

async function enrichOne(
  observation: PersistedHsiStakeObservation,
  publicClient: HsiReaderReadClient,
  persistenceClient: PersistenceClient,
): Promise<HsiEnrichmentOutcome> {
  const base = { id: observation.id, hsiTokenId: observation.hsiTokenId };

  // Defensive: token IDs were validated on write, but re-validate before using
  // the value as a contract argument so a malformed row can never reach RPC.
  try {
    validateHsiTokenId(observation.hsiTokenId);
  } catch {
    return { ...base, status: "failed", code: "hexmining-hsi-reader-invalid-token-id" };
  }

  const hsimAddress = observation.hsiAddress.toLowerCase() as `0x${string}`;
  const observedAtBlock = observation.observedAtBlock;

  // Step 1: resolve the per-stake HSI contract address for this NFT tokenId.
  let hsiContract: `0x${string}`;
  try {
    hsiContract = (await publicClient.readContract({
      address: hsimAddress,
      abi: HSIM_ABI,
      functionName: "hsiToken",
      args: [BigInt(observation.hsiTokenId)],
      blockNumber: observedAtBlock,
    })) as `0x${string}`;
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    return { ...base, status: "failed", code: `hexmining-hsi-reader-resolve-rpc-${failure.code}` };
  }

  if (hsiContract.toLowerCase() === ZERO_ADDRESS) {
    // The tokenId does not map to an HSI contract — the stake is not present.
    return { ...base, status: "missing", code: "hexmining-hsi-reader-stake-missing" };
  }

  // Step 2: read the underlying HEX stake struct from the HSI contract. viem
  // decodes uint40 (stakeId) and uint16 day fields to `number`, and the uint72
  // hearts/shares fields to `bigint` — matching the native HEX stake reader.
  let struct: readonly [number, bigint, bigint, number, number, number, boolean];
  try {
    struct = (await publicClient.readContract({
      address: hsiContract,
      abi: HSI_ABI,
      functionName: "stakeDataFetch",
      blockNumber: observedAtBlock,
    })) as readonly [number, bigint, bigint, number, number, number, boolean];
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    return { ...base, status: "failed", code: `hexmining-hsi-reader-stakedata-rpc-${failure.code}` };
  }

  const stakeId = struct[0];
  const stakedHearts = struct[1];
  const stakeShares = struct[2];
  const lockedDay = struct[3];
  const stakedDays = struct[4];

  // A real HEX stake always has a positive uint40 stakeId. A zeroed struct means
  // the HSI holds no live stake (e.g. detokenized/ended between discovery and
  // read) — treat as missing rather than writing zeroed, fabricated metadata.
  if (stakeId === 0) {
    return { ...base, status: "missing", code: "hexmining-hsi-reader-stake-missing" };
  }

  // Only values actually returned by the stake struct are populated. Nothing is
  // scaled, priced, or derived. principalHex is the raw stakedHearts value.
  const enrichmentInput: EnrichHsiStakeObservationInput = {
    id: observation.id,
    stakeId: stakeId.toString(),
    stakeIndex: HSI_UNDERLYING_STAKE_INDEX,
    lockedDay: Number(lockedDay),
    stakedDays: Number(stakedDays),
    stakeShares: stakeShares.toString(),
    principalHex: stakedHearts.toString(),
    warnings: observation.warnings.filter((w) => w !== WARN_STAKE_FIELDS_UNKNOWN),
  };

  try {
    await enrichHsiStakeObservation(enrichmentInput, persistenceClient);
  } catch {
    // Persistence failed — the row is left unchanged and reported as a failure.
    return { ...base, status: "failed", code: "hexmining-hsi-reader-persist-failed" };
  }

  return { ...base, status: "enriched" };
}
