import { buildInternalErrorResponse } from "@/services/api/validation";
import { getHealthReport } from "@/services/debug";

export async function GET() {
  try {
    const report = await getHealthReport();
    return Response.json(
      { data: report },
      { status: report.status === "ok" ? 200 : 503 },
    );
  } catch {
    return buildInternalErrorResponse("Unable to determine backend health.");
  }
}
