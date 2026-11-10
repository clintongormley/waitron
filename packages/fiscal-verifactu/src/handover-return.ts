import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { canonicalize } from "@waitron/membership";

export type ReturnRow = Record<string, string | number | null>;
export interface ReturnedOriginals {
  records: ReturnRow[];
  sales: ReturnRow[];
  devices: ReturnRow[];
  heads: ReturnRow[];
  deliveries: ReturnRow[];
  tenders: ReturnRow[];
  settlements: ReturnRow[];
  voids: ReturnRow[];
  substitutions: ReturnRow[];
  inventory: string;
}

export async function readReturnedOriginals(
  tx: Transaction,
  sourceNodeId: string,
): Promise<ReturnedOriginals> {
  const saleIds = sql`(select sale_id from registros_facturacion where node_id = ${sourceNodeId})`;
  const records = tx.all<ReturnRow>(sql`
    select * from registros_facturacion where node_id = ${sourceNodeId} order by secuencia`);
  const sales = tx.all<ReturnRow>(sql`select * from sales where id in ${saleIds} order by id`);
  const devices = tx.all<ReturnRow>(sql`select * from devices where id in (
    select device_id from registros_facturacion where node_id = ${sourceNodeId}
    union select device_id from sales where id in ${saleIds}
  ) order by id`);
  const heads = tx.all<ReturnRow>(sql`select * from cadenas where node_id = ${sourceNodeId}`);
  const deliveries = tx.all<ReturnRow>(sql`select e.* from envios e
    join registros_facturacion r on r.id = e.registro_id
    where r.node_id = ${sourceNodeId} order by e.registro_id`);
  const tenders = tx.all<ReturnRow>(
    sql`select * from tenders where sale_id in ${saleIds} order by id`,
  );
  const settlements = tx.all<ReturnRow>(
    sql`select * from sale_settlements where sale_id in ${saleIds} order by id`,
  );
  const voids = tx.all<ReturnRow>(
    sql`select * from sale_voids where sale_id in ${saleIds} order by id`,
  );
  const substitutions = tx.all<ReturnRow>(sql`select * from sale_substitutions
    where substitution_sale_id in ${saleIds} order by id`);
  // Delivery verdicts and device registrations may change independently of the originals.
  const inventory = createHash("sha256")
    .update(canonicalize({ records, sales, tenders, settlements, voids, substitutions }))
    .digest("hex");
  return {
    records,
    sales,
    devices,
    heads,
    deliveries,
    tenders,
    settlements,
    voids,
    substitutions,
    inventory,
  };
}
