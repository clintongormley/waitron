import { asc, eq, inArray, or } from "drizzle-orm";
import { formatInvoiceNumber } from "@waitron/core";
import { invoiceSeries, sales, saleVoids, tenderRefunds, type Database } from "@waitron/db";
import { jsonFile, type PersonalDataFile, type PersonalDataPart } from "@waitron/module";
import { centsToDecimal } from "@waitron/shared";

// Commented decision, departing from the seat's doc comment (decision 4 of
// docs/superpowers/plans/2026-10-25-a980-s2c-actions-admin-download.md): `prepare` reads nothing,
// and the build reads through the `Database` this part was built with, in short `withWriteLock`
// turns of its own after the snapshot turn has closed. The person's rows and their sale numbers
// measured about 192 ms at 1,000,000 drawer openings, which would push the snapshot turn past its
// 250 ms bar, and an index on the person columns did not remove the cost of joining each row to its
// sale. So: one turn for the person's rows, no join, then one turn per `chunk` sale ids, by primary
// key; each awaited in turn, none inside `withTransaction`, so nothing is written. An action
// committed between the snapshot turn and these turns may appear in the file; it happened before
// the download was sent, and the route's re-check still runs before any bytes go.

export const ACTIONS_FILES = ["actions.json"] as const;
export const SALE_LOOKUP_CHUNK = 500;

type Role = "requested" | "authorized" | "attested";

interface SaleFacts {
  number: string;
  total: number;
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
              return { voids, refunds };
            });
            if (rows.voids.length === 0 && rows.refunds.length === 0) return [];
            const saleIds = [...new Set([...rows.voids, ...rows.refunds].map((row) => row.saleId))];
            const facts = await saleFacts(db, saleIds, chunk);
            // Both tables' `sale_id` is not null and restricts the sale's deletion.
            const sale = (saleId: string) => facts.get(saleId)!;
            const voids = rows.voids.map((row) => ({
              sale: sale(row.saleId).number,
              amount: centsToDecimal(sale(row.saleId).total),
              at: row.at,
            }));
            const refunds = rows.refunds.map((row) => {
              const yourPart: Role[] = [];
              if (row.requestedBy === person) yourPart.push("requested");
              if (row.authorizedBy === person) yourPart.push("authorized");
              if (row.attestedBy === person) yourPart.push("attested");
              return {
                kind: "sale",
                sale: sale(row.saleId).number,
                amount: centsToDecimal(row.amount),
                tip: centsToDecimal(row.tip),
                method: row.method,
                state: row.state,
                at: row.at,
                yourPart,
              };
            });
            return [
              jsonFile("actions.json", {
                counts: { voids: voids.length, refunds: refunds.length, drawerOpenings: 0 },
                voids,
                refunds,
                drawerOpenings: [],
              }),
            ];
          };
        },
      },
    },
  ];
}
