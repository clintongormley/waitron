import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { refusalOn, triggerRaised, UNIQUE_VIOLATION, type Transaction } from "@waitron/db";
import type { BackupQuery } from "@waitron/store";
import { checkFiscalChains } from "./handover-chain-check.js";
import { openFilingCase, openAcceptedWithErrorsCase } from "./filing-cases.js";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { canonicalize, type CanonicalValue } from "@waitron/membership";

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
  const saleIds = sql`(with recursive parents(id) as (
    select sale_id from registros_facturacion where node_id = ${sourceNodeId}
    union select s.corrects_sale_id from sales s join parents p on p.id = s.id
      where s.corrects_sale_id is not null
    union select s.substituted_sale_id from sale_substitutions s
      join parents p on p.id = s.substitution_sale_id
  ) select id from parents)`;
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

async function insertRow(tx: Transaction, table: string, row: ReturnRow) {
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

function held(tx: Transaction, table: string, id: ReturnRow[string], key = "id") {
  return tx.all<ReturnRow>(sql`select * from ${sql.identifier(table)}
    where ${sql.identifier(key)} = ${id}`)[0];
}

export async function receiveReturnedOriginals(
  tx: Transaction,
  sourceNodeId: string,
  returned: ReturnedOriginals,
  now: Date,
): Promise<{ complete: boolean }> {
  if (!returnBatchFits(returned))
    throw new AppError("fiscal.return_invalid", { reason: "batch exceeds bounds" });
  for (const sale of returned.sales) {
    if (
      !held(tx, "nodes", sale.node_id) ||
      held(tx, "invoice_series", sale.series_id)?.node_id !== sale.node_id
    )
      throw new AppError("fiscal.return_invalid", { reason: "missing sale metadata" });
  }
  for (const record of returned.records) {
    if (
      record.node_id !== sourceNodeId ||
      held(tx, "registro_sif", record.sif_id)?.node_id !== sourceNodeId
    )
      throw new AppError("fiscal.return_invalid", { reason: "missing record metadata" });
  }
  const allowed: ReturnRow[] = [];
  let blocked = false;
  for (const record of [...returned.records].sort(
    (a, b) => Number(a.secuencia) - Number(b.secuencia),
  )) {
    if (blocked) continue;
    const own = held(tx, "registros_facturacion", record.id);
    const [collision] = tx.all<ReturnRow>(sql`select * from registros_facturacion where
      (node_id = ${record.node_id} and secuencia = ${record.secuencia}) or
      (${record.corrects_registro_id} is null and corrects_registro_id is null and
        id_emisor_factura = ${record.id_emisor_factura} and num_serie_factura = ${record.num_serie_factura}
        and fecha_expedicion_factura = ${record.fecha_expedicion_factura}
        and tipo_registro = ${record.tipo_registro}) limit 1`);
    const conflict = own
      ? canonicalize(own) !== canonicalize(record)
        ? own
        : undefined
      : collision;
    if (conflict) {
      blocked = true;
    } else allowed.push(record);
  }
  const needed = new Set(allowed.map((row) => row.sale_id));
  function includeParent(id: ReturnRow[string]) {
    const sale = returned.sales.find((row) => row.id === id);
    const parents = [
      sale?.corrects_sale_id,
      ...returned.substitutions
        .filter((row) => row.substitution_sale_id === id)
        .map((row) => row.substituted_sale_id),
    ];
    for (const parent of parents)
      if (parent && !needed.has(parent)) {
        needed.add(parent);
        includeParent(parent);
      }
  }
  for (const id of needed) includeParent(id);
  for (const device of returned.devices) {
    if (held(tx, "devices", device.id)) continue;
    const location = held(tx, "nodes", sourceNodeId)?.location_id;
    const [profile] = tx.all<ReturnRow>(sql`select id from device_profiles order by id limit 1`);
    await insertRow(tx, "devices", {
      id: device.id!,
      label: device.label!,
      location_id: location!,
      device_profile_id: profile!.id!,
      token_hash: "",
      active: 0,
      deleted_at: now.toISOString(),
      enrolled_at: now.toISOString(),
      created_at: now.toISOString(),
    });
  }
  let missing = false;
  for (const sale of orderedSales(returned.sales.filter((row) => needed.has(row.id)))) {
    if (!held(tx, "sales", sale.id))
      await insertRow(tx, "sales", { ...sale, working_order_id: null });
    try {
      await tx.transaction(async (paymentTx) => {
        for (const tender of returned.tenders.filter((row) => row.sale_id === sale.id)) {
          if (!held(paymentTx, "tenders", tender.id))
            await insertRow(paymentTx, "tenders", {
              ...tender,
              bill_payment_id: held(paymentTx, "bill_payments", tender.bill_payment_id)
                ? tender.bill_payment_id!
                : null,
            });
        }
        for (const settlement of returned.settlements.filter((row) => row.sale_id === sale.id)) {
          if (!held(paymentTx, "sale_settlements", settlement.id))
            await insertRow(paymentTx, "sale_settlements", settlement);
        }
      });
    } catch (error) {
      if (
        !refusalOn(error, UNIQUE_VIOLATION, { table: "tenders", columns: ["bill_payment_id"] }) &&
        !refusalOn(error, UNIQUE_VIOLATION, { table: "sale_settlements", columns: ["sale_id"] }) &&
        !triggerRaised(error, "tenders do not cover the sale")
      )
        throw error;
      missing = true;
    }
  }
  for (const record of allowed) {
    if (held(tx, "registros_facturacion", record.id)) continue;
    await insertRow(tx, "registros_facturacion", record);
    const delivery = returned.deliveries.find((row) => row.registro_id === record.id);
    await insertRow(
      tx,
      "envios",
      delivery ?? {
        registro_id: record.id!,
        estado: "pendiente",
        proximo_intento_en: now.toISOString(),
      },
    );
    if (delivery?.estado === "rechazado")
      await openFilingCase(tx, {
        registroId: String(record.id),
        cause: "fiscal.registro_rechazado",
        evidence: {
          codigo: delivery.codigo_error === null ? null : Number(delivery.codigo_error),
          mensaje: delivery.mensaje_error as string | null,
          csv: delivery.csv as string | null,
        },
        now,
      });
    if (delivery?.estado === "aceptado_con_errores")
      await openAcceptedWithErrorsCase(tx, {
        registroId: String(record.id),
        codigo: delivery.codigo_error === null ? null : Number(delivery.codigo_error),
        mensaje: delivery.mensaje_error as string | null,
        csv: delivery.csv as string | null,
        now,
      });
  }
  for (const [table, rows] of [
    ["sale_voids", returned.voids],
    ["sale_substitutions", returned.substitutions],
  ] as const) {
    for (const row of rows) {
      const own = held(tx, table, row.id);
      let conflict = own !== undefined && canonicalize(own) !== canonicalize(row);
      if (!own) {
        try {
          await insertRow(tx, table, row);
        } catch (error) {
          const key = table === "sale_voids" ? "sale_id" : "substituted_sale_id";
          if (!refusalOn(error, UNIQUE_VIOLATION, { table, columns: [key] })) throw error;
          conflict = true;
        }
      }
      if (conflict) missing = true;
    }
  }
  const [last] = tx.all<ReturnRow>(sql`select * from registros_facturacion
    where node_id = ${sourceNodeId} order by secuencia desc limit 1`);
  const head = held(tx, "cadenas", sourceNodeId, "node_id");
  if (last && Number(last.secuencia) > Number(head?.secuencia ?? 0)) {
    await tx.execute(sql`update cadenas set secuencia = ${last.secuencia},
      ultimo_registro_id = ${last.id}, ultima_huella = ${last.huella},
      actualizado_en = ${returned.heads[0]?.actualizado_en ?? now.toISOString()}
      where node_id = ${sourceNodeId}`);
  }
  if ((await checkFiscalChains(transactionQuery(tx))) !== "ok")
    throw new AppError("fiscal.return_invalid", { reason: "chain verification failed" });
  for (const [table, rows] of [
    ["registros_facturacion", returned.records],
    ["sales", returned.sales],
    ["tenders", returned.tenders],
    ["sale_settlements", returned.settlements],
    ["sale_voids", returned.voids],
    ["sale_substitutions", returned.substitutions],
  ] as const) {
    for (const row of rows) {
      const own = held(tx, table, row.id);
      if (!own) {
        missing = true;
        continue;
      }
      if (canonicalize(normalized(table, own)) === canonicalize(normalized(table, row))) continue;
      missing = true;
    }
  }
  return { complete: !blocked && !missing };
}

function orderedSales(sales: ReturnRow[]): ReturnRow[] {
  const remaining = new Map(sales.map((sale) => [sale.id, sale]));
  const ordered: ReturnRow[] = [];
  function visit(sale: ReturnRow) {
    remaining.delete(sale.id);
    const parent = remaining.get(sale.corrects_sale_id);
    if (parent) visit(parent);
    ordered.push(sale);
  }
  for (const sale of [...sales].sort(
    (a, b) => Date.parse(String(a.issued_at)) - Date.parse(String(b.issued_at)),
  )) {
    if (remaining.has(sale.id)) visit(sale);
  }
  return ordered;
}

function transactionQuery(tx: Transaction): BackupQuery {
  return {
    async *rows(statement, values = []) {
      const parts = statement.split("?");
      const query = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) query.append(sql`${values[i - 1]}`);
        query.append(sql.raw(parts[i]!));
      }
      for (const row of tx.all<ReturnRow>(query))
        yield Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value,
          ]),
        );
    },
  };
}

