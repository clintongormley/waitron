import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import {
  refunds as refundRows,
  billPayments,
  drawerEntries,
  drawerOpens,
  invoiceSeries,
  receiptReprints,
  sales,
  saleVoids,
  type Database,
} from "@waitron/db";
import { jsonFile, type PersonalDataFile, type PersonalDataPart } from "@waitron/module";
import { centsToDecimal } from "@waitron/shared";

// The actions part reads in its own short withWriteLock turns after the snapshot. Each
// turn leaves change delivery alone so a download can still run on a full disk.

export const ACTIONS_FILES = ["actions.json"] as const;
export const SALE_LOOKUP_CHUNK = 500;

type Role = "requested" | "authorized" | "attested";

interface SaleFacts {
  number: string;
  total: number;
}

interface BillPaymentFacts {
  method: "cash" | "card";
  sale: string | null;
}

async function saleFacts(
  db: Database,
  saleIds: readonly string[],
  chunk: number,
): Promise<Map<string, SaleFacts>> {
  const facts = new Map<string, SaleFacts>();
  for (let start = 0; start < saleIds.length; start += chunk) {
    const ids = saleIds.slice(start, start + chunk);
    const rows = await db.withWriteLock(() =>
      db
        .select({
          id: sales.id,
          code: invoiceSeries.code,
          number: sales.invoiceNumber,
          total: sales.total,
        })
        .from(sales)
        .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(inArray(sales.id, ids)),
    );
    for (const row of rows)
      facts.set(row.id, { number: formatInvoiceNumber(row.code, row.number), total: row.total });
  }
  return facts;
}

async function billPaymentFacts(
  db: Database,
  billPaymentIds: readonly string[],
  chunk: number,
): Promise<Map<string, BillPaymentFacts>> {
  const facts = new Map<string, BillPaymentFacts>();
  for (let start = 0; start < billPaymentIds.length; start += chunk) {
    const ids = billPaymentIds.slice(start, start + chunk);
    const rows = await db.withWriteLock(() =>
      db
        .select({
          id: billPayments.id,
          method: billPayments.method,
          code: invoiceSeries.code,
          number: sales.invoiceNumber,
        })
        .from(billPayments)
        .leftJoin(sales, eq(sales.workingOrderId, billPayments.workingOrderId))
        .leftJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(inArray(billPayments.id, ids)),
    );
    for (const row of rows)
      facts.set(row.id, {
        method: row.method,
        sale:
          row.code === null || row.number === null
            ? null
            : formatInvoiceNumber(row.code, row.number),
      });
  }
  return facts;
}

