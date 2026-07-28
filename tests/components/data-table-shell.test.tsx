import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTableShell } from "@/components/ui/data-table-shell";

afterEach(() => {
  cleanup();
});

describe("DataTableShell — horizontal scroll containment", () => {
  it("wraps the table in an element with the horizontal overflow class", () => {
    render(
      <DataTableShell title="Test table">
        <thead>
          <tr>
            <th scope="col">Column</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Value</td>
          </tr>
        </tbody>
      </DataTableShell>,
    );

    const table = screen.getByRole("table");
    const scrollWrapper = table.parentElement;
    expect(scrollWrapper).not.toBeNull();
    expect(scrollWrapper).toHaveClass("overflow-x-auto");
  });

  it("does not put the horizontal overflow class on the table element itself", () => {
    render(
      <DataTableShell title="Test table">
        <thead>
          <tr>
            <th scope="col">Column</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Value</td>
          </tr>
        </tbody>
      </DataTableShell>,
    );

    expect(screen.getByRole("table")).not.toHaveClass("overflow-x-auto");
  });

  it("the scroll wrapper is a keyboard-focusable region with an accessible name", () => {
    render(
      <DataTableShell title="Test table">
        <thead>
          <tr>
            <th scope="col">Column</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Value</td>
          </tr>
        </tbody>
      </DataTableShell>,
    );

    const table = screen.getByRole("table");
    const scrollWrapper = table.parentElement;
    expect(scrollWrapper).not.toBeNull();
    expect(scrollWrapper).toHaveAttribute("role", "region");
    expect(scrollWrapper).toHaveAttribute("tabIndex", "0");
    expect(scrollWrapper).toHaveAccessibleName();

    const region = screen.getByRole("region", { name: "Test table table" });
    expect(region).toBe(scrollWrapper);
  });

  it("renders title and subtitle unchanged", () => {
    render(
      <DataTableShell title="Test table" subtitle="Test subtitle">
        <tbody>
          <tr>
            <td>Value</td>
          </tr>
        </tbody>
      </DataTableShell>,
    );

    expect(screen.getByText("Test table")).toBeInTheDocument();
    expect(screen.getByText("Test subtitle")).toBeInTheDocument();
  });

  it("title and subtitle remain outside the horizontal scroll region", () => {
    render(
      <DataTableShell title="Test table" subtitle="Test subtitle">
        <tbody>
          <tr>
            <td>Value</td>
          </tr>
        </tbody>
      </DataTableShell>,
    );

    const table = screen.getByRole("table");
    const scrollWrapper = table.parentElement!;
    const titleEl = screen.getByText("Test table");
    const subtitleEl = screen.getByText("Test subtitle");

    expect(scrollWrapper.contains(titleEl)).toBe(false);
    expect(scrollWrapper.contains(subtitleEl)).toBe(false);
  });

  it("renders table children content unchanged", () => {
    render(
      <DataTableShell title="Test table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>pHEX</td>
            <td>1000</td>
          </tr>
        </tbody>
      </DataTableShell>,
    );

    expect(screen.getByText("Asset")).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("pHEX")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("does not replace the semantic table element", () => {
    render(
      <DataTableShell title="Test table">
        <tbody>
          <tr>
            <td>Value</td>
          </tr>
        </tbody>
      </DataTableShell>,
    );

    expect(screen.getByRole("table").tagName).toBe("TABLE");
  });
});
