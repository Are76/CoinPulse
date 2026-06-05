import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { QueryProvider } from "@/components/providers/query-provider";

describe("QueryProvider", () => {
  it("renders children", () => {
    render(
      <QueryProvider>
        <span data-testid="child">hello</span>
      </QueryProvider>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });
});
