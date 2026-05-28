import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";

import { buildInvalidInputResponse, parseJsonBody } from "@/services/api/validation";

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