function byTimeThenId(a: { at: string; id: string }, b: { at: string; id: string }): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export function actionsPersonalData(
  db: Database,
  options: { chunk?: number } = {},
): PersonalDataPart[] {
  const chunk = options.chunk ?? SALE_LOOKUP_CHUNK;
  if (!Number.isInteger(chunk) || chunk < 1)
    throw new Error(`personal-data actions chunk must be a positive whole number, not ${chunk}`);
  return [
    {
      owner: "server",
      part: {
        files: ACTIONS_FILES,
        async prepare(_tx, subject) {
          const person = subject.personId;
          return async (): Promise<PersonalDataFile[]> => {
            const rows = await db.withWriteLock(async () => {
              const voids = await db
                .select({ id: saleVoids.id, saleId: saleVoids.saleId, at: saleVoids.voidedAt })
                .from(saleVoids)
                .where(eq(saleVoids.voidedBy, person))
                .orderBy(asc(saleVoids.voidedAt), asc(saleVoids.id));
              const refunds = await db
                .select({
                  id: refundRows.id,
                  saleId: refundRows.saleId,
                  amount: refundRows.appliedAmount,
                  tip: refundRows.tipAmount,
                  method: refundRows.method,
                  state: refundRows.state,
                  at: refundRows.createdAt,
                  requestedBy: refundRows.requestedBy,
                  authorizedBy: refundRows.authorizedBy,
                  attestedBy: refundRows.attestedBy,
                })
                .from(refundRows)
                .where(
                  and(
                    isNotNull(refundRows.saleId),
                    or(
                      eq(refundRows.requestedBy, person),
                      eq(refundRows.authorizedBy, person),
                      eq(refundRows.attestedBy, person),
                    ),
                  ),
                )
                .orderBy(asc(refundRows.createdAt), asc(refundRows.id));
              const billRefunds = await db
                .select({
                  id: refundRows.id,
                  billPaymentId: refundRows.billPaymentId,
                  amount: refundRows.appliedAmount,
                  tip: refundRows.tipAmount,
                  state: refundRows.state,
                  at: refundRows.createdAt,
                  requestedBy: refundRows.requestedBy,
                  authorizedBy: refundRows.authorizedBy,
                  attestedBy: refundRows.attestedBy,
                })
                .from(refundRows)
                .where(
                  and(
                    isNotNull(refundRows.billPaymentId),
                    or(
                      eq(refundRows.requestedBy, person),
                      eq(refundRows.authorizedBy, person),
                      eq(refundRows.attestedBy, person),
                    ),
                  ),
                );
              return { voids, refunds, billRefunds };
            });
            const openings = await db.withWriteLock(() =>
              db
                .select({
                  id: drawerOpens.id,
                  reason: drawerOpens.reason,
                  at: drawerOpens.openedAt,
                  saleId: drawerOpens.saleId,
                  billPaymentId: drawerOpens.billPaymentId,
                  viaOverride: drawerOpens.viaOverride,
                  personId: drawerOpens.personId,
                  authorizedBy: drawerOpens.authorizedBy,
                })
                .from(drawerOpens)
                .where(or(eq(drawerOpens.personId, person), eq(drawerOpens.authorizedBy, person)))
                .orderBy(asc(drawerOpens.openedAt), asc(drawerOpens.id)),
            );
            // Payment and refund entries duplicate actors already covered by the bill and refund reads.
            const entries = await db.withWriteLock(() =>
              db
                .select({
                  kind: drawerEntries.kind,
                  at: drawerEntries.recordedAt,
                  amount: drawerEntries.amount,
                })
                .from(drawerEntries)
                .where(
                  and(
                    eq(drawerEntries.personId, person),
                    inArray(drawerEntries.kind, [
                      "cash_in",
                      "cash_out",
                      "count",
                      "recount",
                      "finish",
                    ]),
                  ),
                )
                .orderBy(asc(drawerEntries.recordedAt), asc(drawerEntries.id)),
            );
            const payments = await db.withWriteLock(() =>
              db
                .select({
                  id: billPayments.id,
                  method: billPayments.method,
                  amount: billPayments.applied,
                  tip: billPayments.tip,
                  state: billPayments.state,
                  at: billPayments.createdAt,
                  requestedBy: billPayments.requestedBy,
                  attestedBy: billPayments.attestedBy,
                  receivedAt: billPayments.receivedAt,
                  failedAt: billPayments.failedAt,
                })
                .from(billPayments)
                .where(
                  or(eq(billPayments.requestedBy, person), eq(billPayments.attestedBy, person)),
                )
                .orderBy(asc(billPayments.createdAt), asc(billPayments.id)),
            );
            const reprints = await db.withWriteLock(() =>
              db
                .select({ saleId: receiptReprints.saleId, at: receiptReprints.requestedAt })
                .from(receiptReprints)
                .where(eq(receiptReprints.personId, person))
                .orderBy(asc(receiptReprints.requestedAt), asc(receiptReprints.id)),
            );
            if (
              rows.voids.length === 0 &&
              rows.refunds.length === 0 &&
              rows.billRefunds.length === 0 &&
              openings.length === 0 &&
              entries.length === 0 &&
              payments.length === 0 &&
              reprints.length === 0
            )
              return [];
            const saleIds = [
              ...new Set(
                [...rows.voids, ...rows.refunds, ...openings, ...reprints].flatMap((row) =>
                  row.saleId === null ? [] : [row.saleId],
                ),
              ),
            ];
            const facts = await saleFacts(db, saleIds, chunk);
            const billPaymentIds = [
              ...new Set([
                ...payments.map((row) => row.id),
                ...[...rows.billRefunds, ...openings].flatMap((row) =>
                  row.billPaymentId === null ? [] : [row.billPaymentId],
                ),
              ]),
            ];
            const bills = await billPaymentFacts(db, billPaymentIds, chunk);
            // Every `sale_id` and `bill_payment_id` read has a foreign key restricting its target's
            // deletion.
            const sale = (saleId: string) => facts.get(saleId)!;
            const bill = (billPaymentId: string) => bills.get(billPaymentId)!;
            const rolesOf = (row: {
              requestedBy: string;
              authorizedBy: string;
              attestedBy: string | null;
            }): Role[] => {
              const yourPart: Role[] = [];
              if (row.requestedBy === person) yourPart.push("requested");
              if (row.authorizedBy === person) yourPart.push("authorized");
              if (row.attestedBy === person) yourPart.push("attested");
              return yourPart;
            };
            const voids = rows.voids.map((row) => ({
              sale: sale(row.saleId).number,
              amount: centsToDecimal(sale(row.saleId).total),
              at: row.at,
            }));
            const refunds = [
              ...rows.refunds.map((row) => ({
                id: row.id,
                at: row.at,
                entry: {
                  kind: "sale",
                  sale: sale(row.saleId!).number,
                  amount: centsToDecimal(row.amount),
                  tip: centsToDecimal(row.tip),
                  method: row.method,
                  state: row.state,
                  at: row.at,
                  yourPart: rolesOf(row),
                },
              })),
              ...rows.billRefunds.map((row) => ({
                id: row.id,
                at: row.at,
                entry: {
                  kind: "bill_payment",
                  sale: bill(row.billPaymentId!).sale,
                  amount: centsToDecimal(row.amount),
                  tip: centsToDecimal(row.tip),
                  method: bill(row.billPaymentId!).method,
                  state: row.state,
                  at: row.at,
                  yourPart: rolesOf(row),
                },
              })),
            ]
              .sort(byTimeThenId)
              .map((row) => row.entry);
            const drawerOpenings = openings.map((row) => {
              const yourPart: ("opened" | "authorized")[] = [];
              if (row.personId === person) yourPart.push("opened");
              if (row.authorizedBy === person) yourPart.push("authorized");
              return {
                reason: row.reason,
                sale:
                  row.saleId !== null
                    ? sale(row.saleId).number
                    : row.billPaymentId !== null
                      ? bill(row.billPaymentId).sale
                      : null,
                at: row.at.toISOString(),
                viaOverride: row.viaOverride,
                yourPart,
              };
            });
            const drawerMoves = entries.map(({ kind, at, amount }) => ({
              kind,
              at,
              amount: centsToDecimal(amount),
            }));
            const billsPaid = payments.map((row) => {
              const yourPart: Role[] = [];
              if (row.requestedBy === person) yourPart.push("requested");
              if (row.attestedBy === person) yourPart.push("attested");
              return {
                sale: bill(row.id).sale,
                method: row.method,
                amount: centsToDecimal(row.amount),
                tip: centsToDecimal(row.tip),
                state: row.state,
                at: row.at,
                yourPart,
                // A declined receipt preserves when it was originally confirmed.
                attestedAt: row.attestedBy === person ? (row.receivedAt ?? row.failedAt) : null,
              };
            });
            const receiptCopies = reprints.map((row) => ({
              sale: sale(row.saleId).number,
              at: row.at,
            }));
            return [
              jsonFile("actions.json", {
                counts: {
                  voids: voids.length,
                  refunds: refunds.length,
                  drawerOpenings: drawerOpenings.length,
                  drawerEntries: drawerMoves.length,
                  billPayments: billsPaid.length,
                  receiptReprints: receiptCopies.length,
                },
                voids,
                refunds,
                drawerOpenings,
                drawerEntries: drawerMoves,
                billPayments: billsPaid,
                receiptReprints: receiptCopies,
              }),
            ];
          };
        },
      },
    },
  ];
}
