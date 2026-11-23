import { desc, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { handoverActivations, nodes, type Database, type Transaction } from "@waitron/db";
import { readCompletedReturns } from "./return-completion.js";
import type { Declaration } from "./handover-emergency-api.js";
import type { HeardCopy } from "./old-box-holdings.js";

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
  const completed = await readCompletedReturns(tx);
  return rows.map(({ evidence, ...row }) => {
    const declaration = evidence.body as Declaration;
    return {
      ...row,
      inventoryReceived: completed.has(row.operationId),
      lastChangeAtMs: declaration.lastCopy.lastChangeAtMs,
      declaredAtMs: declaration.declaredAtMs,
      reason: declaration.reason,
    };
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The latest takeover from `sourceNodeId` this box activated, or null when there is none. */
export async function latestTakeoverFrom(db: Database, sourceNodeId: string) {
  const [row] = await db
    .select({
      operationId: handoverActivations.operationId,
      scenario: handoverActivations.scenario,
      evidence: handoverActivations.evidence,
    })
    .from(handoverActivations)
    .where(eq(handoverActivations.sourceNodeId, sourceNodeId))
    .orderBy(desc(handoverActivations.activatedAt), desc(handoverActivations.operationId))
    .limit(1);
  return row ?? null;
}

/**
 * The copy's latest sale or order time when the latest takeover from `sourceNodeId` was an
 * emergency switch; null after a planned handover or with no takeover from that box.
 */
export async function emergencyCopyFrom(
  db: Database,
  sourceNodeId: string,
): Promise<HeardCopy | null> {
  const row = await latestTakeoverFrom(db, sourceNodeId);
  if (row?.scenario !== "emergency") return null;
  const body: unknown = row.evidence.body;
  const lastCopy = isRecord(body) ? body.lastCopy : undefined;
  const at = isRecord(lastCopy) ? lastCopy.lastChangeAtMs : undefined;
  // A fault in Waitron: the declared copy time comes from this box's own `checkEmergencyCopy`.
  if (at !== null && !Number.isSafeInteger(at))
    throw new Error(`takeover from node ${sourceNodeId} declares no readable copy time`);
  return { lastChangeAtMs: at as number | null };
}
