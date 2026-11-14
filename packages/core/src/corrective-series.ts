// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
import { invoiceSeries } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { NodeId, SeriesId } from "@waitron/shared";

/**
 * Refuses a series a corrective invoice may not be numbered from: one that does not exist, belongs
 * to another node, is not `rectificative`, or is retired. Answers the series' code.
 */
export async function requireCorrectiveSeries(
  tx: Transaction,
  seriesId: SeriesId,
  nodeId: NodeId,
): Promise<{ code: string }> {
  const [series] = await tx
    .select({
      code: invoiceSeries.code,
      nodeId: invoiceSeries.nodeId,
      purpose: invoiceSeries.purpose,
      retiredAt: invoiceSeries.retiredAt,
    })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, seriesId));

  if (series === undefined) {
    throw new AppError("sale.series_not_found", { seriesId });
  }
  if (series.nodeId !== nodeId) {
    throw new AppError("sale.series_wrong_node", {
      seriesId,
      expected: series.nodeId,
      actual: nodeId,
    });
  }
  if (series.purpose !== "rectificative") {
    throw new AppError("sale.series_wrong_purpose", {
      seriesId,
      expected: "rectificative",
      actual: series.purpose,
    });
  }
  if (series.retiredAt !== null) {
    throw new AppError("sale.series_retired", {
      seriesId,
      retiredAt: series.retiredAt.toISOString(),
    });
  }
  return { code: series.code };
}
