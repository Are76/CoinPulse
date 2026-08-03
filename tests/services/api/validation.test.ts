import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";

import {
  buildInvalidInputResponse,
  manualSyncRequestSchema,
  parseJsonBody,
} from "@/services/api/validation";

describe("parseJsonBody", () => {
  it("converts malformed JSON into a ZodError", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: "{not valid json",
      headers: {
        "content-type": "application/json",
      },
    });

    await expect(parseJsonBody(z.object({ ok: z.boolean() }), request)).rejects.toMatchObject({
      issues: [
        {
          code: "custom",
          message: "Request body must be valid JSON.",
          path: [],
        },
      ],
    });
  });

  it("lets malformed JSON use the standard INVALID_INPUT response envelope", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: "{not valid json",
      headers: {
        "content-type": "application/json",
      },
    });

    let error: unknown;

    try {
      await parseJsonBody(z.object({ ok: z.boolean() }), request);
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(ZodError);

    const response = buildInvalidInputResponse(error as ZodError);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid request input.",
        details: [
          {
            path: "",
            message: "Request body must be valid JSON.",
            code: "custom",
          },
        ],
      },
    });
  });

  it("still parses valid JSON through the provided schema", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
      headers: {
        "content-type": "application/json",
      },
    });

    await expect(parseJsonBody(z.object({ ok: z.boolean() }), request)).resolves.toEqual({
      ok: true,
    });
  });
});

describe("manualSyncRequestSchema", () => {
  const BASE = {
    walletAddress: "0x75f808367720951e789d47e9e9db51148d9aa765",
    chainId: 369,
    sourceFamilies: ["TRANSFERS"] as const,
    startBlock: "1000",
    endBlock: "1999",
    policyLabel: "wallet-scoped-historical-sync-window-1",
  };

  it("defaults mode to execute when omitted", () => {
    const result = manualSyncRequestSchema.parse(BASE);
    expect(result.mode).toBe("execute");
  });

  it("accepts an explicit dry-run mode with startBlock present", () => {
    const result = manualSyncRequestSchema.parse({ ...BASE, mode: "dry-run" });
    expect(result.mode).toBe("dry-run");
    expect(result.startBlock).toBe(1000n);
    expect(result.endBlock).toBe(1999n);
  });

  it("rejects dry-run mode when startBlock is omitted", () => {
    const withoutStartBlock: Partial<typeof BASE> = { ...BASE };
    delete withoutStartBlock.startBlock;
    expect(() =>
      manualSyncRequestSchema.parse({ ...withoutStartBlock, mode: "dry-run" }),
    ).toThrow(ZodError);
  });

  it("still allows execute mode with startBlock omitted (cursor-resume behavior preserved)", () => {
    const withoutStartBlock: Partial<typeof BASE> = { ...BASE };
    delete withoutStartBlock.startBlock;
    const result = manualSyncRequestSchema.parse({ ...withoutStartBlock, mode: "execute" });
    expect(result.startBlock).toBeUndefined();
  });

  it("rejects an unknown mode value", () => {
    expect(() => manualSyncRequestSchema.parse({ ...BASE, mode: "chain-wide" })).toThrow(
      ZodError,
    );
  });

  it("rejects an empty sourceFamilies list", () => {
    expect(() =>
      manualSyncRequestSchema.parse({ ...BASE, mode: "dry-run", sourceFamilies: [] }),
    ).toThrow(ZodError);
  });

  it("rejects startBlock greater than endBlock in dry-run mode", () => {
    expect(() =>
      manualSyncRequestSchema.parse({
        ...BASE,
        mode: "dry-run",
        startBlock: "2000",
        endBlock: "1999",
      }),
    ).toThrow(ZodError);
  });

  it("rejects a dry-run range exceeding the safe block span", () => {
    expect(() =>
      manualSyncRequestSchema.parse({
        ...BASE,
        mode: "dry-run",
        startBlock: "1000",
        endBlock: "3000",
      }),
    ).toThrow(ZodError);
  });

  it("rejects a missing policyLabel", () => {
    const withoutPolicyLabel: Partial<typeof BASE> = { ...BASE };
    delete withoutPolicyLabel.policyLabel;
    expect(() =>
      manualSyncRequestSchema.parse({ ...withoutPolicyLabel, mode: "dry-run" }),
    ).toThrow(ZodError);
  });

  it("normalizes wallet address casing and never mixes in the Live Portfolio test wallet", () => {
    const result = manualSyncRequestSchema.parse({
      ...BASE,
      walletAddress: "0x75F808367720951E789D47E9E9DB51148D9Aa765",
      mode: "dry-run",
    });
    expect(result.walletAddress).toBe("0x75f808367720951e789d47e9e9db51148d9aa765");
    expect(result.walletAddress).not.toBe("0x08ac26d74013af7430c350c97eacd8be0bdc5613");
  });
});
