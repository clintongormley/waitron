import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { usePgliteDb } from "../testing/lifecycle.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedNode } from "../testing/seed.js";
import { catalogues, optionGroupItems, optionGroups, products } from "./catalogue.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

afterEach(async () => {
  await suite.db.transaction(async (tx) => {
    // Fixture cleanup must remove lines whose parent is already terminal, which the origin-only
    // `working_order_lines_require_open_parent` trigger would reject. `session_replication_role =
    // 'replica'` skips origin-only ('O') triggers exactly as the replication apply path does (PGlite
    // connections are superuser), leaving the ENABLE ALWAYS append-only guards intact; SET LOCAL
    // restores the ordinary role before the next case exercises the real write path.
    await tx.execute(sql`set local session_replication_role = 'replica'`);
    await tx.execute(sql`delete from working_order_lines`);
    await tx.execute(sql`delete from working_orders`);
    await tx.execute(sql`delete from option_group_items`);
    await tx.execute(sql`delete from option_groups`);
    await tx.execute(sql`delete from products`);
    await tx.execute(sql`delete from catalogues`);
    await tx.execute(sql`delete from nodes`);
    await tx.execute(sql`delete from tills`);
    await tx.execute(sql`delete from locations`);
    await tx.execute(sql`delete from tenants`);
  });
});

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// working_order_lines.product_id carries a tenant-consistent composite FK to products (park &
// retrieve, Task 1). It is NULLABLE since ordering modifiers (Task 2) — a child modifier line has no
// product — but every PARENT dish line still needs a real product. seed() creates one priced product
// and stores its id here; the LINE fixture uses it.
let productA = "";
// order_number is NOT NULL on working_orders. No UNIQUE constraint yet (the per-node allocator is a
// later task), so a simple ascending counter keeps every fixture order distinct without one.
let orderNumberSeq = 0;

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      // Bilingual on purpose: a single-locale venue cannot detect a trigger
      // that checks "at least one locale" instead of "exactly these".
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
  // One priced product — the FK target every draft line now needs.
  const [catA] = await db
    .insert(catalogues)
    .values({ name: "Deli A" })
    .returning({ id: catalogues.id });
  const [prodA] = await db
    .insert(products)
    .values({
      catalogueId: catA.id,
      name: "Café solo",
      pricingUnit: "each",
      unitPrice: "1.30",
      vatClass: "general",
    })
    .returning({ id: products.id });
  productA = prodA.id;
}

async function openOrder(db: Database, tillId = TILL_A1): Promise<string> {
  const [row] = await db
    .insert(workingOrders)
    .values({ tillId, orderNumber: ++orderNumberSeq, status: "open", openedAt: AT })
    .returning({ id: workingOrders.id });
  return row.id;
}

// The shared line fixture; callers pass the tenant's product via productId.
const LINE = {
  lineNo: 1,
  name: "Café solo",
  descriptions: { es: "Café solo", ca: "Cafè sol" },
  quantity: "1.000",
  unitPrice: "1.30",
  // The GROSS (VAT-inclusive) unit locked at add time (unit_price_gross, 7c): 1.30 net at 10% VAT.
  unitPriceGross: "1.43",
  vatRate: "10.00",
  lineTotal: "1.30",
};

