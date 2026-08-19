-- Persist exact RawTokenTransfer evidence sets for higher-order raw actions.
-- Null rawTransferEvidenceStatus means provenance was not recorded for a
-- legacy row; RECORDED and VERIFIED_EMPTY are explicit post-migration states.

CREATE TYPE "RawTransferEvidenceStatus" AS ENUM ('RECORDED', 'VERIFIED_EMPTY');

ALTER TABLE "RawDexSwap" ADD COLUMN "rawTransferEvidenceStatus" "RawTransferEvidenceStatus";
ALTER TABLE "RawLpAction" ADD COLUMN "rawTransferEvidenceStatus" "RawTransferEvidenceStatus";
ALTER TABLE "RawStakeAction" ADD COLUMN "rawTransferEvidenceStatus" "RawTransferEvidenceStatus";

CREATE TABLE "RawDexSwapTransferEvidence" (
    "id" TEXT NOT NULL,
    "rawDexSwapId" TEXT NOT NULL,
    "rawTokenTransferId" TEXT NOT NULL,
    "legRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawDexSwapTransferEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RawLpActionTransferEvidence" (
    "id" TEXT NOT NULL,
    "rawLpActionId" TEXT NOT NULL,
    "rawTokenTransferId" TEXT NOT NULL,
    "legRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawLpActionTransferEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RawStakeActionTransferEvidence" (
    "id" TEXT NOT NULL,
    "rawStakeActionId" TEXT NOT NULL,
    "rawTokenTransferId" TEXT NOT NULL,
    "legRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawStakeActionTransferEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RawDexSwapTransferEvidence_action_role_transfer_key"
ON "RawDexSwapTransferEvidence"("rawDexSwapId", "legRole", "rawTokenTransferId");

CREATE INDEX "RawDexSwapTransferEvidence_rawTokenTransferId_idx"
ON "RawDexSwapTransferEvidence"("rawTokenTransferId");

CREATE UNIQUE INDEX "RawLpActionTransferEvidence_action_role_transfer_key"
ON "RawLpActionTransferEvidence"("rawLpActionId", "legRole", "rawTokenTransferId");

CREATE INDEX "RawLpActionTransferEvidence_rawTokenTransferId_idx"
ON "RawLpActionTransferEvidence"("rawTokenTransferId");

CREATE UNIQUE INDEX "RawStakeActionTransferEvidence_action_role_transfer_key"
ON "RawStakeActionTransferEvidence"("rawStakeActionId", "legRole", "rawTokenTransferId");

CREATE INDEX "RawStakeActionTransferEvidence_rawTokenTransferId_idx"
ON "RawStakeActionTransferEvidence"("rawTokenTransferId");

ALTER TABLE "RawDexSwapTransferEvidence"
ADD CONSTRAINT "RawDexSwapTransferEvidence_rawDexSwapId_fkey"
FOREIGN KEY ("rawDexSwapId") REFERENCES "RawDexSwap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawDexSwapTransferEvidence"
ADD CONSTRAINT "RawDexSwapTransferEvidence_rawTokenTransferId_fkey"
FOREIGN KEY ("rawTokenTransferId") REFERENCES "RawTokenTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RawLpActionTransferEvidence"
ADD CONSTRAINT "RawLpActionTransferEvidence_rawLpActionId_fkey"
FOREIGN KEY ("rawLpActionId") REFERENCES "RawLpAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawLpActionTransferEvidence"
ADD CONSTRAINT "RawLpActionTransferEvidence_rawTokenTransferId_fkey"
FOREIGN KEY ("rawTokenTransferId") REFERENCES "RawTokenTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RawStakeActionTransferEvidence"
ADD CONSTRAINT "RawStakeActionTransferEvidence_rawStakeActionId_fkey"
FOREIGN KEY ("rawStakeActionId") REFERENCES "RawStakeAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawStakeActionTransferEvidence"
ADD CONSTRAINT "RawStakeActionTransferEvidence_rawTokenTransferId_fkey"
FOREIGN KEY ("rawTokenTransferId") REFERENCES "RawTokenTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
