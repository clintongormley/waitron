import { randomUUID } from "node:crypto";
import { freshNif } from "../testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn, triggerRaised } from "../constraint-target.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedNode } from "../testing/seed.js";
import { sales } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

// Append-only links and sales retain their FK parents; each case uses a fresh fixture identity.
beforeEach(() => {
  LOCATION_A = randomUUID();
  TILL_A1 = randomUUID();
});

let LOCATION_A = randomUUID();
let TILL_A1 = randomUUID();
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
let nodeA = "";

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values([{ id: 1, country: "ES", taxId: freshNif(), legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
  nodeA = await seedNode(db, brandLocationId(LOCATION_A));
  const [a] = await db
    .insert(invoiceSeries)
    .values({ nodeId: nodeA, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a.id;
}

let invoiceCounter = 0;
async function insertSale(
  db: Database,
  opts: {
    tillId?: string;
    nodeId?: string;
    seriesId?: string;
    invoiceLocales?: string[];
    counterparty?: { taxId: string; legalName: string; countryCode: string } | null;
  } = {},
): Promise<string> {
  const tillId = opts.tillId ?? TILL_A1;
  const nodeId = opts.nodeId ?? nodeA;
  const seriesId = opts.seriesId ?? seriesA;
  const locales = opts.invoiceLocales ?? ["es", "ca"];
  const cp = opts.counterparty ?? null;
  invoiceCounter += 1;
  const localesJson = JSON.stringify(locales);
  const [row] = await rows<{ id: string }>(
    db,
    // `id` is named explicitly because `sales.id` is `$defaultFn(newId)` — a JavaScript generator
    // rather than a SQL DEFAULT, which a raw insert never reaches.
    sql`insert into sales (id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, counterparty_tax_id, counterparty_legal_name, counterparty_country_code) values (${randomUUID()}, ${tillId}, ${nodeId}, ${seriesId}, ${invoiceCounter}, ${AT}, 120,
           100, '[]', ${locales[0]}, ${localesJson}, 'verifactu', 'recorded',
           ${cp?.taxId ?? null}, ${cp?.legalName ?? null}, ${cp?.countryCode ?? null}
         ) returning id`,
  );
  return row.id;
}

async function insertSubstitution(
  db: Database,
  opts: { substitutionSaleId: string; substitutedSaleId: string },
): Promise<{ id: string }[]> {
  return rows<{ id: string }>(
    db,
    // `id` for the reason {@link insertSale} records: it is a `$defaultFn` generator here.
    sql`insert into sale_substitutions (id, substitution_sale_id, substituted_sale_id) values (${randomUUID()}, ${opts.substitutionSaleId}, ${opts.substitutedSaleId})
         returning id`,
  );
}

describe("sale_substitutions — schema shape", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("creates sale_substitutions as an append-only table", async () => {
    const table = await rows<{ name: string }>(
      db,
      sql`select name from sqlite_master where type = 'table' and name = 'sale_substitutions'`,
    );
    expect(table).toHaveLength(1);

    // Read off the table rather than filtered by a list, so a guard added or renamed shows up
    // here as a changed list instead of passing unnoticed.
    const guards = await rows<{ name: string }>(
      db,
      sql`select name from sqlite_master
            where type = 'trigger' and tbl_name = 'sale_substitutions' order by name`,
    );
    expect(guards.map((g) => g.name)).toEqual([
      "sale_substitutions_append_only_delete",
      "sale_substitutions_append_only_update",
    ]);
  });

  it("adds the three nullable counterparty columns to sales", async () => {
    // `lower(type)`: the pragma reports `TEXT` in upper case where the DDL declares `text`.
    const cols = await rows<{ name: string; type: string; notnull: number }>(
      db,
      sql`select name, lower(type) as type, "notnull" from pragma_table_info('sales')
            where name in ('counterparty_tax_id', 'counterparty_legal_name',
                           'counterparty_country_code')
            order by name`,
    );
    expect(cols).toEqual([
      { name: "counterparty_country_code", type: "text", notnull: 0 },
      { name: "counterparty_legal_name", type: "text", notnull: 0 },
      { name: "counterparty_tax_id", type: "text", notnull: 0 },
    ]);
  });
});

describe("sale_substitutions — the N:1 link", () => {
  let db: Database;
  let f3SaleId = "";
  let ticket1 = "";
  let ticket2 = "";

  beforeEach(async () => {
    db = suite.db;
    invoiceCounter = 0;
    await seed(db);
    ticket1 = await insertSale(db);
    ticket2 = await insertSale(db);
    f3SaleId = await insertSale(db, {
      counterparty: { taxId: "B99999999", legalName: "Acme Corp SL", countryCode: "ES" },
    });
  });

  it("links one F3 substitution sale to a substituted ticket", async () => {
    const inserted = await insertSubstitution(db, {
      substitutionSaleId: f3SaleId,
      substitutedSaleId: ticket1,
    });
    expect(inserted).toHaveLength(1);
  });

  it("lets one F3 substitute many tickets (the N:1 fan-out)", async () => {
    await insertSubstitution(db, { substitutionSaleId: f3SaleId, substitutedSaleId: ticket1 });
    await insertSubstitution(db, { substitutionSaleId: f3SaleId, substitutedSaleId: ticket2 });
    const linked = await rows<{ n: number }>(
      db,
      sql`select count(*) as n from sale_substitutions
            where substitution_sale_id = ${f3SaleId}`,
    );
    expect(linked[0].n).toBe(2);
  });

  it("refuses to substitute the same ticket twice (unique substituted_sale_id)", async () => {
    const secondF3 = await insertSale(db, {
      counterparty: { taxId: "B88888888", legalName: "Beacon Corp SL", countryCode: "ES" },
    });
    await insertSubstitution(db, { substitutionSaleId: f3SaleId, substitutedSaleId: ticket1 });
    const error = await captureError(() =>
      insertSubstitution(db, { substitutionSaleId: secondF3, substitutedSaleId: ticket1 }),
    );
    // The refusal names the table and key column, not the index. The control is the fan-out case
    // above: a second link with a DIFFERENT substituted ticket is accepted.
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "sale_substitutions",
        columns: ["substituted_sale_id"],
      }),
    ).toBe(true);
  });

  it("rejects a link to a ticket that does not exist", async () => {
    const error = await captureError(() =>
      insertSubstitution(db, {
        substitutionSaleId: f3SaleId,
        substitutedSaleId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    // Class only: a foreign-key refusal names no table or column.
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("rejects a link whose substitution sale does not exist", async () => {
    const error = await captureError(() =>
      insertSubstitution(db, {
        substitutionSaleId: "99999999-9999-4999-8999-999999999999",
        substitutedSaleId: ticket1,
      }),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

describe("sale_substitutions — immutability", () => {
  let db: Database;
  let linkId = "";

  beforeEach(async () => {
    db = suite.db;
    invoiceCounter = 0;
    await seed(db);
    const ticket = await insertSale(db);
    const f3 = await insertSale(db, {
      counterparty: { taxId: "B99999999", legalName: "Acme Corp SL", countryCode: "ES" },
    });
    const [row] = await insertSubstitution(db, {
      substitutionSaleId: f3,
      substitutedSaleId: ticket,
    });
    linkId = row.id;
  });

  it("stops the owner too, via the trigger backstop", async () => {
    // `triggerRaised`, not a result code alone: a trigger's RAISE(ABORT) and an `ON DELETE
    // RESTRICT` refusal share a code (`../sql-state.ts`), and this table holds two RESTRICT keys.
    // The refusal text is the same for UPDATE and DELETE, so it does not say which was stopped.
    const update = await captureError(() =>
      db.execute(sql`update sale_substitutions set substituted_sale_id = substitution_sale_id`),
    );
    expect(triggerRaised(update, "sale_substitutions is append-only")).toBe(true);

    const remove = await captureError(() =>
      db.execute(sql`delete from sale_substitutions where id = ${linkId}`),
    );
    expect(triggerRaised(remove, "sale_substitutions is append-only")).toBe(true);
  });
});

describe("sales — counterparty columns", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    invoiceCounter = 0;
    await seed(db);
  });

  it("stores the recipient on an F3 sale and reads it back", async () => {
    const id = await insertSale(db, {
      counterparty: { taxId: "B99999999", legalName: "Acme Corp SL", countryCode: "ES" },
    });
    const [row] = await rows<{
      counterparty_tax_id: string | null;
      counterparty_legal_name: string | null;
      counterparty_country_code: string | null;
    }>(
      db,
      sql`select counterparty_tax_id, counterparty_legal_name, counterparty_country_code
            from sales where id = ${id}`,
    );
    expect(row).toEqual({
      counterparty_tax_id: "B99999999",
      counterparty_legal_name: "Acme Corp SL",
      counterparty_country_code: "ES",
    });
  });

  it("leaves the recipient NULL on an ordinary sale", async () => {
    const id = await insertSale(db);
    const [row] = await db
      .select()
      .from(sales)
      .where(sql`${sales.id} = ${id}`);
    expect(row.counterpartyTaxId).toBeNull();
    expect(row.counterpartyLegalName).toBeNull();
    expect(row.counterpartyCountryCode).toBeNull();
  });

  it("refuses to update a recipient column, via the trigger backstop", async () => {
    // Asserted on the trigger's own text: the result code alone cannot tell this guard from a
    // RESTRICT refusal. The insert below is the control — the table takes a new row and refuses
    // only the rewrite.
    const id = await insertSale(db, {
      counterparty: { taxId: "B99999999", legalName: "Acme Corp SL", countryCode: "ES" },
    });
    const error = await captureError(() =>
      db.execute(sql`update sales set counterparty_tax_id = 'B00000001' where id = ${id}`),
    );
    expect(triggerRaised(error, "sales is append-only")).toBe(true);
  });
});
