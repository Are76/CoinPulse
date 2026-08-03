import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AtlasStatusBadge, type BadgeVariant } from "@/components/ui/atlas-status-badge";

const ALL_VARIANTS: Array<{ variant: BadgeVariant; label: string; expectDot: boolean }> = [
  { variant: "synced", label: "Synced", expectDot: true },
  { variant: "pending", label: "Pending", expectDot: true },
  { variant: "stale", label: "Stale", expectDot: false },
  { variant: "conflicting", label: "Conflicting", expectDot: false },
  { variant: "unsupported", label: "Unsupported", expectDot: false },
  { variant: "unavailable", label: "Unavailable", expectDot: false },
  { variant: "error", label: "Error", expectDot: true },
  { variant: "estimated", label: "Estimated", expectDot: false },
  { variant: "evidence-available", label: "Evidence available", expectDot: false },
  { variant: "evidence-missing", label: "Evidence missing", expectDot: false },
];

describe("AtlasStatusBadge", () => {
  afterEach(() => {
    cleanup();
  });

  it.each(ALL_VARIANTS)(
    "renders readable text for the $variant variant, not color alone",
    ({ variant, label, expectDot }) => {
      const { container } = render(<AtlasStatusBadge variant={variant} />);

      expect(screen.getByText(label)).toBeInTheDocument();

      const dot = container.querySelector(".rounded-full.flex-shrink-0");
      if (expectDot) {
        expect(dot).not.toBeNull();
      } else {
        expect(dot).toBeNull();
      }
    },
  );

  it("does not introduce a variant outside the approved BadgeVariant union", () => {
    const variants = ALL_VARIANTS.map((entry) => entry.variant);
    expect(new Set(variants).size).toBe(variants.length);
    expect(variants).toHaveLength(10);
  });
});
