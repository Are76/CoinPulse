import { buildInternalErrorResponse } from "@/services/api/validation";
import { getDebugStatusReport } from "@/services/debug";

export async function GET() {
  try {
    return Response.json({ data: getDebugStatusReport() });
  } catch {
    return buildInternalErrorResponse("Unable to determine backend status.");
  }
}
