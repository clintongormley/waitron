import { randomUUID } from "node:crypto";
import { handoverActivations, type Database } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import type { NodeId } from "@waitron/shared";

/** Records that `destination` took over filing from `source`, as a finished handover does. */
export async function recordTakeover(
  db: Database,
  source: NodeId,
  destination: NodeId,
): Promise<void> {
  const personId = randomUUID();
  await seedPerson(db, { id: personId, displayName: `Handover operator ${personId}` });
  await db.insert(handoverActivations).values({
    operationId: randomUUID(),
    scenario: "controlled",
    sourceNodeId: source,
    destinationNodeId: destination,
    evidence: {} as never,
    personId,
    activatedAt: "2026-07-20T18:00:00.000Z",
  });
}