describe("working_orders", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("opens an order in the open state with no settled_at", async () => {
    const id = await openOrder(db);
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("open");
    expect(row.settledAt).toBeNull();
  });

  it("rejects a status outside the enum", async () => {
    const error = await captureError(() =>
      db.execute(
        sql`insert into working_orders (till_id, status, opened_at) values (${TILL_A1}::uuid, 'paid', ${AT}::timestamptz)`,
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/invalid input value for enum working_order_status/);
  });

  it("amends an open order", async () => {
    // open → open is the ordinary case and must stay cheap: a table adds a
    // round of drinks four times before it asks for the bill.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    await db
      .insert(workingOrderLines)
      .values({ ...LINE, productId: productA, lineNo: 2, workingOrderId: id });
    await db
      .update(workingOrderLines)
      .set({ quantity: "2.000", lineTotal: "2.60" })
      .where(eq(workingOrderLines.workingOrderId, id));
    const found = await db
      .select({ total: workingOrderLines.lineTotal })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(found.map((r) => r.total)).toEqual(["2.60", "2.60"]);
  });

  it("settles an open order and stamps settled_at", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("settled");
    expect(row.settledAt).not.toBeNull();
  });

  it("abandons an open order", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("abandoned");
    expect(row.settledAt).toBeNull();
  });

  it("rejects settling without a settled_at", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.update(workingOrders).set({ status: "settled" }).where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/working_orders_settled_at_ck/);
  });

  it("rejects a settled_at on an order that is not settled", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.update(workingOrders).set({ settledAt: AT }).where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/working_orders_settled_at_ck/);
  });

  it("rejects settled → open", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db
        .update(workingOrders)
        .set({ status: "open", settledAt: null })
        .where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/cannot transition from settled to open/);
  });

  it("rejects settled → abandoned", async () => {
    // The illegal transitions are the ones worth testing. A state machine
    // tested only on its happy path is a comment.
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db
        .update(workingOrders)
        .set({ status: "abandoned", settledAt: null })
        .where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/cannot transition from settled to abandoned/);
  });

  it("rejects abandoned → open", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.update(workingOrders).set({ status: "open" }).where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/cannot transition from abandoned to open/);
  });

  it("rejects abandoned → settled", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db
        .update(workingOrders)
        .set({ status: "settled", settledAt: AT })
        .where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/cannot transition from abandoned to settled/);
  });

  it("rejects a no-op update of a settled order", async () => {
    // Terminal means terminal, not "terminal for the columns we thought of".
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.update(workingOrders).set({ tillId: TILL_A1 }).where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/cannot transition from settled to settled/);
  });

  it("rejects a no-op update of an abandoned order", async () => {
    // The symmetric case of the settled one above: the guard checks
    // OLD.status itself rather than branching per terminal state, so this is
    // very likely redundant with it — but "terminal means terminal" should be
    // demonstrated for both terminal states, not just one of them.
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.update(workingOrders).set({ tillId: TILL_A1 }).where(eq(workingOrders.id, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/cannot transition from abandoned to abandoned/);
  });

  it("carries a nullable node_id column referencing nodes", async () => {
    // Node rekey scaffolding (Task 3): node_id is added NULLABLE with a plain FK to `nodes`, and
    // working_orders stays nullable permanently in this slice — no writer yet (design §5).
    const node = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    const meta = await rows<{ is_nullable: string }>(
      db,
      sql`select is_nullable from information_schema.columns
           where table_name = 'working_orders' and column_name = 'node_id'`,
    );
    expect(meta).toEqual([{ is_nullable: "YES" }]);
    // Opens fine WITHOUT node_id (nullable) ...
    const plainId = await openOrder(db);
    const [plain] = await db.select().from(workingOrders).where(eq(workingOrders.id, plainId));
    expect(plain.nodeId).toBeNull();
    // ... and accepts a valid node id when set.
    const [withNode] = await db
      .insert(workingOrders)
      .values({
        tillId: TILL_A1,
        orderNumber: ++orderNumberSeq,
        status: "open",
        openedAt: AT,
        nodeId: node,
      })
      .returning({ nodeId: workingOrders.nodeId });
    expect(withNode.nodeId).toBe(node);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    const error = await captureError(() =>
      db.insert(workingOrders).values({
        tillId: TILL_A1,
        orderNumber: ++orderNumberSeq,
        status: "open",
        openedAt: AT,
        nodeId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/violates foreign key constraint/);
  });
});

describe("working_order_lines", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("adds a line to an open order", async () => {
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    const found = await db.select().from(workingOrderLines);
    expect(found).toHaveLength(1);
    expect(found[0].descriptions).toEqual({ es: "Café solo", ca: "Cafè sol" });
  });

  it("rejects a duplicate line_no within an order", async () => {
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id }),
    );
    expect(pgErrorMessage(error)).toMatch(/duplicate key value/);
  });

  it("rejects a line added to a settled order", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id }),
    );
    expect(pgErrorMessage(error)).toMatch(/lines may only be written while the order is open/);
  });

  it("rejects a line added to an abandoned order", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id }),
    );
    expect(pgErrorMessage(error)).toMatch(/lines may only be written while the order is open/);
  });

  it("rejects deleting a line from a settled order", async () => {
    // Deletion is the transition that would otherwise slip through: the
    // trigger has to cover DELETE, and OLD rather than NEW carries the id.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.delete(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    );
    expect(pgErrorMessage(error)).toMatch(/lines may only be written while the order is open/);
  });

  it("rejects descriptions missing a configured locale", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({
        ...LINE,
        productId: productA,
        workingOrderId: id,
        descriptions: { es: "Café solo" },
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/descriptions must carry exactly the venue locales/);
  });

  it("rejects descriptions carrying an unconfigured locale", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({
        ...LINE,
        productId: productA,
        workingOrderId: id,
        descriptions: { es: "Café solo", ca: "Cafè sol", en: "Black coffee" },
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/descriptions must carry exactly the venue locales/);
  });

  it("keeps a line's descriptions when the venue's locales change afterwards", async () => {
    // The snapshot is the whole point. Re-rendering a line through a later
    // configuration would mean a receipt reprinted next year reads differently
    // from the one the customer took.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    await db
      .update(locations)
      .set({ invoiceLocales: ["es", "en"] })
      .where(eq(locations.id, LOCATION_A));
    const [line] = await db.select().from(workingOrderLines);
    expect(line.descriptions).toEqual({ es: "Café solo", ca: "Cafè sol" });
  });

  it("carries only product_id, variant_id and option_group_item_id as catalogue-shaped identifiers", async () => {
    // The mutable draft keeps product_id as a pricing input and option_group_item_id for modifier
    // authoring traceability. variant_id records which variant was selected; it is copied into the
    // filed line as a snapshot identifier without a catalogue FK. Names and prices are snapshotted by
    // value, so none of these identifiers lets a catalogue edit change a completed record.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
           where table_name = 'working_order_lines'`,
    );
    const references = cols
      .map((c) => c.column_name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant|category)_id$/i.test(n))
      .sort();
    expect(references).toEqual(["option_group_item_id", "product_id", "variant_id"]);
  });

  it("carries nullable note + doneness columns (KDS-only, NON-FISCAL — spec §2/§3)", async () => {
    const meta = await rows<{
      column_name: string;
      is_nullable: string;
      data_type: string;
      udt_name: string;
    }>(
      db,
      sql`select column_name, is_nullable, data_type, udt_name
            from information_schema.columns
           where table_name = 'working_order_lines' and column_name in ('note', 'doneness')
           order by column_name`,
    );
    expect(meta).toEqual([
      {
        column_name: "doneness",
        is_nullable: "YES",
        data_type: "USER-DEFINED",
        udt_name: "doneness",
      },
      { column_name: "note", is_nullable: "YES", data_type: "text", udt_name: "text" },
    ]);
  });

  it("stores every monetary column as numeric(12, 2)", async () => {
    const cols = await rows<{
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      db,
      sql`select column_name, data_type, numeric_precision, numeric_scale
            from information_schema.columns
           where table_name = 'working_order_lines'
             and column_name in ('unit_price', 'unit_price_gross', 'line_total')`,
    );
    expect(cols).toHaveLength(3);
    for (const col of cols) {
      expect(col.data_type).toBe("numeric");
      expect(col.numeric_precision).toBe(12);
      expect(col.numeric_scale).toBe(2);
    }
  });
});

/**
 * The modifier links on the MUTABLE draft line (ordering modifiers, Task 2):
 *
 * - `parent_line_id` — a self-link so a modifier is its own child line pointing at the dish line it
 *   belongs to. Composite (tenant_id, parent_line_id) → working_order_lines(tenant_id, id), MATCH
 *   SIMPLE so a top-level line (NULL) passes. A child modifier line has no product, which is why
 *   `product_id` is now NULLABLE (was NOT NULL): the FK to products is null-permissive, so parent
 *   rows are unaffected.
 * - `option_group_item_id` — authoring TRACEABILITY only. Composite (tenant_id, option_group_item_id)
 *   → option_group_items(tenant_id, id) with onDelete SET NULL: the option's price/name/VAT are
 *   snapshotted onto the line by value, so a catalogue DELETE of an option item must NOT be blocked
 *   and must NOT strip the draft's snapshot columns — it only clears this back-reference. It lives on
 *   working_order_lines only, never on the filed sale_lines (which stay decoupled from the mutable
 *   catalogue).
 */
describe("working_order_lines — modifier links", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  // Raw insert so the RED phase fails on the missing column, not a TypeScript compile error against
  // the drizzle `workingOrderLines` type. product_id is passed explicitly (NULL for a child line).
  async function insertLine(opts: {
    workingOrderId: string;
    lineNo: number;
    productId: string | null;
    parentLineId?: string | null;
    optionGroupItemId?: string | null;
    descriptions?: string;
  }): Promise<{ id: string }[]> {
    const descriptions = opts.descriptions ?? '{"es":"Café solo","ca":"Cafè sol"}';
    return rows<{ id: string }>(
      db,
      sql`insert into working_order_lines (working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total, parent_line_id, option_group_item_id) values (${opts.workingOrderId}, ${opts.lineNo}, ${opts.productId}, 'Café solo',
             ${descriptions}::jsonb, '1.000', '1.30', '1.43', '10.00', '1.30',
             ${opts.parentLineId ?? null}, ${opts.optionGroupItemId ?? null}
           ) returning id`,
    );
  }

  // A group + one item. Names are the known-safe café strings — option names are jsonb
  // VALUES, but this package's english-only guard scans string literals in test files too.
  async function seedOptionItem(): Promise<string> {
    const [group] = await db
      .insert(optionGroups)
      .values({ name: { es: "Café solo" } })
      .returning({ id: optionGroups.id });
    const [item] = await db
      .insert(optionGroupItems)
      .values({ groupId: group.id, name: { es: "Café solo" }, priceDelta: "0.50" })
      .returning({ id: optionGroupItems.id });
    return item.id;
  }

  it("links a child modifier line to its parent dish line within the tenant", async () => {
    const orderId = await openOrder(db);
    const [parent] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    // A child modifier line: no product of its own, linked to the parent dish line.
    const [child] = await insertLine({
      workingOrderId: orderId,
      lineNo: 2,
      productId: null,
      parentLineId: parent.id,
    });
    const [row] = await rows<{ parent_line_id: string; product_id: string | null }>(
      db,
      sql`select parent_line_id, product_id from working_order_lines where id = ${child.id}::uuid`,
    );
    expect(row.parent_line_id).toBe(parent.id);
    expect(row.product_id).toBeNull();
  });

  it("links a line to an option_group_item for authoring traceability", async () => {
    const orderId = await openOrder(db);
    const itemId = await seedOptionItem();
    const [line] = await insertLine({
      workingOrderId: orderId,
      lineNo: 1,
      productId: productA,
      optionGroupItemId: itemId,
    });
    const [row] = await rows<{ option_group_item_id: string }>(
      db,
      sql`select option_group_item_id from working_order_lines where id = ${line.id}::uuid`,
    );
    expect(row.option_group_item_id).toBe(itemId);
  });

  it("nulls option_group_item_id when the catalogue item is deleted, rather than blocking", async () => {
    // Traceability only — the option's price/name/VAT are snapshotted onto the line by value, so a
    // catalogue DELETE must NOT be blocked (not RESTRICT) and must leave the line's own columns
    // intact; onDelete SET NULL clears just this back-reference. The order stays open so the
    // require_open_parent trigger admits the cascade UPDATE.
    const orderId = await openOrder(db);
    const itemId = await seedOptionItem();
    const [line] = await insertLine({
      workingOrderId: orderId,
      lineNo: 1,
      productId: productA,
      optionGroupItemId: itemId,
    });
    await db.delete(optionGroupItems).where(eq(optionGroupItems.id, itemId));
    const [row] = await rows<{ option_group_item_id: string | null; line_total: string }>(
      db,
      sql`select option_group_item_id, line_total from working_order_lines where id = ${line.id}::uuid`,
    );
    expect(row.option_group_item_id).toBeNull();
    expect(row.line_total).toBe("1.30");
  });
});
