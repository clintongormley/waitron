import { seedTaxpayerWithSif } from "../../test/fixtures.js";
import { currentSif } from "../registro-sif.js";
import { sql } from "drizzle-orm";
import { readTaxpayer, withTransaction, type Database } from "@waitron/db";
import { appendToChain } from "../chain.js";
import type { ReturnRow } from "../handover-return.js";
import { altaFor, seedSale, type SeededNode } from "./seed.js";

export async function copyReturnFiscalMetadata(
  source: Database,
  receiver: Database,
): Promise<void> {
  await withTransaction(receiver, async (tx) => {
    for (const table of ["nodes", "invoice_series", "verifactu_identities"]) {
      for (const row of source.all<ReturnRow>(sql`select * from ${sql.identifier(table)}`)) {
        const entries = Object.entries(row);
        await tx.execute(sql`insert into ${sql.identifier(table)}
          (${sql.join(
            entries.map(([key]) => sql.identifier(key)),
            sql`, `,
          )})
          values (${sql.join(
            entries.map(([, value]) => sql`${value}`),
            sql`, `,
          )})`);
      }
    }
  });
}

export async function appendOriginalForReturn(
  db: Database,
  node: SeededNode,
  number: number,
): Promise<string> {
  const sale = await seedSale(db, node, number);
  const identity = db.get<{ nif: string; installation: string }>(
    sql`select nif, numero_instalacion as installation from verifactu_identities where id = ${node.sifId}`,
  )!;
  const pending = altaFor(node, sale, number, number);
  pending.input.IDEmisorFactura = identity.nif;
  pending.input.SistemaInformatico.NumeroInstalacion = identity.installation;
  await withTransaction(db, (tx) => appendToChain(tx, node.nodeId, pending));
  return db.get<{ id: string }>(sql`select id from verifactu_records where sale_id = ${sale}`)!.id;
}

export async function seedReturnNodeForVenue(
  source: Database,
  receiver: Database,
): Promise<SeededNode> {
  const taxpayer = await readTaxpayer(receiver);
  const seeded = await seedTaxpayerWithSif(source, { nif: taxpayer!.taxId });
  const identity = await withTransaction(source, (tx) => currentSif(tx, seeded.nodeId));
  return { ...seeded, sifId: identity.id };
}
