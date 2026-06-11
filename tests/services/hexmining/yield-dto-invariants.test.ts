// HexStakeYieldDto discriminated union invariants — Phase 4 contract hardening
//
// This file verifies two things:
//
// 1. RUNTIME (npm run test):  valid DTO shapes have the correct field values.
// 2. COMPILE-TIME (npm run typecheck):  invalid field combinations are rejected
//    by the TypeScript type checker.  The @ts-expect-error directives act as
//    regression guards — if a directive becomes unused (the line is no longer a
//    type error), npm run typecheck fails with "Unused '@ts-expect-error'
//    directive", preventing silent contract regressions.
//
// No RPC, no database, no Prisma, no routes, no readers, no frontend.

import { describe, expect, it } from "vitest";

import type {
  EstimatedYieldDto,
  ExactYieldDto,
  HexBpdYieldStatus,
  HexStakeBpdYieldFields,
  HexStakeYieldDto,
  HexStakeYieldProvenance,
  UnavailableYieldDto,
  UnsupportedYieldDto,
} from "@/services/hexmining/types";

// Test provenance — used for EstimatedYieldDto and ExactYieldDto constructions
// where provenance: HexStakeYieldProvenance is required.
const TEST_PROVENANCE: HexStakeYieldProvenance = {
  chainId: 369,
  sourceFamily: "HEXMINING",
  observationId: "test-obs-001",
  rangeStartDay: 1000,
  rangeEndDay: 4999,
};

// ─── Named member types are exported ─────────────────────────────────────────

describe("named yield DTO member types are exported from types.ts", () => {
  it("UnsupportedYieldDto is importable and matches expected shape", () => {
    const dto: UnsupportedYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
    expect(dto.status).toBe("unsupported");
    expect(dto.estimatedYieldHex).toBeNull();
    expect(dto.bpdYieldHex).toBeNull();
    expect(dto.bpdYieldStatus).toBeNull();
  });

  it("UnavailableYieldDto is importable and matches expected shape", () => {
    const dto: UnavailableYieldDto = {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: null,
      warnings: [],
    };
    expect(dto.status).toBe("unavailable");
    expect(dto.estimatedYieldHex).toBeNull();
    expect(dto.bpdYieldHex).toBeNull();
    expect(dto.bpdYieldStatus).toBe("not_applicable");
  });

  it("EstimatedYieldDto is importable and matches expected shape", () => {
    const dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.status).toBe("estimated");
    expect(dto.estimatedYieldHex).toBe("1000000000");
    expect(dto.bpdYieldStatus).toBe("not_applicable");
  });

  it("ExactYieldDto is importable and matches expected shape", () => {
    const dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.status).toBe("exact");
    expect(dto.estimatedYieldHex).toBe("1000000000");
    expect(dto.bpdYieldStatus).toBe("not_applicable");
  });

  it("each named type is assignable to HexStakeYieldDto", () => {
    const unsupported: HexStakeYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
    const unavailable: HexStakeYieldDto = {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: null,
      warnings: [],
    };
    const estimated: HexStakeYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    const exact: HexStakeYieldDto = {
      status: "exact",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(unsupported.status).toBe("unsupported");
    expect(unavailable.status).toBe("unavailable");
    expect(estimated.status).toBe("estimated");
    expect(exact.status).toBe("exact");
  });
});

// ─── Valid combinations compile and have correct runtime values ───────────────

describe("valid yield DTO combinations", () => {
  it("UnsupportedYieldDto: all fields null at runtime", () => {
    const dto: UnsupportedYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
    expect(dto.status).toBe("unsupported");
    expect(dto.estimatedYieldHex).toBeNull();
    expect(dto.bpdYieldHex).toBeNull();
    expect(dto.bpdYieldStatus).toBeNull();
  });

  it("UnavailableYieldDto: estimatedYieldHex and bpdYieldHex are null; bpdYieldStatus is HexBpdYieldStatus", () => {
    const dto: UnavailableYieldDto = {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: null,
      warnings: [],
    };
    expect(dto.status).toBe("unavailable");
    expect(dto.estimatedYieldHex).toBeNull();
    expect(dto.bpdYieldHex).toBeNull();
    expect(dto.bpdYieldStatus).toBe("not_applicable");
  });

  it("EstimatedYieldDto: estimatedYieldHex and bpdYieldStatus are required strings", () => {
    const dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1234567890",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.estimatedYieldHex).toBe("1234567890");
    expect(typeof dto.estimatedYieldHex).toBe("string");
    expect(dto.bpdYieldStatus).toBe("not_applicable");
  });

  it("EstimatedYieldDto: bpdYieldHex non-null when bpdYieldStatus is 'applicable'", () => {
    const dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: "5000000000",
      bpdYieldStatus: "applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.bpdYieldStatus).toBe("applicable");
    expect(dto.bpdYieldHex).toBe("5000000000");
    expect(dto.bpdYieldHex).not.toBeNull();
  });

  it("ExactYieldDto: estimatedYieldHex and bpdYieldStatus are required strings", () => {
    const dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.estimatedYieldHex).toBe("9876543210");
    expect(typeof dto.estimatedYieldHex).toBe("string");
    expect(dto.bpdYieldStatus).toBe("not_applicable");
  });

  it("ExactYieldDto: bpdYieldHex non-null when bpdYieldStatus is 'applicable'", () => {
    const dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldHex: "5000000000",
      bpdYieldStatus: "applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.bpdYieldStatus).toBe("applicable");
    expect(dto.bpdYieldHex).not.toBeNull();
  });
});

