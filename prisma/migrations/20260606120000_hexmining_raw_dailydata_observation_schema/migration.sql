-- HexMining Phase 4: raw dailyDataRange observation schema
--
-- Adds SourceFamily.HEXMINING (additive enum value) and two new models:
--   RawHexDailyDataObservation         — append-only read-model audit evidence
--   RawHexDailyDataObservationInvalidation — append-only reorg/supersession record

-- AlterEnum: add HEXMINING to SourceFamily (additive only)
ALTER TYPE "SourceFamily" ADD VALUE 'HEXMINING';

-- CreateTable: RawHexDailyDataObservation
CREATE TABLE "RawHexDailyDataObservation" (
    "id"               TEXT NOT NULL,
    "chainId"          INTEGER NOT NULL,
    "sourceFamily"     "SourceFamily" NOT NULL DEFAULT 'HEXMINING',
    "rangeStartDay"    INTEGER NOT NULL,
    "rangeEndDay"      INTEGER NOT NULL,
    "observedAtBlock"  BIGINT NOT NULL,
    "observedAt"       TIMESTAMP(3) NOT NULL,
    "rpcEndpointLabel" TEXT,
    "payloadVersion"   TEXT NOT NULL DEFAULT 'v1',
    "canonicalPayload" TEXT NOT NULL,
    "payloadHash"      TEXT NOT NULL,
    "warnings"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawHexDailyDataObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RawHexDailyDataObservationInvalidation
CREATE TABLE "RawHexDailyDataObservationInvalidation" (
    "id"                        TEXT NOT NULL,
    "observationId"             TEXT NOT NULL,
    "reason"                    TEXT NOT NULL,
    "reorgBlockHash"            TEXT,
    "supersededByObservationId" TEXT,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawHexDailyDataObservationInvalidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: primary lookup (chainId + range + block)
CREATE INDEX "RawHexDailyDataObservation_chainId_rangeStartDay_rangeEndDay_observedAtBlock_idx"
    ON "RawHexDailyDataObservation"("chainId", "rangeStartDay", "rangeEndDay", "observedAtBlock");

-- CreateIndex: source family filter
CREATE INDEX "RawHexDailyDataObservation_chainId_sourceFamily_idx"
    ON "RawHexDailyDataObservation"("chainId", "sourceFamily");

-- CreateIndex: dedup check by payload hash
CREATE INDEX "RawHexDailyDataObservation_payloadHash_idx"
    ON "RawHexDailyDataObservation"("payloadHash");

-- CreateIndex: invalidation lookup by observation
CREATE INDEX "RawHexDailyDataObservationInvalidation_observationId_idx"
    ON "RawHexDailyDataObservationInvalidation"("observationId");

-- CreateIndex: invalidation lookup by supersession target
CREATE INDEX "RawHexDailyDataObservationInvalidation_supersededByObservationId_idx"
    ON "RawHexDailyDataObservationInvalidation"("supersededByObservationId");

-- AddForeignKey: RawHexDailyDataObservation -> Chain
ALTER TABLE "RawHexDailyDataObservation"
    ADD CONSTRAINT "RawHexDailyDataObservation_chainId_fkey"
    FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: invalidation -> observation (the invalidated row)
ALTER TABLE "RawHexDailyDataObservationInvalidation"
    ADD CONSTRAINT "RawHexDailyDataObservationInvalidation_observationId_fkey"
    FOREIGN KEY ("observationId") REFERENCES "RawHexDailyDataObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: invalidation -> observation (the superseding row, nullable)
ALTER TABLE "RawHexDailyDataObservationInvalidation"
    ADD CONSTRAINT "RawHexDailyDataObservationInvalidation_supersededByObservationId_fkey"
    FOREIGN KEY ("supersededByObservationId") REFERENCES "RawHexDailyDataObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
