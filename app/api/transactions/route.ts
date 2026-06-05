import "server-only";

import { ZodError } from "zod";

import { listTransactionsArgsSchema } from "@/services/transactions/types";
import { listCanonicalTransactions } from "@/services/transactions/transaction-service";
import {
  buildInvalidInputResponse,
  buildInternalErrorResponse,
} from "@/services/api/validation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  // listTransactionsArgsSchema uses z.number() (not z.coerce), so coerce from URL strings
  const rawArgs = {
    ...params,
    chainId: params.chainId !== undefined ? Number(params.chainId) : undefined,
    limit: params.limit !== undefined ? Number(params.limit) : undefined,
  };

  let args: ReturnType<typeof listTransactionsArgsSchema.parse>;

  try {
    args = listTransactionsArgsSchema.parse(rawArgs);
  } catch (err) {
    if (err instanceof ZodError) {
      return buildInvalidInputResponse(err);
    }
    return buildInternalErrorResponse();
  }

  try {
    const page = await listCanonicalTransactions(args);
    return Response.json({ data: page });
  } catch {
    return buildInternalErrorResponse();
  }
}
