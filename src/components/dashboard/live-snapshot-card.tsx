import type { LiveHoldingsSnapshotDto } from "@/services/portfolio/live-snapshot-types";

export function LiveSnapshotCard({ snapshot }: { snapshot: LiveHoldingsSnapshotDto }) {
  return (
    <div data-testid="live-snapshot-card">
      <p>
        Live snapshot as of block {snapshot.observedBlock}. {snapshot.coverageNote}
      </p>
      <ul>
        {snapshot.assets.map((asset) => (
          <li key={asset.assetId}>
            {asset.symbol ?? asset.assetId}: {asset.balanceQuantity} raw units —{" "}
            {asset.priceStatus === "priced" ? `${asset.valueQuote} ${snapshot.quoteAsset}` : "price unavailable"}
          </li>
        ))}
      </ul>
      <p>
        Total (partial): {snapshot.totalValueQuote ?? "unavailable"} {snapshot.quoteAsset}
      </p>
    </div>
  );
}
