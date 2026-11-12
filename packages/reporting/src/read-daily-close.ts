import { and, eq, inArray } from "drizzle-orm";
import { dailyCloses, type Transaction } from "@waitron/db";
import { addDecimal, compareDecimal } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import type { DailyCloseSnapshot } from "./close-types.js";
import { computeDailyClose } from "./daily-close.js";
import type { DailyClose, DailyCloseInput, TenderMethodLine } from "./types.js";

export async function readDailyClose(
  tx: Transaction,
  input: DailyCloseInput & { nodeIds: readonly NodeId[] },
): Promise<DailyClose> {
  const saved = await tx
    .select({ nodeId: dailyCloses.nodeId, snapshot: dailyCloses.snapshot })
    .from(dailyCloses)
    .where(
      and(
        eq(dailyCloses.businessDay, input.businessDay),
        inArray(dailyCloses.nodeId, [...input.nodeIds]),
      ),
    )
    .orderBy(dailyCloses.nodeId);
  const frozenIds = new Set(saved.map((row) => row.nodeId));
  const live = input.nodeIds.filter((id) => !frozenIds.has(id));
  const closes = saved.map((row) => (row.snapshot as DailyCloseSnapshot).close);
  if (live.length > 0 || closes.length === 0)
    closes.push(await computeDailyClose(tx, { ...input, nodeIds: live }));
  const result = structuredClone(closes[0]!);
  result.nodeId = input.nodeIds[0];
  for (const close of closes.slice(1)) mergeClose(result, close);
  result.vat.byRate.sort((a, b) => compareDecimal(a.rate, b.rate));
  result.cash.byOrigin.sort((a, b) =>
    compareKey(JSON.stringify([a.source, a.deviceId]), JSON.stringify([b.source, b.deviceId])),
  );
  for (const row of result.cash.byOrigin)
    row.byMethod.sort((a, b) => compareKey(a.method, b.method));
  result.departmentTakings.sort((a, b) => compareKey(a.departmentId ?? "", b.departmentId ?? ""));
  for (const row of result.departmentTakings)
    row.byMethod.sort((a, b) => compareKey(a.method, b.method));
  return result;
}

function compareKey(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

function mergeMethods(target: TenderMethodLine[], source: TenderMethodLine[]): void {
  for (const line of source) {
    const existing = target.find((row) => row.method === line.method);
    if (existing === undefined) target.push({ ...line });
    else {
      existing.amount = addDecimal(existing.amount, line.amount);
      existing.tip = addDecimal(existing.tip, line.tip);
    }
  }
}

function mergeClose(target: DailyClose, source: DailyClose): void {
  for (const field of ["baseTotal", "taxTotal", "grossTotal"] as const)
    target.vat[field] = addDecimal(target.vat[field], source.vat[field]);
  for (const row of source.vat.byRate) {
    const existing = target.vat.byRate.find((r) => r.rate === row.rate);
    if (existing === undefined) target.vat.byRate.push({ ...row });
    else {
      existing.base = addDecimal(existing.base, row.base);
      existing.tax = addDecimal(existing.tax, row.tax);
    }
  }
  target.cash.tenderTotal = addDecimal(target.cash.tenderTotal, source.cash.tenderTotal);
  target.cash.tipTotal = addDecimal(target.cash.tipTotal, source.cash.tipTotal);
  for (const row of source.cash.byOrigin) {
    const existing = target.cash.byOrigin.find(
      (r) => r.source === row.source && r.deviceId === row.deviceId,
    );
    if (existing === undefined) target.cash.byOrigin.push(structuredClone(row));
    else {
      mergeMethods(existing.byMethod, row.byMethod);
      existing.cashTakings = addDecimal(existing.cashTakings, row.cashTakings);
    }
  }
  for (const field of ["sales", "corrections", "voids"] as const)
    target.counts[field] += source.counts[field];
  for (const row of source.departmentTakings) {
    const existing = target.departmentTakings.find((r) => r.departmentId === row.departmentId);
    if (existing === undefined) target.departmentTakings.push(structuredClone(row));
    else {
      mergeMethods(existing.byMethod, row.byMethod);
      existing.billsClosed.count += row.billsClosed.count;
      existing.billsClosed.total = addDecimal(existing.billsClosed.total, row.billsClosed.total);
    }
  }
}
