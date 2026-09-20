import { randomUUID } from "node:crypto";
import { freshNif } from "../testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
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

/**
 * The generic-layer substitution link (`sale_substitutions`) and the recipient
 * columns on `sales` (`counterparty_*`). docs/superpowers/plans/2026-08-02-f3-canje.md §2.1.
 */

let LOCATION_A = randomUUID();
let TILL_A1 = randomUUID();
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
// sales.node_id is NOT NULL since the node-id rekey (2026-08-03); insertSale writes the sale's node,
// which the (node_id) → nodes FK requires.
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

// Raw insert of a sale HEADER — deliberately raw `sql`, not the drizzle `sales` object, so the RED
// phase of the counterparty-column tests fails on the real cause ("column counterparty_tax_id does
// not exist", i.e. the migration is absent) rather than on a TypeScript compile error.
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
  // node_id is NOT NULL.
  const nodeId = opts.nodeId ?? nodeA;
  const seriesId = opts.seriesId ?? seriesA;
  const locales = opts.invoiceLocales ?? ["es", "ca"];
  const cp = opts.counterparty ?? null;
  invoiceCounter += 1;
  const localesArray = sql`array[${sql.join(
    locales.map((l) => sql`${l}`),
    sql`, `,
  )}]::text[]`;
  const [row] = await rows<{ id: string }>(
    db,
    sql`insert into sales (till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, counterparty_tax_id, counterparty_legal_name, counterparty_country_code) values (${tillId}, ${nodeId}, ${seriesId}, ${invoiceCounter}, ${AT}, 120,
           '1.00', '[]'::jsonb, ${locales[0]}, ${localesArray}, 'verifactu', 'recorded',
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
    sql`insert into sale_substitutions (substitution_sale_id, substituted_sale_id) values (${opts.substitutionSaleId}, ${opts.substitutedSaleId})
         returning id`,
  );
}

describe("sale_substitutions — schema shape", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("creates sale_substitutions as an append-only table", async () => {
    const table = await rows<{ one: number }>(
      db,
      sql`select 1 as one from information_schema.tables where table_name = 'sale_substitutions'`,
    );
    expect(table).toHaveLength(1);

    const guards = await rows<{ tgname: string }>(
      db,
      sql`select tgname from pg_trigger
            where tgrelid = 'sale_substitutions'::regclass
              and tgname in ('sale_substitutions_enforce_immutability',
                             'sale_substitutions_block_truncate')
            order by tgname`,
    );
    expect(guards.map((g) => g.tgname)).toEqual([
      "sale_substitutions_block_truncate",
      "sale_substitutions_enforce_immutability",
    ]);
  });

  it("adds the three nullable counterparty columns to sales", async () => {
    const cols = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
      db,
      sql`select column_name, data_type, is_nullable from information_schema.columns
            where table_name = 'sales'
              and column_name in ('counterparty_tax_id', 'counterparty_legal_name',
                                  'counterparty_country_code')
            order by column_name`,
    );
    expect(cols).toEqual([
      { column_name: "counterparty_country_code", data_type: "text", is_nullable: "YES" },
      { column_name: "counterparty_legal_name", data_type: "text", is_nullable: "YES" },
      { column_name: "counterparty_tax_id", data_type: "text", is_nullable: "YES" },
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
      sql`select count(*)::int as n from sale_substitutions
            where substitution_sale_id = ${f3SaleId}::uuid`,
    );
    expect(linked[0].n).toBe(2);
  });

  it("refuses to substitute the same ticket twice (unique substituted_sale_id)", async () => {
    // The DB control for "a ticket is substituted at most once" (plan §2.1, decision 4). A second
    // F3 (or the same one) naming an already-substituted ticket violates the unique index.
    const secondF3 = await insertSale(db, {
      counterparty: { taxId: "B88888888", legalName: "Beacon Corp SL", countryCode: "ES" },
    });
    await insertSubstitution(db, { substitutionSaleId: f3SaleId, substitutedSaleId: ticket1 });
    const error = await captureError(() =>
      insertSubstitution(db, { substitutionSaleId: secondF3, substitutedSaleId: ticket1 }),
    );
    expect(pgErrorCode(error)).toBe("23505");
    expect(pgErrorMessage(error)).toMatch(/sale_substitutions_substituted_key/);
  });

  it("rejects a link to a ticket that does not exist", async () => {
    const error = await captureError(() =>
      insertSubstitution(db, {
        substitutionSaleId: f3SaleId,
        substitutedSaleId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("rejects a link whose substitution sale does not exist", async () => {
    const error = await captureError(() =>
      insertSubstitution(db, {
        substitutionSaleId: "99999999-9999-4999-8999-999999999999",
        substitutedSaleId: ticket1,
      }),
    );
    expect(pgErrorCode(error)).toBe("23503");
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
    // The grants stop the application; the trigger stops the owner. Asserted on SQLSTATE WT001
    // (the shared reject_mutation()), not on wording. PROVEN BY DELETION (manual, recorded in this
    // task's report): with the sale_substitutions_enforce_immutability trigger removed from 0014,
    // this owner UPDATE succeeds.
    const update = await captureError(() =>
      db.execute(sql`update sale_substitutions set substituted_sale_id = substitution_sale_id`),
    );
    expect(pgErrorCode(update)).toBe("WT001");
    expect(pgErrorMessage(update)).toMatch(
      /sale_substitutions is append-only: UPDATE is not permitted/,
    );

    const remove = await captureError(() =>
      db.execute(sql`delete from sale_substitutions where id = ${linkId}`),
    );
    expect(pgErrorCode(remove)).toBe("WT001");
  });

  it("stops the owner truncating the table, via the statement trigger", async () => {
    // A row trigger does not fire on TRUNCATE. Nothing references sale_substitutions by a foreign
    // key, so a bare TRUNCATE reaches the BEFORE TRUNCATE statement trigger directly.
    const error = await captureError(() => db.execute(sql`truncate table sale_substitutions`));
    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(
      /sale_substitutions is append-only: TRUNCATE is not permitted/,
    );
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
            from sales where id = ${id}::uuid`,
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
      .where(sql`${sales.id} = ${id}::uuid`);
    expect(row.counterpartyTaxId).toBeNull();
    expect(row.counterpartyLegalName).toBeNull();
    expect(row.counterpartyCountryCode).toBeNull();
  });

  it("refuses to update a recipient column, via the trigger backstop", async () => {
    // The counterparty columns inherit sales' table-wide immutability with no new DDL — the same
    // receipt corrects_sale_id/fiscal_state rely on. Owner path, asserted on WT001.
    const id = await insertSale(db, {
      counterparty: { taxId: "B99999999", legalName: "Acme Corp SL", countryCode: "ES" },
    });
    const error = await captureError(() =>
      db.execute(sql`update sales set counterparty_tax_id = 'B00000001' where id = ${id}::uuid`),
    );
    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(/sales is append-only: UPDATE is not permitted/);
  });
});
