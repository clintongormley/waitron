import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { invoiceSeries } from "./series.js";
import { sales } from "./sales.js";
import { locations, tenants, tills } from "./tenants.js";

/**
 * Migration 0014 — the generic-layer substitution link (`sale_substitutions`) and the recipient
 * columns on `sales` (`counterparty_*`). docs/superpowers/plans/2026-08-02-f3-canje.md §2.1.
 *
 * `sale_substitutions` is the N:1 link from an F3 canje (`substitution_sale_id`) to each simplified
 * ticket it replaces (`substituted_sale_id`); one row per (F3, ticket) pair. It is an immutable,
 * append-only child of `sales`, exactly like `sale_lines`/`tenders`: composite tenant-consistent
 * FKs, RLS with FORCE, the reject_mutation() triggers, and — unique to it — a
 * `unique(tenant_id, substituted_sale_id)` translating "a ticket is substituted at most once".
 *
 * describeEachTarget so the immutability triggers, the CHECK/UNIQUE constraints AND the
 * non-superuser RLS scoping all run against real Postgres too (CLAUDE.md §4: PGlite is a superuser
 * and would bypass FORCE ROW LEVEL SECURITY, so a PGlite-only pass on RLS would be a false pass).
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
let seriesB = "";
// sales.node_id is NOT NULL since the node-id rekey (2026-08-03); insertSale writes the node of
// the sale's own tenant, which the composite (tenant_id, node_id) → nodes FK requires.
let nodeA = "";
let nodeB = "";

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
  nodeA = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  nodeB = await seedNode(db, brandTenantId(TENANT_B), brandLocationId(LOCATION_B));
  const [a] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_A, nodeId: nodeA, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  const [b] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_B, nodeId: nodeB, code: "FB", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a.id;
  seriesB = b.id;
}

// Raw insert of a sale HEADER — deliberately raw `sql`, not the drizzle `sales` object, so the RED
// phase of the counterparty-column tests fails on the real cause ("column counterparty_tax_id does
// not exist", i.e. the migration is absent) rather than on a TypeScript compile error.
let invoiceCounter = 0;
async function insertSale(
  db: Database,
  opts: {
    tenantId?: string;
    tillId?: string;
    nodeId?: string;
    seriesId?: string;
    invoiceLocales?: string[];
    counterparty?: { taxId: string; legalName: string; countryCode: string } | null;
  } = {},
): Promise<string> {
  const tenantId = opts.tenantId ?? TENANT_A;
  const tillId = opts.tillId ?? TILL_A1;
  // node_id is NOT NULL and tenant-consistent with the sale: default to the node of whichever
  // tenant this sale belongs to, so the cross-tenant fixture (tenant B) gets tenant B's node.
  const nodeId = opts.nodeId ?? (tenantId === TENANT_B ? nodeB : nodeA);
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
    sql`insert into sales (
           tenant_id, till_id, node_id, series_id, invoice_number, issued_at,
           issued_offset_minutes, total, locale, invoice_locales, fiscal_backend, fiscal_state,
           counterparty_tax_id, counterparty_legal_name, counterparty_country_code
         ) values (
           ${tenantId}, ${tillId}, ${nodeId}, ${seriesId}, ${invoiceCounter}, ${AT}, 120,
           '1.00', ${locales[0]}, ${localesArray}, 'verifactu', 'recorded',
           ${cp?.taxId ?? null}, ${cp?.legalName ?? null}, ${cp?.countryCode ?? null}
         ) returning id`,
  );
  return row.id;
}

async function insertSubstitution(
  db: Database,
  opts: { tenantId?: string; substitutionSaleId: string; substitutedSaleId: string },
): Promise<{ id: string }[]> {
  return rows<{ id: string }>(
    db,
    sql`insert into sale_substitutions (tenant_id, substitution_sale_id, substituted_sale_id)
         values (${opts.tenantId ?? TENANT_A}, ${opts.substitutionSaleId}, ${opts.substitutedSaleId})
         returning id`,
  );
}

describeEachTarget("sale_substitutions — schema shape after 0014", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
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

describeEachTarget("sale_substitutions — the N:1 link", (target) => {
  let db: Database;
  let f3SaleId = "";
  let ticket1 = "";
  let ticket2 = "";

  beforeEach(async () => {
    db = await target.create();
    invoiceCounter = 0;
    await seed(db);
    ticket1 = await insertSale(db);
    ticket2 = await insertSale(db);
    f3SaleId = await insertSale(db, {
      counterparty: { taxId: "B99999999", legalName: "Acme Corp SL", countryCode: "ES" },
    });
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
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
    // F3 (or the same one) naming an already-substituted ticket is rejected. PROVEN BY DELETION
    // (manual, recorded in this task's report): with sale_substitutions_substituted_key removed
    // from migration 0014, this second insert succeeds. The unique index is what rejects it.
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

  it("rejects a link that crosses tenants (tenant-consistent composite FK)", async () => {
    // Both FKs are composite (tenant_id, *_sale_id) onto sales, mirroring sale_lines_sale_fk: a
    // substitution row may only reference sales of its OWN tenant. Tenant A cannot substitute a
    // ticket belonging to tenant B even though that id exists.
    const foreignTicket = await insertSale(db, {
      tenantId: TENANT_B,
      tillId: TILL_B1,
      seriesId: seriesB,
      invoiceLocales: ["es"],
    });
    const error = await captureError(() =>
      insertSubstitution(db, {
        tenantId: TENANT_A,
        substitutionSaleId: f3SaleId,
        substitutedSaleId: foreignTicket,
      }),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });
});

describeEachTarget("sale_substitutions — immutability", (target) => {
  let db: Database;
  let linkId = "";

  beforeEach(async () => {
    db = await target.create();
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

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("refuses an UPDATE as the app role, on privilege grounds", async () => {
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.execute(
          sql`update sale_substitutions set substituted_sale_id = substitution_sale_id`,
        );
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/permission denied for table sale_substitutions/);
  });

  it("refuses a DELETE as the app role, on privilege grounds", async () => {
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.execute(sql`delete from sale_substitutions`);
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/permission denied for table sale_substitutions/);
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

describeEachTarget("sale_substitutions — RLS", (target) => {
  let db: Database;
  let linkId = "";

  beforeEach(async () => {
    db = await target.create();
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

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("shows a tenant its own substitution row and hides it from another", async () => {
    // Real Postgres via describeEachTarget is the load-bearing target: PGlite is a superuser and
    // would bypass FORCE ROW LEVEL SECURITY, so a PGlite-only pass here proves nothing (CLAUDE.md
    // §4). Both reads run as app_user, under a set app.tenant_id.
    const visibleToA = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.execute(sql`select id from sale_substitutions where id = ${linkId}`);
    });
    expect(visibleToA.rows).toHaveLength(1);

    const visibleToB = await withTenant(db, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute(sql`select id from sale_substitutions where id = ${linkId}`);
    });
    expect(visibleToB.rows).toHaveLength(0);
  });
});

describeEachTarget("sales — counterparty columns", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    invoiceCounter = 0;
    await seed(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
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
