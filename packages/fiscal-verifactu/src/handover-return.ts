import { createHash } from "node:crypto";
import type { ReturnDiscrepancy } from "@waitron/module";
import { sql } from "drizzle-orm";
import {
  COVERAGE_REFUSAL,
  POST_SETTLEMENT_REFUSAL,
  refusalOn,
  triggerRaised,
  UNIQUE_VIOLATION,
  type Transaction,
} from "@waitron/db";
import type { BackupQuery } from "@waitron/store";
import { checkFiscalChains } from "./handover-chain-check.js";
import { openFilingCase, openAcceptedWithErrorsCase } from "./filing-cases.js";
import { AppError } from "@waitron/shared";
import { CLOCK_BEHIND_MARGIN_MS } from "./clock-behind.js";
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
  refunds: ReturnRow[];
  captures: ReturnRow[];
  orders: ReturnRow[];
  settlements: ReturnRow[];
  voids: ReturnRow[];
  substitutions: ReturnRow[];
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
  const refunds = tx.all<ReturnRow>(sql`select * from tender_refunds
    where sale_id in ${saleIds} and state <> 'failed' order by id`);
  const captures = tx.all<ReturnRow>(sql`select p.* from payments p where exists (
    select 1 from tender_refunds r where r.sale_id in ${saleIds}
      and r.state = 'pending' and r.provider = p.provider and r.provider_payment_ref = p.payment_ref
  ) order by p.id`);
  const orders = tx.all<ReturnRow>(sql`select * from working_orders where id in (
    select p.working_order_id from payments p join tender_refunds r
      on r.provider = p.provider and r.provider_payment_ref = p.payment_ref
    where r.sale_id in ${saleIds} and r.state = 'pending'
  ) order by id`);
  const records = tx.all<ReturnRow>(sql`
    select * from registros_facturacion where node_id = ${sourceNodeId} order by secuencia`);
  const sales = tx.all<ReturnRow>(sql`select * from sales where id in ${saleIds} order by id`);
  const devices = tx.all<ReturnRow>(sql`select * from devices where id in (
    select device_id from registros_facturacion where node_id = ${sourceNodeId}
    union select device_id from sales where id in ${saleIds}
    union select device_id from tender_refunds where sale_id in ${saleIds} and state <> 'failed'
    union select p.device_id from payments p join tender_refunds r
      on r.provider = p.provider and r.provider_payment_ref = p.payment_ref
      where r.sale_id in ${saleIds} and r.state = 'pending'
    union select o.device_id from working_orders o join payments p on p.working_order_id = o.id
      join tender_refunds r on r.provider = p.provider and r.provider_payment_ref = p.payment_ref
      where r.sale_id in ${saleIds} and r.state = 'pending'
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
  return {
    records,
    sales,
    devices,
    heads,
    deliveries,
    tenders,
    refunds,
    captures,
    orders,
    settlements,
    voids,
    substitutions,
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

export async function inspectReturnedPayments(
  tx: Transaction,
  sourceNodeId: string,
  returned: ReturnedOriginals,
): Promise<ReturnDiscrepancy[]> {
  const matches = (table: string, row: ReturnRow) => {
    const ownRow = held(tx, table, row.id);
    const pending = table === "tender_refunds" && row.state === "pending";
    return (
      ownRow !== undefined &&
      canonicalize(normalized(table, ownRow, pending)) ===
        canonicalize(normalized(table, row, pending))
    );
  };
  const outstanding = (
    [
      ["registros_facturacion", returned.records],
      ["sales", returned.sales],
      ["tenders", returned.tenders],
      ["tender_refunds", returned.refunds],
      ["payments", returned.captures],
      ["sale_settlements", returned.settlements],
      ["sale_voids", returned.voids],
      ["sale_substitutions", returned.substitutions],
    ] as const
  ).flatMap(([table, rows]) =>
    rows.filter((row) => !matches(table, row)).map((row) => ({ table, id: row.id! })),
  );
  const discrepancies: ReturnDiscrepancy[] = [];
  for (const sale of returned.sales) {
    const forSale = (rows: ReturnRow[]) =>
      rows
        .filter((row) => row.sale_id === sale.id)
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    const incoming = {
      tenders: forSale(returned.tenders).map((row) => normalized("tenders", row)),
      settlements: forSale(returned.settlements),
      refunds: forSale(returned.refunds),
    };
    const own = {
      tenders: tx
        .all<ReturnRow>(sql`select * from tenders where sale_id = ${sale.id} order by id`)
        .map((row) => normalized("tenders", row)),
      settlements: tx.all<ReturnRow>(
        sql`select * from sale_settlements where sale_id = ${sale.id} order by id`,
      ),
      refunds: tx.all<ReturnRow>(
        sql`select * from tender_refunds where sale_id = ${sale.id} order by id`,
      ),
    };
    const records = forSale(returned.records);
    const originalsMatch =
      matches("sales", sale) &&
      records.length > 0 &&
      records.every((row) => matches("registros_facturacion", row));
    if (canonicalize(incoming) === canonicalize(own)) continue;
    const original = { sale: normalized("sales", sale), records };
    const eligible =
      originalsMatch &&
      records.every(
        (row) => row.node_id === sourceNodeId && matches("registros_facturacion", row),
      ) &&
      !forSale(returned.captures).length &&
      !returned.orders.some((row) => row.id === sale.working_order_id) &&
      incoming.refunds.every((row) => row.state === "completed") &&
      own.refunds.every((row) => row.state === "completed");
    discrepancies.push({
      saleId: String(sale.id),
      eligible,
      outstanding,
      original,
      incoming,
      held: own,
      fingerprint: createHash("sha256")
        .update(canonicalize({ original, incoming, held: own }))
        .digest("hex"),
    });
  }
  return discrepancies;
}

export async function receiveReturnedOriginals(
  tx: Transaction,
  sourceNodeId: string,
  returned: ReturnedOriginals,
  now: Date,
  accepted: readonly string[] = [],
): Promise<{ complete: boolean }> {
  if (!returnBatchFits(returned))
    throw new AppError("fiscal.return_invalid", { reason: "batch exceeds bounds" });
  if (
    returned.refunds.some((row) => row.state !== "completed" && row.state !== "pending") ||
    returned.orders.some((row) => row.status !== "settled")
  )
    throw new AppError("fiscal.return_invalid", { reason: "invalid refund or order state" });
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
    const recordAt = String(record.fecha_hora_huso_gen_registro);
    if (Date.parse(recordAt) > now.getTime() + CLOCK_BEHIND_MARGIN_MS)
      throw new AppError("fiscal.return_clock_ahead", { recordAt, clockAt: now.toISOString() });
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
      (${record.corrects_registro_id} is not null and corrects_registro_id = ${record.corrects_registro_id}) or
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
    const [profile] = tx.all<ReturnRow>(sql`select id from device_profiles order by id limit 1`);
    await insertRow(tx, "devices", {
      id: device.id!,
      label: device.label!,
      device_profile_id: profile!.id!,
      token_hash: "",
      active: 0,
      deleted_at: now.toISOString(),
      enrolled_at: now.toISOString(),
      created_at: now.toISOString(),
    });
  }
  const acceptedSales = new Set(
    (accepted.length ? await inspectReturnedPayments(tx, sourceNodeId, returned) : [])
      .filter((clash) => clash.eligible && accepted.includes(clash.fingerprint))
      .map((clash) => clash.saleId),
  );
  let missing = false;
  for (const sale of orderedSales(returned.sales.filter((row) => needed.has(row.id)))) {
    if (!held(tx, "sales", sale.id))
      await insertRow(tx, "sales", { ...sale, working_order_id: null });
    if (acceptedSales.has(String(sale.id))) continue;
    const incomingRefunds = returned.refunds.filter((row) => row.sale_id === sale.id);
    let refundClash = false;
    for (const tenderId of new Set(incomingRefunds.map((row) => row.tender_id))) {
      const tender =
        held(tx, "tenders", tenderId) ?? returned.tenders.find((row) => row.id === tenderId)!;
      const refunds = new Map(
        [
          ...tx.all<ReturnRow>(
            sql`select * from tender_refunds where tender_id = ${tenderId} and state <> 'failed'`,
          ),
          ...incomingRefunds.filter((row) => row.tender_id === tenderId),
        ].map((row) => [row.id, row]),
      );
      const total = (key: "applied_amount" | "tip_amount") =>
        [...refunds.values()].reduce((sum, row) => sum + BigInt(row[key]!), 0n);
      if (
        total("applied_amount") > BigInt(tender.amount!) - BigInt(tender.tip_amount!) ||
        total("tip_amount") > BigInt(tender.tip_amount!)
      )
        refundClash = true;
    }
    if (refundClash) {
      missing = true;
      continue;
    }
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
        for (const capture of returned.captures.filter((row) => row.sale_id === sale.id)) {
          const order = returned.orders.find((row) => row.id === capture.working_order_id)!;
          if (!held(paymentTx, "working_orders", capture.working_order_id))
            await insertRow(paymentTx, "working_orders", order);
          if (!held(paymentTx, "payments", capture.id))
            await insertRow(paymentTx, "payments", {
              ...capture,
              reader_id: held(paymentTx, "card_readers", capture.reader_id)
                ? capture.reader_id!
                : null,
              bill_payment_id: held(paymentTx, "bill_payments", capture.bill_payment_id)
                ? capture.bill_payment_id!
                : null,
            });
        }
        for (const refund of returned.refunds.filter((row) => row.sale_id === sale.id)) {
          if (!held(paymentTx, "tender_refunds", refund.id))
            await insertRow(paymentTx, "tender_refunds", refund);
        }
      });
    } catch (error) {
      if (
        !refusalOn(error, UNIQUE_VIOLATION, { table: "tenders", columns: ["bill_payment_id"] }) &&
        !refusalOn(error, UNIQUE_VIOLATION, { table: "sale_settlements", columns: ["sale_id"] }) &&
        !refusalOn(error, UNIQUE_VIOLATION, {
          table: "tender_refunds",
          columns: ["sale_id", "submission_id"],
        }) &&
        !triggerRaised(error, COVERAGE_REFUSAL) &&
        !triggerRaised(error, POST_SETTLEMENT_REFUSAL)
      )
        throw error;
      missing = true;
    }
  }
  let inserted = false;
  for (const record of allowed) {
    if (held(tx, "registros_facturacion", record.id)) continue;
    await insertRow(tx, "registros_facturacion", record);
    inserted = true;
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
    if (delivery?.estado === "retenido")
      await openFilingCase(tx, {
        registroId: String(record.id),
        cause: "fiscal.anulacion_retenida",
        evidence: { codigo: null, mensaje: null, csv: null },
        now,
      });
  }
  for (const [table, rows] of [
    ["sale_voids", returned.voids],
    ["sale_substitutions", returned.substitutions],
  ] as const) {
    for (const row of rows) {
      if (!needed.has(table === "sale_voids" ? row.sale_id : row.substitution_sale_id)) continue;
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
  if (inserted && (await checkFiscalChains(transactionQuery(tx))) !== "ok")
    throw new AppError("fiscal.return_invalid", { reason: "chain verification failed" });
  for (const [table, rows] of [
    ["registros_facturacion", returned.records],
    ["sales", returned.sales],
    ["tenders", returned.tenders],
    ["tender_refunds", returned.refunds],
    ["payments", returned.captures],
    ["sale_settlements", returned.settlements],
    ["sale_voids", returned.voids],
    ["sale_substitutions", returned.substitutions],
  ] as const) {
    for (const row of rows) {
      if (
        ["tenders", "tender_refunds", "sale_settlements"].includes(table) &&
        acceptedSales.has(String(row.sale_id))
      )
        continue;
      const own = held(tx, table, row.id);
      if (!own) {
        missing = true;
        continue;
      }
      const pendingRefund = table === "tender_refunds" && row.state === "pending";
      if (
        canonicalize(normalized(table, own, pendingRefund)) ===
        canonicalize(normalized(table, row, pendingRefund))
      )
        continue;
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

function normalized(table: string, row: ReturnRow, pendingRefund = false): ReturnRow {
  if (pendingRefund) {
    // Recovery may advance the receiver's outcome before a lost return answer is retried.
    const progress = [
      "state",
      "completed_at",
      "failed_at",
      "last_lookup_at",
      "next_retry_at",
      "provider_refund_ref",
      "provider_status",
      "attested_by",
      "attestation_note",
    ];
    return Object.fromEntries(Object.entries(row).filter(([key]) => !progress.includes(key)));
  }
  if (table === "sales") return { ...row, working_order_id: null };
  if (table === "tenders") return { ...row, bill_payment_id: null };
  if (table === "payments")
    return {
      ...row,
      bill_payment_id: null,
      reader_id: null,
      updated_at: null,
      state: ["captured", "partially_refunded", "refunded"].includes(String(row.state))
        ? "captured"
        : row.state!,
    };
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
    refunds: [],
    captures: [],
    orders: [],
    settlements: [],
    voids: [],
    substitutions: [],
  });
  const sales = new Map(snapshot.sales.map((row) => [row.id, row]));
  const devices = new Map(snapshot.devices.map((row) => [row.id, row]));
  function indexed(rows: ReturnRow[], key: string) {
    const groups = new Map<ReturnRow[string], ReturnRow[]>();
    for (const row of rows) {
      const group = groups.get(row[key]) ?? [];
      group.push(row);
      groups.set(row[key], group);
    }
    return groups;
  }
  const tenders = indexed(snapshot.tenders, "sale_id");
  const refunds = indexed(snapshot.refunds, "sale_id");
  const settlements = indexed(snapshot.settlements, "sale_id");
  const voids = indexed(snapshot.voids, "sale_id");
  const substitutions = indexed(snapshot.substitutions, "substitution_sale_id");
  const deliveries = indexed(snapshot.deliveries, "registro_id");
  const batches: ReturnedOriginals[] = [];
  const sent = new Set<ReturnRow[string]>();
  let current = empty();
  for (const record of snapshot.records) {
    const ids = new Set([record.sale_id]);
    for (const id of ids) {
      const sale = sales.get(id);
      if (sale?.corrects_sale_id) ids.add(sale.corrects_sale_id);
      for (const substitution of substitutions.get(id) ?? [])
        ids.add(substitution.substituted_sale_id);
    }
    const unit = empty();
    unit.records = [record];
    unit.sales = [...ids]
      .filter((id) => !sent.has(id) && sales.has(id))
      .map((id) => sales.get(id)!);
    const newIds = new Set(unit.sales.map((row) => row.id));
    unit.tenders = [...newIds].flatMap((id) => tenders.get(id) ?? []);
    unit.refunds = [...newIds].flatMap((id) => refunds.get(id) ?? []);
    unit.captures = snapshot.captures.filter((row) => newIds.has(row.sale_id));
    unit.orders = snapshot.orders.filter((row) =>
      unit.captures.some((capture) => capture.working_order_id === row.id),
    );
    unit.settlements = [...newIds].flatMap((id) => settlements.get(id) ?? []);
    unit.voids = [...newIds].flatMap((id) => voids.get(id) ?? []);
    unit.substitutions = [...newIds].flatMap((id) => substitutions.get(id) ?? []);
    const deviceIds = new Set([
      record.device_id,
      ...unit.sales.map((row) => row.device_id),
      ...unit.refunds.map((row) => row.device_id),
      ...unit.captures.map((row) => row.device_id),
      ...unit.orders.map((row) => row.device_id),
    ]);
    unit.devices = [...deviceIds].filter((id) => devices.has(id)).map((id) => devices.get(id)!);
    unit.heads = snapshot.heads;
    unit.deliveries = deliveries.get(record.id) ?? [];
    if (!returnBatchFits(unit))
      throw new AppError("fiscal.return_invalid", {
        reason: "sale/payment unit exceeds batch bounds",
      });
    const merged = empty();
    for (const key of Object.keys(merged) as (keyof ReturnedOriginals)[]) {
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
    "refunds",
    "captures",
    "orders",
    "settlements",
    "voids",
    "substitutions",
  ];
  if (
    Object.keys(data).some((key) => !keys.includes(key)) ||
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