function normalized(table: string, row: ReturnRow): ReturnRow {
  if (table === "sales") return { ...row, working_order_id: null };
  if (table === "tenders") return { ...row, bill_payment_id: null };
  return row;
}

export function makeReturnedBatches(snapshot: ReturnedOriginals): ReturnedOriginals[] {
  const empty = (): ReturnedOriginals => ({
    records: [],
    sales: [],
    devices: [],
    heads: [],
    deliveries: [],
    tenders: [],
    settlements: [],
    voids: [],
    substitutions: [],
    inventory: snapshot.inventory,
  });
  const batches: ReturnedOriginals[] = [];
  const sent = new Set<ReturnRow[string]>();
  let current = empty();
  for (const record of snapshot.records) {
    const ids = new Set([record.sale_id]);
    for (const id of ids) {
      const sale = snapshot.sales.find((row) => row.id === id);
      if (sale?.corrects_sale_id) ids.add(sale.corrects_sale_id);
      for (const substitution of snapshot.substitutions)
        if (substitution.substitution_sale_id === id) ids.add(substitution.substituted_sale_id);
    }
    const unit = empty();
    unit.records = [record];
    unit.sales = snapshot.sales.filter((row) => ids.has(row.id) && !sent.has(row.id));
    const newIds = new Set(unit.sales.map((row) => row.id));
    unit.tenders = snapshot.tenders.filter((row) => newIds.has(row.sale_id));
    unit.settlements = snapshot.settlements.filter((row) => newIds.has(row.sale_id));
    unit.voids = snapshot.voids.filter((row) => newIds.has(row.sale_id));
    unit.substitutions = snapshot.substitutions.filter((row) =>
      newIds.has(row.substitution_sale_id),
    );
    const deviceIds = new Set([record.device_id, ...unit.sales.map((row) => row.device_id)]);
    unit.devices = snapshot.devices.filter((row) => deviceIds.has(row.id));
    unit.heads = snapshot.heads;
    unit.deliveries = snapshot.deliveries.filter((row) => row.registro_id === record.id);
    if (!returnBatchFits(unit))
      throw new AppError("fiscal.return_invalid", {
        reason: "sale/payment unit exceeds batch bounds",
      });
    const merged = empty();
    for (const key of Object.keys(merged) as (keyof ReturnedOriginals)[]) {
      if (key === "inventory") continue;
      merged[key] = [
        ...new Map(
          [...current[key], ...unit[key]].map((row) => [
            row.id ?? row.node_id ?? row.registro_id,
            row,
          ]),
        ).values(),
      ];
    }
    if (!returnBatchFits(merged)) {
      batches.push(current);
      current = unit;
    } else current = merged;
    for (const id of newIds) sent.add(id);
  }
  if (current.records.length || batches.length === 0) batches.push(current);
  return batches;
}

