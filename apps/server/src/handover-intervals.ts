import { desc, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { handoverActivations, nodes, type Transaction } from "@waitron/db";
import type { Declaration } from "./handover-emergency-api.js";

export async function readHandoverIntervals(tx: Transaction) {
  const source = alias(nodes, "source");
  const destination = alias(nodes, "destination");
  const rows = await tx
    .select({
      operationId: handoverActivations.operationId,
      sourceName: source.name,
      destinationName: destination.name,
      evidence: handoverActivations.evidence,
      activatedAt: handoverActivations.activatedAt,
    })
    .from(handoverActivations)
    .innerJoin(source, eq(source.id, handoverActivations.sourceNodeId))
    .innerJoin(destination, eq(destination.id, handoverActivations.destinationNodeId))
    .where(eq(handoverActivations.scenario, "emergency"))
    .orderBy(desc(handoverActivations.activatedAt), asc(handoverActivations.operationId));
  return rows.map(({ evidence, ...row }) => {
    const declaration = evidence.body as Declaration;
    return {
      ...row,
      lastChangeAtMs: declaration.lastCopy.lastChangeAtMs,
      declaredAtMs: declaration.declaredAtMs,
      reason: declaration.reason,
    };
  });
}
