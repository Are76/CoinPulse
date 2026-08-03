import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { STATUS_TONE_STYLES, type StatusToneKey } from "@/components/ui/status/status-style-map";

const ALL_TONES = Object.keys(STATUS_TONE_STYLES) as StatusToneKey[];

describe("ProvenanceChip", () => {
  afterEach(() => {
    cleanup();
  });

  it.each(ALL_TONES)("renders its children text for the %s tone, not color alone", (tone) => {
    render(<ProvenanceChip tone={tone}>tone label {tone}</ProvenanceChip>);
    expect(screen.getByText(`tone label ${tone}`)).toBeInTheDocument();
  });

  it.each(ALL_TONES)("draws its color from the shared status tone style map for %s", (tone) => {
    const { container } = render(<ProvenanceChip tone={tone}>content</ProvenanceChip>);
    const chip = container.querySelector("span");
    expect(chip).not.toBeNull();
    expect(chip?.style.color).toBe(STATUS_TONE_STYLES[tone].color);

    const dot = container.querySelector(".rounded-full.flex-shrink-0");
    if (STATUS_TONE_STYLES[tone].dot) {
      expect(dot).not.toBeNull();
    } else {
      expect(dot).toBeNull();
    }
  });

  it("defaults to the neutral tone when none is supplied", () => {
    const { container } = render(<ProvenanceChip>default tone</ProvenanceChip>);
    const chip = container.querySelector("span");
    expect(chip?.style.color).toBe(STATUS_TONE_STYLES.neutral.color);
  });
});