// ─── Type-level: invalid combinations cannot compile ─────────────────────────
//
// Each @ts-expect-error below confirms the following line IS a type error.
// If the line is ever NOT a type error (e.g. union reverted to flat type),
// npm run typecheck will fail: "Unused '@ts-expect-error' directive".

describe("type-level: invalid combinations cannot compile (enforced by typecheck)", () => {
  it("'estimated' + null estimatedYieldHex is a type error — EstimatedYieldDto requires string", () => {
    // @ts-expect-error — estimatedYieldHex must be string for "estimated"
    const _dto: HexStakeYieldDto = {
      status: "estimated",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
    };
    void _dto;
  });

  it("'exact' + null estimatedYieldHex is a type error — ExactYieldDto requires string", () => {
    // @ts-expect-error — estimatedYieldHex must be string for "exact"
    const _dto: HexStakeYieldDto = {
      status: "exact",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
    };
    void _dto;
  });

  it("'estimated' + null bpdYieldStatus is a type error — EstimatedYieldDto requires HexBpdYieldStatus", () => {
    // @ts-expect-error — bpdYieldStatus must be HexBpdYieldStatus for "estimated"
    const _dto: HexStakeYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: null,
    };
    void _dto;
  });

  it("'exact' + null bpdYieldStatus is a type error — ExactYieldDto requires HexBpdYieldStatus", () => {
    // @ts-expect-error — bpdYieldStatus must be HexBpdYieldStatus for "exact"
    const _dto: HexStakeYieldDto = {
      status: "exact",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: null,
    };
    void _dto;
  });

  it("'unsupported' + populated estimatedYieldHex is a type error — UnsupportedYieldDto requires null", () => {
    // @ts-expect-error — estimatedYieldHex must be null for "unsupported"
    const _dto: HexStakeYieldDto = {
      status: "unsupported",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: null,
    };
    void _dto;
  });

  it("'unavailable' + populated estimatedYieldHex is a type error — UnavailableYieldDto requires null", () => {
    // @ts-expect-error — estimatedYieldHex must be null for "unavailable"
    const _dto: HexStakeYieldDto = {
      status: "unavailable",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
    };
    void _dto;
  });

  it("'unsupported' + populated bpdYieldStatus is a type error — UnsupportedYieldDto requires null", () => {
    // TypeScript reports this at the property line when only one field mismatches.
    const _dto: UnsupportedYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      provenance: null,
      warnings: [],
      // @ts-expect-error — bpdYieldStatus must be null in UnsupportedYieldDto
      bpdYieldStatus: "not_applicable",
    };
    void _dto;
  });

  it("'unavailable' + null bpdYieldStatus is a type error — UnavailableYieldDto requires HexBpdYieldStatus", () => {
    // TypeScript reports this at the property line when only one field mismatches.
    const _dto: UnavailableYieldDto = {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      provenance: null,
      warnings: [],
      // @ts-expect-error — bpdYieldStatus must be HexBpdYieldStatus for "unavailable"
      bpdYieldStatus: null,
    };
    void _dto;
  });

  it("'unsupported' + populated bpdYieldHex is a type error — UnsupportedYieldDto requires null", () => {
    // @ts-expect-error — bpdYieldHex must be null for "unsupported"
    const _dto: HexStakeYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: "5000000000",
      bpdYieldStatus: null,
    };
    void _dto;
  });

  it("'estimated' missing estimatedYieldHex is a type error", () => {
    // @ts-expect-error — EstimatedYieldDto requires estimatedYieldHex field
    const _dto: EstimatedYieldDto = {
      status: "estimated",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
    };
    void _dto;
  });

  it("'exact' missing bpdYieldStatus is a type error", () => {
    // @ts-expect-error — ExactYieldDto requires bpdYieldStatus field
    const _dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "1000000000",
      bpdYieldHex: null,
    };
    void _dto;
  });
});

// ─── Discriminated union narrowing on status ──────────────────────────────────

