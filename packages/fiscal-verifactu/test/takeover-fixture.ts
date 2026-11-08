import { randomUUID } from "node:crypto";
import { handoverActivations, type Database } from "@waitron/db";
import type { NodeId } from "@waitron/shared";

/** Records that `destination` took over filing from `source`, as a finished handover does. */
export async function recordTakeover(
  db: Database,
  source: NodeId,
  destination: NodeId,
): Promise<void> {
  await db.insert(handoverActivations).values({
    operationId: randomUUID(),
    scenario: "controlled",
    sourceNodeId: source,
    destinationNodeId: destination,
    evidence: {} as never,
    personId: randomUUID(),
    activatedAt: "2026-07-20T18:00:00.000Z",
  });
}
