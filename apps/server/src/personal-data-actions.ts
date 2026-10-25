import { asc, eq, inArray, or } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import {
  billPaymentRefunds,
  billPayments,
  drawerOpens,
  invoiceSeries,
  sales,
  saleVoids,
  tenderRefunds,
  type Database,
} from "@waitron/db";
import { jsonFile, type PersonalDataFile, type PersonalDataPart } from "@waitron/module";
import { centsToDecimal } from "@waitron/shared";

// Commented decision, departing from the seat's doc comment (decision 4 of
// docs/superpowers/plans/2026-10-25-a980-s2c-actions-admin-download.md): `prepare` reads nothing,
// and the build reads through the `Database` this part was built with, in short `withWriteLock`
// turns of its own after the snapshot turn has closed: one turn for the person's voids and
// refunds, one for their drawer openings, neither joining another table; then one turn per
// `chunk` sale ids, by primary key; then one turn per `chunk` bill-payment ids, by primary key,
// each finding the sale filed from the payment's order.
// Each is awaited in turn, none inside `withTransaction`, so nothing is written. An action
// committed between the snapshot turn and these turns may appear in the file; it happened before
// the download was sent, and the route's re-check still runs before any bytes go.

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
                  id: tenderRefunds.id,
                  saleId: tenderRefunds.saleId,
                  amount: tenderRefunds.appliedAmount,
                  tip: tenderRefunds.tipAmount,
                  method: tenderRefunds.method,
                  state: tenderRefunds.state,
                  at: tenderRefunds.createdAt,
                  requestedBy: tenderRefunds.requestedBy,
                  authorizedBy: tenderRefunds.authorizedBy,
                  attestedBy: tenderRefunds.attestedBy,
                })
                .from(tenderRefunds)
                .where(
                  or(
                    eq(tenderRefunds.requestedBy, person),
                    eq(tenderRefunds.authorizedBy, person),
                    eq(tenderRefunds.attestedBy, person),
                  ),
                )
                .orderBy(asc(tenderRefunds.createdAt), asc(tenderRefunds.id));
              const billRefunds = await db
                .select({
                  id: billPaymentRefunds.id,
                  billPaymentId: billPaymentRefunds.billPaymentId,
                  amount: billPaymentRefunds.appliedAmount,
                  tip: billPaymentRefunds.tipAmount,
                  state: billPaymentRefunds.state,
                  at: billPaymentRefunds.createdAt,
                  requestedBy: billPaymentRefunds.requestedBy,
                  authorizedBy: billPaymentRefunds.authorizedBy,
                  attestedBy: billPaymentRefunds.attestedBy,
                })
                .from(billPaymentRefunds)
                .where(
                  or(
                    eq(billPaymentRefunds.requestedBy, person),
                    eq(billPaymentRefunds.authorizedBy, person),
                    eq(billPaymentRefunds.attestedBy, person),
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
            if (
              rows.voids.length === 0 &&
              rows.refunds.length === 0 &&
              rows.billRefunds.length === 0 &&
              openings.length === 0
            )
              return [];
            const saleIds = [
              ...new Set(
                [...rows.voids, ...rows.refunds, ...openings].flatMap((row) =>
                  row.saleId === null ? [] : [row.saleId],
                ),
              ),
            ];
            const facts = await saleFacts(db, saleIds, chunk);
            const billPaymentIds = [
              ...new Set(
                [...rows.billRefunds, ...openings].flatMap((row) =>
                  row.billPaymentId === null ? [] : [row.billPaymentId],
                ),
              ),
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
                  sale: sale(row.saleId).number,
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
                  sale: bill(row.billPaymentId).sale,
                  amount: centsToDecimal(row.amount),
                  tip: centsToDecimal(row.tip),
                  method: bill(row.billPaymentId).method,
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
            return [
              jsonFile("actions.json", {
                counts: {
                  voids: voids.length,
                  refunds: refunds.length,
                  drawerOpenings: drawerOpenings.length,
                },
                voids,
                refunds,
                drawerOpenings,
              }),
            ];
          };
        },
      },
    },
  ];
}
