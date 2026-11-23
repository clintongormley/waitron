import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { sql, type SQL } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import { openVenueDatabase, withTransaction, type Transaction } from "@waitron/db";
import { openFilingCase } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import { checkFiscalChains } from "@waitron/fiscal-verifactu/src/handover-chain-check.js";
import { decodeRegistroRow, fromRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { quoteIdent } from "@waitron/provisioning";
import { openBackupQuery } from "@waitron/store";
import { computeHuella } from "@waitron/verifactu";

type RawRow = Record<string, SQLInputValue>;
type Head = RawRow & {
  id: string;
  secuencia: number;
  sif_id: string;
  id_emisor_factura: string;
  num_serie_factura: string;
  fecha_expedicion_factura: string;
  huella: string;
};

const BATCH_SIZE = 1_000;
const identifier = (name: string) => sql.raw(quoteIdent(name));
const commas = (parts: SQL[]) => sql.join(parts, sql`, `);

function walkUpColumns(tx: Transaction) {
  const uniqueColumns = new Set<string>();
  for (const index of tx.all<{ name: string; origin: string }>(
    sql`select name, origin from pragma_index_list('sales') where "unique" = 1`,
  )) {
    if (index.origin === "pk") continue;
    const columns = tx.all<{ name: string }>(
      sql`select name from pragma_index_info(${index.name}) order by seqno`,
    );
    const names = columns.map((column) => column.name);
    if (names.length === 2 && names.includes("series_id") && names.includes("invoice_number"))
      continue;
    for (const name of names) uniqueColumns.add(name);
  }
  return tx
    .all<{ name: string; required: number }>(
      sql`select name, "notnull" as required from pragma_table_info('sales')`,
    )
    .map(({ name, required }) => {
      const clear = uniqueColumns.has(name);
      if (clear && required)
        throw new Error(`bench: cannot copy a walk-up sale with a required unique column ${name}`);
      return { name, clear };
    });
}

function totals(tx: Transaction) {
  const [{ records, sales, submissions }] = tx.all<{
    records: number;
    sales: number;
    submissions: number;
  }>(sql`select (select count(*) from verifactu_records) as records,
                (select count(*) from sales) as sales,
                (select count(*) from verifactu_submissions) as submissions`);
  return `verifactu_records ${records}, sales ${sales}, verifactu_submissions ${submissions}`;
}

export async function growFiscal(
  dir: string,
  target: number,
  print: (line: string) => void,
  cases = 0,
) {
  if (!Number.isSafeInteger(target) || target < 1)
    throw new Error("bench: --records must be a positive safe integer");
  const store = await openVenueDatabase(dir);
  try {
    const db = store.venue;
    print(`before: ${totals(db)}`);
    const [node] = db.all<{ id: string }>(sql`select id from nodes order by rowid limit 1`);
    if (node === undefined) throw new Error("bench: the venue has no node");
    const [initialHead] =
      db.all<Head>(sql`select * from verifactu_records where node_id = ${node.id}
      order by secuencia desc limit 1`);
    if (initialHead === undefined)
      throw new Error("bench: build a trading day before growing a chain");
    let head = initialHead;
    const [{ count }] = db.all<{ count: number }>(
      sql`select count(*) as count from verifactu_records where node_id = ${node.id}`,
    );
    let remaining = target - count;
    if (!Number.isSafeInteger(cases) || cases < 0 || cases > Math.max(remaining, 0))
      throw new Error("bench: --cases must fit in the records being added");
    if (remaining > 0) {
      const [template] = db.all<Head & { invoice_series_id: string; invoice_series_code: string }>(
        sql`select r.*, i.id as invoice_series_id, i.code as invoice_series_code
            from verifactu_records r join sales s on s.id = r.sale_id
            join invoice_series i on i.id = s.series_id
            where r.node_id = ${node.id} and r.sif_id = ${head.sif_id}
              and r.tipo_registro = 'alta' and r.corrects_registro_id is null
              and s.corrects_sale_id is null
            order by r.secuencia desc limit 1`,
      );
      if (template === undefined) throw new Error("bench: the current chain has no ordinary sale");
      const { invoice_series_id: seriesId, invoice_series_code: code, ...record } = template;
      const [{ maximum }] = db.all<{ maximum: number }>(
        sql`select max(invoice_number) as maximum from sales where series_id = ${seriesId}`,
      );
      let number = maximum;
      const saleColumns = walkUpColumns(db);
      const saleNames = commas(saleColumns.map(({ name }) => identifier(name)));
      const recordNames = commas(Object.keys(record).map(identifier));
      const hasStoredHead =
        db.all(sql`
        select 1 from sqlite_schema where type = 'table' and name = 'cadenas'
      `).length !== 0;
      const hasStoredNumber =
        db.all(sql`
        select 1 from pragma_table_info('invoice_series') where name = 'next_number'
      `).length !== 0;
      const [submission] = db.all<{ csv: string | null }>(
        sql`select csv from verifactu_submissions where registro_id = ${record.id}`,
      );

      const start = head.secuencia;
      const grownCount = remaining;
      let openedCases = 0;
      while (remaining > 0) {
        const batch = Math.min(remaining, BATCH_SIZE);
        await withTransaction(db, async (tx) => {
          for (let index = 0; index < batch; index++) {
            const saleId = randomUUID();
            number++;
            const saleValues = commas(
              saleColumns.map(({ name, clear }) => {
                if (name === "id") return sql`${saleId}`;
                if (name === "invoice_number") return sql`${number}`;
                return clear ? sql`null` : identifier(name);
              }),
            );
            tx.run(sql`insert into sales (${saleNames})
              select ${saleValues} from sales where id = ${record.sale_id}`);

            const next: Head = {
              ...record,
              id: randomUUID(),
              sale_id: saleId,
              secuencia: head.secuencia + 1,
              num_serie_factura: formatInvoiceNumber(code, number),
              primer_registro: 0,
              anterior_id_emisor_factura: head.id_emisor_factura,
              anterior_num_serie_factura: head.num_serie_factura,
              anterior_fecha_expedicion_factura: head.fecha_expedicion_factura,
              anterior_huella: head.huella,
            };
            next.huella = computeHuella(fromRegistroRow(decodeRegistroRow(next)));
            const recordValues = commas(Object.values(next).map((value) => sql`${value}`));
            tx.run(sql`insert into verifactu_records (${recordNames}) values (${recordValues})`);
            tx.run(sql`insert into verifactu_submissions
              (registro_id, estado, csv, proximo_intento_en)
              values (${next.id}, 'aceptado', ${submission?.csv ?? null},
                ${next.fecha_hora_huso_gen_registro})`);
            if (
              openedCases < cases &&
              next.secuencia - start === Math.ceil(((openedCases + 1) * grownCount) / cases)
            ) {
              await openFilingCase(tx, {
                registroId: next.id,
                cause: "fiscal.registro_rechazado",
                evidence: { codigo: null, mensaje: null, csv: null },
                now: new Date(String(next.fecha_hora_huso_gen_registro)),
              });
              openedCases++;
            }
            head = next;
          }
          if (hasStoredHead)
            tx.run(sql`update cadenas set secuencia = ${head.secuencia},
              ultimo_registro_id = ${head.id}, ultima_huella = ${head.huella}
              where node_id = ${node.id}`);
          if (hasStoredNumber)
            tx.run(
              sql`update invoice_series set next_number = ${number + 1} where id = ${seriesId}`,
            );
        });
        remaining -= batch;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    print(`after: ${totals(db)}`);
  } finally {
    await store.close();
  }

  const handle = await openBackupQuery(join(dir, "venue.db"));
  try {
    const result = await checkFiscalChains(handle.query);
    if (result === "broken") throw new Error("bench: grown fiscal chain is broken");
    print("chains ok");
  } finally {
    await handle.close();
  }
}
