import { EmptyState } from "@/components/ui/data-state/empty-state";
import { WarningBanner, WarningList } from "@/components/ui/data-state/warning-banner";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { LiveHoldingsSnapshotDto } from "@/services/portfolio/live-snapshot-types";

export function LiveSnapshotCard({ snapshot }: { snapshot: LiveHoldingsSnapshotDto }) {
  return (
    <SurfaceCard className="flex flex-col gap-4" data-testid="live-snapshot-card">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">Live Portfolio</h3>
        <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">
          Balances observed directly from PulseChain by the backend at block{" "}
          {snapshot.observedBlock} ({snapshot.asOf}). {snapshot.coverageNote} This is not
          historical PnL, cost basis, or accounting truth — those require the historical
          ledger sync, which has not completed for this wallet yet.
        </p>
      </div>

      {snapshot.warnings.length > 0 ? (
        <WarningBanner tone="warn" title="Coverage warnings">
          <WarningList warnings={snapshot.warnings} />
        </WarningBanner>
      ) : null}

      {snapshot.assets.length === 0 ? (
        <EmptyState
          title="No known balances found"
          message="No native PLS or already-registered token balance was observed for this wallet at the current block. This does not confirm the wallet holds nothing — Live Portfolio V1 only checks native PLS plus tokens already known to CoinPulse, not full on-chain discovery."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {snapshot.assets.map((asset) => (
            <li
              key={asset.assetId}
              className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] px-3 py-2 text-sm"
            >
              <span className="font-medium">
                {asset.symbol ?? asset.assetId}: {asset.balanceQuantity} raw units
              </span>
              {asset.priceStatus === "priced" ? (
                <span className="text-[color:var(--color-text-muted)]">
                  ≈ {asset.valueQuote} {snapshot.quoteAsset}
                  {asset.pricing.sourceType !== null ? (
                    <>
                      {" "}
                      (source: {asset.pricing.sourceType}
                      {asset.pricing.confidence !== null ? `, confidence: ${asset.pricing.confidence}` : ""}
                      {asset.pricing.observedAt !== null ? `, priced at: ${asset.pricing.observedAt}` : ""})
                    </>
                  ) : null}
                </span>
              ) : (
                <span className="text-[color:var(--color-text-muted)]">price unavailable</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-[color:var(--color-text-muted)]">
        Estimated total ({snapshot.valuationStatus}): {snapshot.totalValueQuote ?? "unavailable"}{" "}
        {snapshot.quoteAsset}
      </p>
    </SurfaceCard>
  );
}
