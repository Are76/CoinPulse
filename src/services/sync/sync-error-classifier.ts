import { Prisma } from "@prisma/client";

export function classifySyncError(error: unknown) {
  if (!(error instanceof Error)) {
    return "non_error_throwable";
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return "database_known_request_error";
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return "database_validation_error";
  }

  const fingerprint = `${error.name} ${error.message}`.toLowerCase();

  if (fingerprint.includes("contractfunctionexecutionerror")) {
    return "contract_function_execution_error";
  }

  if (fingerprint.includes("timeout") || fingerprint.includes("timed out")) {
    return "timeout_error";
  }

  if (
    fingerprint.includes("network") ||
    fingerprint.includes("connect") ||
    fingerprint.includes("connection") ||
    fingerprint.includes("enotfound") ||
    fingerprint.includes("econnrefused") ||
    fingerprint.includes("econnreset")
  ) {
    return "network_error";
  }

  return "unexpected_error";
}