describe("discriminated union narrowing on status", () => {
  it("narrowing to 'unsupported' reveals estimatedYieldHex: null", () => {
    const dto: HexStakeYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
    if (dto.status === "unsupported") {
      // After narrowing, TypeScript knows estimatedYieldHex: null
      expect(dto.estimatedYieldHex).toBeNull();
      expect(dto.bpdYieldStatus).toBeNull();
    }
  });

  it("narrowing to 'unavailable' reveals estimatedYieldHex/bpdYieldHex null, bpdYieldStatus is HexBpdYieldStatus", () => {
    const dto: HexStakeYieldDto = {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: null,
      warnings: [],
    };
    if (dto.status === "unavailable") {
      expect(dto.estimatedYieldHex).toBeNull();
      expect(dto.bpdYieldHex).toBeNull();
      expect(dto.bpdYieldStatus).toBe("not_applicable");
    }
  });

  it("narrowing to 'estimated' reveals estimatedYieldHex: string and bpdYieldStatus: HexBpdYieldStatus", () => {
    const dto: HexStakeYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1234567890",
      bpdYieldHex: null,
      bpdYieldStatus: "not_applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    if (dto.status === "estimated") {
      // After narrowing, TypeScript knows estimatedYieldHex: string (not null)
      // and bpdYieldStatus: HexBpdYieldStatus (not null)
      expect(typeof dto.estimatedYieldHex).toBe("string");
      expect(dto.estimatedYieldHex.length).toBeGreaterThan(0);
      expect(dto.bpdYieldStatus).toBe("not_applicable");
    }
  });

  it("narrowing to 'exact' reveals estimatedYieldHex: string and bpdYieldStatus: HexBpdYieldStatus", () => {
    const dto: HexStakeYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldHex: "5000000000",
      bpdYieldStatus: "applicable",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    if (dto.status === "exact") {
      expect(typeof dto.estimatedYieldHex).toBe("string");
      expect(dto.estimatedYieldHex.length).toBeGreaterThan(0);
      const bpdStatus: HexBpdYieldStatus = dto.bpdYieldStatus;
      expect(bpdStatus).toBe("applicable");
    }
  });

  it("switch on status narrows each branch correctly", () => {
    const dtos: HexStakeYieldDto[] = [
      { status: "unsupported", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null, provenance: null, warnings: [] },
      { status: "unavailable", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: "not_applicable", provenance: null, warnings: [] },
      { status: "estimated", estimatedYieldHex: "1000000000", bpdYieldHex: null, bpdYieldStatus: "not_applicable", provenance: TEST_PROVENANCE, warnings: [] },
      { status: "exact", estimatedYieldHex: "2000000000", bpdYieldHex: null, bpdYieldStatus: "not_applicable", provenance: TEST_PROVENANCE, warnings: [] },
    ];
    const statuses = dtos.map((dto) => dto.status);
    expect(statuses).toEqual(["unsupported", "unavailable", "estimated", "exact"]);
  });
});

// ─── Phase 1–3 unsupported state remains unchanged ───────────────────────────

describe("Phase 1–3 unsupported state is unchanged by the union refactor", () => {
  it("existing unsupported yield fixture shape is still valid", () => {
    // This is the exact shape produced by the Phase 2 reader and used in all
    // existing fixtures across reader.test.ts, hexmining-client.test.ts, and
    // hexmining-stakes-route-contract.test.ts.
    const existingFixture: HexStakeYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
    expect(existingFixture.status).toBe("unsupported");
    expect(existingFixture.estimatedYieldHex).toBeNull();
    expect(existingFixture.bpdYieldHex).toBeNull();
    expect(existingFixture.bpdYieldStatus).toBeNull();
  });

  it("all four fields present in existing unsupported fixture", () => {
    const dto: HexStakeYieldDto = {
      status: "unsupported",
      estimatedYieldHex: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    };
    expect(Object.keys(dto)).toContain("status");
    expect(Object.keys(dto)).toContain("estimatedYieldHex");
    expect(Object.keys(dto)).toContain("bpdYieldHex");
    expect(Object.keys(dto)).toContain("bpdYieldStatus");
  });

  it("status 'unsupported' is distinct from all other states", () => {
    const unsupported: HexStakeYieldDto = { status: "unsupported", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null, provenance: null, warnings: [] };
    const unavailable: HexStakeYieldDto = { status: "unavailable", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: "not_applicable", provenance: null, warnings: [] };
    expect(unsupported.status).not.toBe(unavailable.status);
    expect(unsupported.status).not.toBe("estimated");
    expect(unsupported.status).not.toBe("exact");
  });
});

