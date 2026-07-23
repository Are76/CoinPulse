-- Add optional historical-state evidence-recovery provenance columns to
-- RawEndedHexStakeObservation. All six columns are nullable and additive: no
-- existing column, index, or row is touched, and no backfill runs. They record
-- where lockedDay/stakeShares came from when recovered via a pinned historical
-- stakeLists read (endBlockNumber - 1) rather than a matched RawStakeAction
-- START transaction. discoveryMethod is intentionally left untouched — it keeps
-- describing how the END event itself was discovered.
ALTER TABLE "RawEndedHexStakeObservation" ADD COLUMN "evidenceRecoveryMethod" TEXT;
ALTER TABLE "RawEndedHexStakeObservation" ADD COLUMN "evidenceRecoveryBlockNumber" BIGINT;
ALTER TABLE "RawEndedHexStakeObservation" ADD COLUMN "evidenceRecoverySourceContract" TEXT;
ALTER TABLE "RawEndedHexStakeObservation" ADD COLUMN "evidenceRecoverySourceFunction" TEXT;
ALTER TABLE "RawEndedHexStakeObservation" ADD COLUMN "evidenceRecoveryReturnedStakeId" TEXT;
ALTER TABLE "RawEndedHexStakeObservation" ADD COLUMN "evidenceRecoveredAt" TIMESTAMP(3);
