-- AlterTable: change hsiTokenId from BIGINT to TEXT so it can hold uint256-sized
-- ERC-721 token IDs without truncation.
ALTER TABLE "RawHsiStakeObservation"
    ALTER COLUMN "hsiTokenId" TYPE TEXT USING "hsiTokenId"::TEXT;

-- Drop the old non-unique index on (chainId, walletAddress, hsiTokenId) because
-- the new unique constraint below supersedes it.
DROP INDEX "RawHsiStakeObservation_chainId_walletAddress_hsiTokenId_idx";

-- AddUniqueConstraint: full dedupe tuple includes hsiAddress so that the same
-- token ID at the same block on two different Hedron contracts creates separate rows.
CREATE UNIQUE INDEX "RawHsiStakeObservation_chainId_walletAddress_hsiAddress_hsiTokenId_observedAtBlock_key"
    ON "RawHsiStakeObservation"("chainId", "walletAddress", "hsiAddress", "hsiTokenId", "observedAtBlock");