function returnBatchFits(batch: ReturnedOriginals) {
  return (
    Object.values(batch).reduce(
      (count, rows) => count + (Array.isArray(rows) ? rows.length : 0),
      0,
    ) <= 100 && Buffer.byteLength(JSON.stringify(batch)) <= 256 * 1024
  );
}

export function readReturnedBatch(raw: CanonicalValue): ReturnedOriginals {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AppError("fiscal.return_invalid", { reason: "malformed batch" });
  const data = raw as Record<string, CanonicalValue>;
  const keys = [
    "records",
    "sales",
    "devices",
    "heads",
    "deliveries",
    "tenders",
    "settlements",
    "voids",
    "substitutions",
  ];
  if (
    typeof data.inventory !== "string" ||
    Object.keys(data).some((key) => key !== "inventory" && !keys.includes(key)) ||
    keys.some((key) => {
      const rows = data[key];
      return (
        !Array.isArray(rows) ||
        rows.some(
          (row) =>
            !row ||
            typeof row !== "object" ||
            Array.isArray(row) ||
            Object.values(row).some(
              (value) => value !== null && typeof value !== "string" && typeof value !== "number",
            ),
        )
      );
    })
  )
    throw new AppError("fiscal.return_invalid", { reason: "malformed batch" });
  return data as unknown as ReturnedOriginals;
}