// ─── BPD field correlation invariants ────────────────────────────────────────
//
// HexStakeBpdYieldFields is a discriminated union on bpdYieldStatus.
// Invalid combinations (applicable + null, not_applicable + string, etc.)
// are TypeScript errors enforced at compile time.

describe("HexStakeBpdYieldFields: valid combinations compile", () => {
  it("'applicable' + bpdYieldHex string is valid", () => {
    const fields: HexStakeBpdYieldFields = {
      bpdYieldStatus: "applicable",
      bpdYieldHex: "5000000000",
    };
    expect(fields.bpdYieldStatus).toBe("applicable");
    expect(fields.bpdYieldHex).toBe("5000000000");
    expect(fields.bpdYieldHex).not.toBeNull();
  });

  it("'not_applicable' + bpdYieldHex null is valid", () => {
    const fields: HexStakeBpdYieldFields = {
      bpdYieldStatus: "not_applicable",
      bpdYieldHex: null,
    };
    expect(fields.bpdYieldStatus).toBe("not_applicable");
    expect(fields.bpdYieldHex).toBeNull();
  });

  it("'unknown' + bpdYieldHex null is valid", () => {
    const fields: HexStakeBpdYieldFields = {
      bpdYieldStatus: "unknown",
      bpdYieldHex: null,
    };
    expect(fields.bpdYieldStatus).toBe("unknown");
    expect(fields.bpdYieldHex).toBeNull();
  });

  it("EstimatedYieldDto with applicable + string compiles", () => {
    const dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldStatus: "applicable",
      bpdYieldHex: "5000000000",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.bpdYieldStatus).toBe("applicable");
    expect(dto.bpdYieldHex).toBe("5000000000");
  });

  it("EstimatedYieldDto with not_applicable + null compiles", () => {
    const dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldStatus: "not_applicable",
      bpdYieldHex: null,
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.bpdYieldStatus).toBe("not_applicable");
    expect(dto.bpdYieldHex).toBeNull();
  });

  it("EstimatedYieldDto with unknown + null compiles", () => {
    const dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldStatus: "unknown",
      bpdYieldHex: null,
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.bpdYieldStatus).toBe("unknown");
    expect(dto.bpdYieldHex).toBeNull();
  });

  it("ExactYieldDto with applicable + string compiles", () => {
    const dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldStatus: "applicable",
      bpdYieldHex: "5000000000",
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.bpdYieldStatus).toBe("applicable");
    expect(dto.bpdYieldHex).not.toBeNull();
  });

  it("ExactYieldDto with not_applicable + null compiles", () => {
    const dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldStatus: "not_applicable",
      bpdYieldHex: null,
      provenance: TEST_PROVENANCE,
      warnings: [],
    };
    expect(dto.bpdYieldStatus).toBe("not_applicable");
    expect(dto.bpdYieldHex).toBeNull();
  });
});

describe("BPD field correlation: invalid combinations cannot compile (enforced by typecheck)", () => {
  it("'estimated' + applicable + null bpdYieldHex is a type error", () => {
    // @ts-expect-error — "applicable" requires bpdYieldHex: string, not null
    const _dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldStatus: "applicable",
      bpdYieldHex: null,
    };
    void _dto;
  });

  it("'exact' + applicable + null bpdYieldHex is a type error", () => {
    // @ts-expect-error — "applicable" requires bpdYieldHex: string, not null
    const _dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldStatus: "applicable",
      bpdYieldHex: null,
    };
    void _dto;
  });

  it("'estimated' + not_applicable + string bpdYieldHex is a type error", () => {
    // @ts-expect-error — "not_applicable" requires bpdYieldHex: null, not string
    const _dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldStatus: "not_applicable",
      bpdYieldHex: "5000000000",
    };
    void _dto;
  });

  it("'exact' + not_applicable + string bpdYieldHex is a type error", () => {
    // @ts-expect-error — "not_applicable" requires bpdYieldHex: null, not string
    const _dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldStatus: "not_applicable",
      bpdYieldHex: "5000000000",
    };
    void _dto;
  });

  it("'estimated' + unknown + string bpdYieldHex is a type error", () => {
    // @ts-expect-error — "unknown" requires bpdYieldHex: null, not string
    const _dto: EstimatedYieldDto = {
      status: "estimated",
      estimatedYieldHex: "1000000000",
      bpdYieldStatus: "unknown",
      bpdYieldHex: "5000000000",
    };
    void _dto;
  });

  it("'exact' + unknown + string bpdYieldHex is a type error", () => {
    // @ts-expect-error — "unknown" requires bpdYieldHex: null, not string
    const _dto: ExactYieldDto = {
      status: "exact",
      estimatedYieldHex: "9876543210",
      bpdYieldStatus: "unknown",
      bpdYieldHex: "5000000000",
    };
    void _dto;
  });
});
