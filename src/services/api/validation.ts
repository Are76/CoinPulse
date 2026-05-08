import "server-only";

import { z } from "zod";

const SOURCE_FAMILY_VALUES = ["TRANSFERS", "DEX", "LP", "STAKING", "NATIVE"] as const;

const walletAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Wallet address must be a valid EVM address.")
  .transform((value) => value.toLowerCase());

const chainIdSchema = z.coerce
  .number()
  .int()
  .positive("Chain ID must be a positive integer.");

const blockNumberSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Block numbers must be unsigned integer strings.")
  .transform((value) => BigInt(value));

const quoteAssetSchema = z.string().trim().min(1).max(128).default("fiat:usd");

const sourceFamilySchema = z.enum(SOURCE_FAMILY_VALUES);

const optionalAsOfSchema = z
  .string()
  .trim()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();

export const dashboardRequestSchema = z.object({
  walletAddress: walletAddressSchema,
  chainId: chainIdSchema,
  quoteAsset: quoteAssetSchema,
  asOf: optionalAsOfSchema,
});

export const manualSyncRequestSchema = z
  .object({
    walletAddress: walletAddressSchema,
    chainId: chainIdSchema,
    sourceFamilies: z.array(sourceFamilySchema).min(1),
    startBlock: blockNumberSchema.optional(),
    endBlock: blockNumberSchema,
    policyLabel: z.string().trim().min(1).max(128),
  })
  .refine((value) => !value.startBlock || value.startBlock <= value.endBlock, {
    path: ["startBlock"],
    message: "startBlock must be less than or equal to endBlock.",
  });

export const rebuildRequestSchema = z
  .object({
    walletAddress: walletAddressSchema,
    chainId: chainIdSchema,
    fromBlock: blockNumberSchema,
    toBlock: blockNumberSchema,
    sourceFamilies: z.array(sourceFamilySchema).min(1),
  })
  .refine((value) => value.fromBlock <= value.toBlock, {
    path: ["fromBlock"],
    message: "fromBlock must be less than or equal to toBlock.",
  });

export const walletImportRequestSchema = z.object({
  walletAddress: walletAddressSchema,
  chainId: chainIdSchema,
  label: z.string().trim().min(1).max(120).optional(),
});

export type DashboardRequestInput = z.infer<typeof dashboardRequestSchema>;
export type ManualSyncRequestInput = z.infer<typeof manualSyncRequestSchema>;
export type RebuildRequestInput = z.infer<typeof rebuildRequestSchema>;
export type WalletImportRequestInput = z.infer<typeof walletImportRequestSchema>;

export function parseSearchParams<T extends z.ZodType>(schema: T, request: Request): z.infer<T> {
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return schema.parse(payload);
}

export async function parseJsonBody<T extends z.ZodType>(schema: T, request: Request): Promise<z.infer<T>> {
  const payload = await request.json();
  return schema.parse(payload);
}

export function buildInvalidInputResponse(error: z.ZodError) {
  return Response.json(
    {
      error: {
        code: "INVALID_INPUT",
        message: "Invalid request input.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      },
    },
    { status: 400 },
  );
}

export function buildNotFoundResponse(code: string, message: string) {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status: 404 },
  );
}

export function buildConflictResponse(code: string, message: string, details?: unknown) {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(typeof details === "undefined" ? {} : { details }),
      },
    },
    { status: 409 },
  );
}

export function buildInternalErrorResponse(message = "Internal server error.") {
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    { status: 500 },
  );
}

export function serializeForJson<T>(value: T): T {
  if (typeof value === "bigint") {
    return value.toString() as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeForJson(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeForJson(item)]),
    ) as T;
  }
  return value;
}
