// HexMining Phase 4C — dailyData canonical payload decoder tests
//
// Verifies the decode contract for canonicalPayload strings produced by
// encodeDailyDataPayload (Phase 4B, PR #205):
//
//   { "schemaVersion": "v1", "dailyData": ["val0", "val1", ...] }
//
// Each string entry is a base-10 unsigned integer decimal string representing
// a uint72 value from the HEX dailyDataRange RPC response.
//
// No live DB, no RPC, no viem, no routes. Pure deterministic unit tests.

import { describe, expect, it } from "vitest";

import {
  decodeDailyDataPayload,
  type DecodeDailyDataPayloadResult,
} from "@/services/hexmining/daily-data-payload-decoder";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validPayload(dailyData: string[] = ["100000000000", "200000000000"]): string {
  return JSON.stringify({ schemaVersion: "v1", dailyData });
}

function assertOk(
  result: DecodeDailyDataPayloadResult,
): asserts result is Extract<DecodeDailyDataPayloadResult, { ok: true }> {
  expect(result.ok).toBe(true);
}

function assertFail(
  result: DecodeDailyDataPayloadResult,
): asserts result is Extract<DecodeDailyDataPayloadResult, { ok: false }> {
  expect(result.ok).toBe(false);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("decodeDailyDataPayload", () => {
  describe("valid payloads", () => {
    it("decodes valid payload to bigint[]", () => {
      const result = decodeDailyDataPayload(validPayload());

      assertOk(result);
      expect(result.schemaVersion).toBe("v1");
      expect(result.dailyData).toEqual([100000000000n, 200000000000n]);
      expect(result.entryCount).toBe(2);
      expect(result.warnings).toEqual([]);
    });

    it("preserves element order", () => {
      const payload = validPayload(["300", "100", "200", "50"]);
      const result = decodeDailyDataPayload(payload);

      assertOk(result);
      expect(result.dailyData).toEqual([300n, 100n, 200n, 50n]);
    });

    it('decodes "0" to 0n', () => {
      const result = decodeDailyDataPayload(validPayload(["0"]));

      assertOk(result);
      expect(result.dailyData[0]).toBe(0n);
    });

    it("decodes empty dailyData array successfully", () => {
      const result = decodeDailyDataPayload(validPayload([]));

      assertOk(result);
      expect(result.dailyData).toEqual([]);
      expect(result.entryCount).toBe(0);
    });

    it("decodes large uint72 values correctly", () => {
      const maxUint72 = "4722366482869645213695"; // 2^72 - 1
      const result = decodeDailyDataPayload(validPayload([maxUint72]));

      assertOk(result);
      expect(result.dailyData[0]).toBe(4722366482869645213695n);
    });

    it("returns readonly bigint array (type-level)", () => {
      const result = decodeDailyDataPayload(validPayload(["42"]));
      assertOk(result);
      // TypeScript type: readonly bigint[] — verified structurally at compile time
      expect(Array.isArray(result.dailyData)).toBe(true);
    });
  });

  describe("invalid JSON", () => {
    it("rejects invalid JSON", () => {
      const result = decodeDailyDataPayload("{not valid json{{");

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-invalid-json");
    });

    it("rejects empty string as invalid JSON", () => {
      const result = decodeDailyDataPayload("");

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-invalid-json");
    });
  });

  describe("invalid root type", () => {
    it("rejects root array", () => {
      const result = decodeDailyDataPayload('["v1", ["100"]]');

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-invalid-root");
    });

    it("rejects root null", () => {
      const result = decodeDailyDataPayload("null");

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-invalid-root");
    });

    it("rejects root string", () => {
      const result = decodeDailyDataPayload('"just a string"');

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-invalid-root");
    });
  });

  describe("schemaVersion", () => {
    it("rejects missing schemaVersion", () => {
      const result = decodeDailyDataPayload(
        JSON.stringify({ dailyData: ["100"] }),
      );

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-missing-schema-version");
    });

    it("rejects unsupported schemaVersion", () => {
      const result = decodeDailyDataPayload(
        JSON.stringify({ schemaVersion: "v2", dailyData: ["100"] }),
      );

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-unsupported-schema-version");
    });

    it("rejects null schemaVersion", () => {
      const result = decodeDailyDataPayload(
        JSON.stringify({ schemaVersion: null, dailyData: ["100"] }),
      );

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-unsupported-schema-version");
    });
  });

  describe("dailyData field", () => {
    it("rejects missing dailyData field", () => {
      const result = decodeDailyDataPayload(
        JSON.stringify({ schemaVersion: "v1" }),
      );

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-missing-daily-data");
    });

    it("rejects dailyData as non-array object", () => {
      const result = decodeDailyDataPayload(
        JSON.stringify({ schemaVersion: "v1", dailyData: { "0": "100" } }),
      );

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-daily-data-not-array");
    });

    it("rejects dailyData as string", () => {
      const result = decodeDailyDataPayload(
        JSON.stringify({ schemaVersion: "v1", dailyData: "100" }),
      );

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-daily-data-not-array");
    });
  });

  describe("invalid dailyData items", () => {
    it("rejects numeric item (non-string)", () => {
      const payload = JSON.stringify({ schemaVersion: "v1", dailyData: [100000000000] });
      // numeric JSON value — caught by numeric rejection before item-level check
      const result = decodeDailyDataPayload(payload);

      assertFail(result);
      expect(result.ok).toBe(false);
    });

    it("rejects negative string", () => {
      const result = decodeDailyDataPayload(validPayload(["-1"]));

      assertFail(result);
      expect(result.code).toMatch(/hexmining-payload-item-invalid-at-0/);
    });

    it("rejects float string", () => {
      const result = decodeDailyDataPayload(validPayload(["1.5"]));

      assertFail(result);
      expect(result.code).toMatch(/hexmining-payload-item-invalid-at-0/);
    });

    it("rejects exponential notation string", () => {
      const result = decodeDailyDataPayload(validPayload(["1e10"]));

      assertFail(result);
      expect(result.code).toMatch(/hexmining-payload-item-invalid-at-0/);
    });

    it("rejects hex string", () => {
      const result = decodeDailyDataPayload(validPayload(["0xff"]));

      assertFail(result);
      expect(result.code).toMatch(/hexmining-payload-item-invalid-at-0/);
    });

    it("rejects empty string item", () => {
      const result = decodeDailyDataPayload(validPayload([""]));

      assertFail(result);
      expect(result.code).toMatch(/hexmining-payload-item-invalid-at-0/);
    });

    it("rejects object item", () => {
      const payload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: [{ value: "100" }],
      });
      const result = decodeDailyDataPayload(payload);

      assertFail(result);
      expect(result.code).toMatch(/hexmining-payload-item-not-string-at-0/);
    });

    it("rejects boolean item", () => {
      const payload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: [true],
      });
      const result = decodeDailyDataPayload(payload);

      assertFail(result);
      expect(result.code).toMatch(/hexmining-payload-item-not-string-at-0/);
    });

    it("reports index of first failing item", () => {
      const result = decodeDailyDataPayload(validPayload(["100", "200", "-3"]));

      assertFail(result);
      expect(result.code).toContain("-2"); // index 2 is the bad item
    });
  });

  describe("numeric JSON anywhere", () => {
    it("rejects payload with numeric JSON values (bigint-safe policy §11.8)", () => {
      const payload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: [100000000000, 200000000000],
      });
      const result = decodeDailyDataPayload(payload);

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-numeric-json-value");
    });

    it("rejects numeric value nested in extra field", () => {
      const payload = JSON.stringify({
        schemaVersion: "v1",
        dailyData: ["100"],
        extra: { count: 42 },
      });
      const result = decodeDailyDataPayload(payload);

      assertFail(result);
      expect(result.code).toBe("hexmining-payload-numeric-json-value");
    });
  });

  describe("result shape — no sensitive fields exposed", () => {
    it("ok:true result does not contain canonicalPayload", () => {
      const result = decodeDailyDataPayload(validPayload());
      assertOk(result);
      const keys = Object.keys(result);

      expect(keys).not.toContain("canonicalPayload");
      expect(keys).not.toContain("payloadHash");
      expect(keys).not.toContain("rawDailyData");
    });

    it("ok:false result does not contain canonicalPayload", () => {
      const result = decodeDailyDataPayload("{bad json");
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("canonicalPayload");
    });

    it("result contains no yield, pricing, valuation, or PnL fields", () => {
      const result = decodeDailyDataPayload(validPayload());
      assertOk(result);
      const keys = Object.keys(result);

      expect(keys).not.toContain("yieldHex");
      expect(keys).not.toContain("price");
      expect(keys).not.toContain("pricing");
      expect(keys).not.toContain("valuation");
      expect(keys).not.toContain("pnl");
      expect(keys).not.toContain("apy");
    });
  });
});
