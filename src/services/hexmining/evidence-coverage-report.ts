import "server-only";

import type { ObservationEvidenceMetadata } from "@/services/hexmining/observation-evidence-provider";
import type { HexStakeDto } from "@/services/hexmining/types";

const SOURCE_FAMILY = "HEXMINING" as const;

export type HexMiningEvidenceMissingReason =
  | "missing_exact_observation"
  | "invalidated_observation"
  | "invalid_observation_payload"
  | "evidence_range_mismatch"
  | "no_elapsed_days";

export type HexMiningEvidenceCoverageStakeDto = {
  stakeId: string;
  lockedDay: number;
  currentDay: number;
  rangeStartDay: number;
  rangeEndDay: number;
  covered: boolean;
  observationId: string | null;
  missingReason: HexMiningEvidenceMissingReason | null;
};

export type HexMiningEvidenceCoverageReportDto = {
  schemaVersion: "v1";
  summary: {
    chainId: number;
    sourceFamily: typeof SOURCE_FAMILY;
    totalActiveStakes: number;
    coveredStakes: number;
    missingEvidenceStakes: number;
  };
  stakes: HexMiningEvidenceCoverageStakeDto[];
};

export type HexMiningEvidenceCoverageReportArgs = {
  chainId: number;
  currentDay: number;
  stakes: readonly HexStakeDto[];
  fetchEvidence: (args: {
    chainId: number;
    rangeStartDay: number;
    rangeEndDay: number;
  }) => Promise<ObservationEvidenceMetadata | null>;
};

export async function buildHexMiningEvidenceCoverageReport(
  args: HexMiningEvidenceCoverageReportArgs,
): Promise<HexMiningEvidenceCoverageReportDto> {
  const activeNativeStakes = args.stakes.filter((stake) =>
    isActiveNativeStake(stake, args.currentDay, args.chainId),
  );

  const rows: HexMiningEvidenceCoverageStakeDto[] = [];

  for (const stake of activeNativeStakes) {
    const lockedDay = stake.lockedDay!;
    const rangeStartDay = lockedDay;
    const rangeEndDay = args.currentDay - 1;

    if (rangeEndDay < rangeStartDay) {
      rows.push({
        stakeId: stake.stakeId,
        lockedDay,
        currentDay: args.currentDay,
        rangeStartDay,
        rangeEndDay,
        covered: false,
        observationId: null,
        missingReason: "no_elapsed_days",
      });
      continue;
    }

    const evidence = await args.fetchEvidence({
      chainId: args.chainId,
      rangeStartDay,
      rangeEndDay,
    });

    const coverage = classifyCoverage({
      evidence,
      rangeStartDay,
      rangeEndDay,
    });

    rows.push({
      stakeId: stake.stakeId,
      lockedDay,
      currentDay: args.currentDay,
      rangeStartDay,
      rangeEndDay,
      covered: coverage.covered,
      observationId: coverage.covered ? evidence!.observationId : null,
      missingReason: coverage.missingReason,
    });
  }

  const coveredStakes = rows.filter((row) => row.covered).length;

  return {
    schemaVersion: "v1",
    summary: {
      chainId: args.chainId,
      sourceFamily: SOURCE_FAMILY,
      totalActiveStakes: rows.length,
      coveredStakes,
      missingEvidenceStakes: rows.length - coveredStakes,
    },
    stakes: rows,
  };
}

function isActiveNativeStake(
  stake: HexStakeDto,
  currentDay: number,
  chainId: number,
): boolean {
  if (stake.chainId !== chainId) return false;
  if (stake.stakeSource !== "native") return false;
  if (stake.lockedDay === null || stake.stakedDays === null) return false;
  if (stake.stakedDays <= 0) return false;
  return (
    stake.lockedDay <= currentDay &&
    currentDay < stake.lockedDay + stake.stakedDays
  );
}

function classifyCoverage(args: {
  evidence: ObservationEvidenceMetadata | null;
  rangeStartDay: number;
  rangeEndDay: number;
}): { covered: true; missingReason: null } | {
  covered: false;
  missingReason: HexMiningEvidenceMissingReason;
} {
  const { evidence, rangeStartDay, rangeEndDay } = args;

  if (evidence === null) {
    return { covered: false, missingReason: "missing_exact_observation" };
  }
  if (evidence.rangeStartDay !== rangeStartDay || evidence.rangeEndDay !== rangeEndDay) {
    return { covered: false, missingReason: "evidence_range_mismatch" };
  }
  if (evidence.isInvalidated) {
    return { covered: false, missingReason: "invalidated_observation" };
  }
  if (!evidence.payloadSchemaValid) {
    return { covered: false, missingReason: "invalid_observation_payload" };
  }
  return { covered: true, missingReason: null };
}
