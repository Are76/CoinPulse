import { PageContainer } from "@/components/ui/page-container";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { SurfaceCard } from "@/components/ui/surface-card";

export default function HomePage() {
  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
              CoinPulse
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Backend foundation scaffold
            </h1>
          </div>
          <ProvenanceChip tone="fresh">Trust-first primitives</ProvenanceChip>
        </div>
        <p className="max-w-2xl leading-7 text-[color:var(--color-text-muted)]">
          App boot, shared tokens, and backend source-of-truth infrastructure are
          in place for the next bounded slices. Portfolio surfaces stay deferred.
        </p>
      </SurfaceCard>
    </PageContainer>
  );
}
