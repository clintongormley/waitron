import { invoiceSeries, newId, withTransaction, type Database } from "@waitron/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FiscalAllocation } from "../src/allocation-envelope.js";
import { fiscalAllocations } from "../src/schema/allocations.js";
import { registroSif } from "../src/schema/sif.js";

/**
 * Writes a later installation `identity` beside the node's active one, as a copy of its activation:
 * one revoked `registro_sif` row, its retired series under the new name, and an allocation row
 * naming them, each consistent with the others so `readHourHistory` still reads the database as
 * complete.
 */
export async function writeLaterInstallation(
  db: Database,
  nodeId: string,
  identity: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const [sif] = await tx
      .select()
      .from(registroSif)
      .where(and(eq(registroSif.nodeId, nodeId), isNull(registroSif.revocadoEn)));
    const [activation] = await tx
      .select()
      .from(fiscalAllocations)
      .where(eq(fiscalAllocations.sifId, sif!.id));
    const at = new Date();
    const sifId = newId();
    await tx.insert(registroSif).values({
      id: sifId,
      nodeId,
      nif: sif!.nif,
      idSistemaInformatico: sif!.idSistemaInformatico,
      numeroInstalacion: identity,
      registradoEn: at,
      revocadoEn: at,
    });
    const series = activation!.bases.map(({ code, purpose }) => ({
      id: newId(),
      code: `${code}-${identity}`,
      purpose,
    }));
    for (const entry of series)
      await tx.insert(invoiceSeries).values({ ...entry, nodeId, retiredAt: at });
    const eventKey = `${activation!.eventKey}-${identity}`;
    const allocation: FiscalAllocation = {
      ...activation!.allocation,
      allocationId: `${activation!.allocation.allocationId}-${identity}`,
      installationIdentity: identity,
      series: series.map(({ code, purpose }) => ({ code, purpose })),
    };
    await tx.insert(fiscalAllocations).values({
      ...activation!,
      eventKey,
      allocationKey: allocation.allocationId,
      sifId,
      installationIdentity: identity,
      allocation,
      approval: { ...activation!.approval, eventId: eventKey },
      result: { activationEventId: eventKey, sifId, series },
      activatedAt: at,
    });
  });
}
