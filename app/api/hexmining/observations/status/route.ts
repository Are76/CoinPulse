import { buildInternalErrorResponse } from "@/services/api/validation";
import { getHexMiningObservationStatus } from "@/services/api/hexmining-observations";

export async function GET() {
  try {
    return Response.json({ data: await getHexMiningObservationStatus() });
  } catch {
    return buildInternalErrorResponse(
      "Unable to determine HexMining observation status.",
    );
  }
}
