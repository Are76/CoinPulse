import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AtlasStatusBadge, type BadgeVariant } from "@/components/ui/atlas-status-badge";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { STATUS_TONE_STYLES, type StatusToneKey } from "@/components/ui/status/status-style-map";

/**
 * AtlasStatusBadge variants whose meaning exactly coincides with an existing
 * ProvenanceChip tone must render identical colors — that equivalence is the
 * whole point of the shared status-style-map extraction. Variants deliberately
 * left distinct (conflicting, unsupported/unavailable, evidence-*) are not
 * asserted here; forcing them to match would misrepresent a real behavior
 * difference as a bug.
 */
const SHARED_VARIANT_TO_TONE: Array<[BadgeVariant, StatusToneKey]> = [
  ["synced", "fresh"],
  ["pending", "warn"],
  ["stale", "stale"],
  ["error", "danger"],
  ["estimated", "estimated"],
];

describe("status tone style map consistency", () => {
  afterEach(() => {
    cleanup();
  });

  it.each(SHARED_VARIANT_TO_TONE)(
    "renders AtlasStatusBadge variant %s with the same color as ProvenanceChip tone %s",
    (variant, tone) => {
      const badge = render(<AtlasStatusBadge variant={variant} />);
      const badgeSpan = badge.container.querySelector("span");

      const chip = render(<ProvenanceChip tone={tone}>x</ProvenanceChip>);
      const chipSpan = chip.container.querySelector("span");

      expect(badgeSpan?.style.color).toBe(chipSpan?.style.color);
      expect(badgeSpan?.style.backgroundColor).toBe(chipSpan?.style.backgroundColor);
      expect(badgeSpan?.style.borderColor).toBe(chipSpan?.style.borderColor);
    },
  );

  it("keeps the deliberately deferred conflicting variant independent of any shared tone", () => {
    const badge = render(<AtlasStatusBadge variant="conflicting" />);
    const badgeSpan = badge.container.querySelector("span");
    const sharedColors = Object.values(STATUS_TONE_STYLES).map((tone) => tone.color);
    expect(sharedColors).not.toContain(badgeSpan?.style.color);
  });
});
