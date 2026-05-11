import { buildInternalErrorResponse } from "@/services/api/validation";
import { listTrackedWallets } from "@/services/api/wallets";

export async function GET() {
  try {
    const wallets = await listTrackedWallets();

    return Response.json({
      data: {
        schemaVersion: "v1",
        wallets,
      },
    });
  } catch {
    return buildInternalErrorResponse();
  }
}
