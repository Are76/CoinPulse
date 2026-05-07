export function logInfo(
  message: string,
  context?: Record<string, unknown>,
) {
  console.info(message, context ?? {});
}

export function logError(
  message: string,
  context?: Record<string, unknown>,
) {
  console.error(message, context ?? {});
}
