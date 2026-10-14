import type { Transaction } from "@waitron/db";
import { and, eq } from "drizzle-orm";
import { registerSif, type RegisterSifParams } from "../src/registro-sif.js";
import { registroSif } from "../src/schema/sif.js";

export async function seedFixtureSif(
  tx: Transaction,
  params: Omit<RegisterSifParams, "numeroInstalacion"> & { numeroInstalacion?: string },
) {
  const rows = await tx
    .select({ id: registroSif.id })
    .from(registroSif)
    .where(
      and(
        eq(registroSif.nif, params.nif),
        eq(registroSif.idSistemaInformatico, params.idSistemaInformatico),
      ),
    );
  // Historical fixture identities keep record bytes independent of the allocation transport.
  return registerSif(tx, {
    ...params,
    numeroInstalacion: params.numeroInstalacion ?? String(rows.length + 1),
  });
}
