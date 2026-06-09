import "server-only";

// ─── Result type ──────────────────────────────────────────────────────────────

export type DecodeDailyDataPayloadErrorCode =
  | "hexmining-payload-invalid-json"
  | "hexmining-payload-numeric-json-value"
  | "hexmining-payload-invalid-root"
  | "hexmining-payload-missing-schema-version"
  | "hexmining-payload-unsupported-schema-version"
  | "hexmining-payload-missing-daily-data"
  | "hexmining-payload-daily-data-not-array"
  | `hexmining-payload-item-not-string-at-${number}`
  | `hexmining-payload-item-invalid-at-${number}`;

export type DecodeDailyDataPayloadResult =
  | {
      ok: true;
      schemaVersion: "v1";
      dailyData: readonly bigint[];
      entryCount: number;
      warnings: string[];
    }
  | {
      ok: false;
      code: DecodeDailyDataPayloadErrorCode;
      warnings: string[];
    };

// ─── Validation helpers ───────────────────────────────────────────────────────

// Rejects any numeric JSON value anywhere in the structure (§11.8 policy).
function rejectNumericJsonValues(value: unknown): void {
  if (typeof value === "number") throw new Error("numeric-value");
  if (Array.isArray(value)) {
    for (const item of value) rejectNumericJsonValues(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      rejectNumericJsonValues(v);
    }
  }
}

// Accepts only base-10 unsigned integer decimal strings: /^[0-9]+$/.
// Leading zeros are accepted because BigInt("00123") === 123n — the bigint
// conversion is deterministic regardless of leading zeros. Callers receive
// bigint[], so leading-zero ambiguity does not propagate.
function isValidUnsignedDecimalString(s: string): boolean {
  return s.length > 0 && /^[0-9]+$/.test(s);
}

// ─── Decoder ─────────────────────────────────────────────────────────────────

export function decodeDailyDataPayload(canonicalPayload: string): DecodeDailyDataPayloadResult {
  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalPayload);
  } catch {
    return { ok: false, code: "hexmining-payload-invalid-json", warnings: ["hexmining-payload-invalid-json"] };
  }

  // 2. Reject numeric JSON values anywhere (§11.8 bigint-safe policy)
  try {
    rejectNumericJsonValues(parsed);
  } catch {
    return { ok: false, code: "hexmining-payload-numeric-json-value", warnings: ["hexmining-payload-numeric-json-value"] };
  }

  // 3. Root must be a non-null, non-array object
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: "hexmining-payload-invalid-root", warnings: ["hexmining-payload-invalid-root"] };
  }

  const root = parsed as Record<string, unknown>;

  // 4. schemaVersion must be present and === "v1"
  if (!("schemaVersion" in root)) {
    return { ok: false, code: "hexmining-payload-missing-schema-version", warnings: ["hexmining-payload-missing-schema-version"] };
  }
  if (root.schemaVersion !== "v1") {
    return { ok: false, code: "hexmining-payload-unsupported-schema-version", warnings: ["hexmining-payload-unsupported-schema-version"] };
  }

  // 5. dailyData must be present and an array
  if (!("dailyData" in root)) {
    return { ok: false, code: "hexmining-payload-missing-daily-data", warnings: ["hexmining-payload-missing-daily-data"] };
  }
  if (!Array.isArray(root.dailyData)) {
    return { ok: false, code: "hexmining-payload-daily-data-not-array", warnings: ["hexmining-payload-daily-data-not-array"] };
  }

  // 6. Decode each entry: must be a non-empty base-10 unsigned integer string
  const bigints: bigint[] = [];
  for (let i = 0; i < root.dailyData.length; i++) {
    const item = root.dailyData[i];
    if (typeof item !== "string") {
      return { ok: false, code: `hexmining-payload-item-not-string-at-${i}`, warnings: [`hexmining-payload-item-not-string-at-${i}`] };
    }
    if (!isValidUnsignedDecimalString(item)) {
      return { ok: false, code: `hexmining-payload-item-invalid-at-${i}`, warnings: [`hexmining-payload-item-invalid-at-${i}`] };
    }
    bigints.push(BigInt(item));
  }

  return {
    ok: true,
    schemaVersion: "v1",
    dailyData: bigints,
    entryCount: bigints.length,
    warnings: [],
  };
}
