import { randomUUID } from "node:crypto";
import { handoverActivations, type Database, type Transaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import type { NodeId } from "@waitron/shared";
import { currentSif } from "../src/registro-sif.js";
import { seedFixtureSif } from "./sif-fixture.js";

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

/**
 * Opens an installation for `destination` under the same taxpayer and software as `source`'s open
 * one, as the box taking over files under; `source`'s installation and records stay as they are.
 */
export async function openSuccessorInstallation(
  tx: Transaction,
  source: NodeId,
  destination: NodeId,
): Promise<void> {
  const prior = await currentSif(tx, source);
  await seedFixtureSif(tx, {
    nodeId: destination,
    nif: prior.nif,
    idSistemaInformatico: prior.idSistemaInformatico,
  });
}
