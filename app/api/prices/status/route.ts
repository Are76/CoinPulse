import { buildInternalErrorResponse } from "@/services/api/validation";
import { getPricingStatusReport } from "@/services/api/prices";

export async function GET() {
  try {
    return Response.json({ data: await getPricingStatusReport() });
  } catch {
    return buildInternalErrorResponse("Unable to determine pricing status.");
  }
}
