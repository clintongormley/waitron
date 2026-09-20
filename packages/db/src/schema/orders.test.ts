import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { usePgliteDb } from "../testing/lifecycle.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedNode } from "../testing/seed.js";
import { catalogues, products } from "./catalogue.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

afterEach(async () => {
  await suite.db.transaction(async (tx) => {
    // Fixture cleanup must remove lines whose parent is already terminal, which the origin-only
    // `working_order_lines_require_open_parent` trigger would reject. `session_replication_role =
    // 'replica'` skips origin-only ('O') triggers while leaving the ENABLE ALWAYS append-only guards
    // intact (PGlite connections are superuser, so the SET is permitted); SET LOCAL
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

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// working_order_lines.product_id carries a foreign key to products (park & retrieve, Task 1). Both
// kinds of line name a product today: a parent names the dish and a child extra line names the
// PICKED product. The column stays nullable (see the schema comment on it), but nothing here
// exercises that. seed() creates one priced product and stores its id here; the LINE fixture uses
// it.
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
    .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
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
    const node = await seedNode(db, brandLocationId(LOCATION_A));
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

  it("carries only product_id and variant_id as catalogue-shaped identifiers", async () => {
    // The mutable draft keeps product_id — the dish's on a top-level line, the PICKED extra's on a
    // child line. variant_id records which variant was selected; it is copied into the filed line as a
    // snapshot identifier without a catalogue FK. Names and prices are snapshotted by value, so
    // neither identifier lets a catalogue edit change a completed record. The extras and options a
    // line answered point at nothing: `option_snapshots` holds names, and a pick becomes a child line
    // naming its product.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
           where table_name = 'working_order_lines'`,
    );
    const references = cols
      .map((c) => c.column_name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant|category)_id$/i.test(n))
      .sort();
    expect(references).toEqual(["product_id", "variant_id"]);
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
 * The links on the MUTABLE draft line:
 *
 * - `parent_line_id` — a self-link so an extra is its own child line pointing at the dish line it
 *   belongs to. (parent_line_id) → working_order_lines(id), MATCH SIMPLE so a top-level line (NULL)
 *   passes.
 * - `product_id` — the dish's on a top-level line and the PICKED product's on a child line, under
 *   one `ON DELETE restrict` FK, so a product either kind of line names cannot be deleted while the
 *   line exists (asserted below). The column is NULLABLE — a line naming NO product inserts, which
 *   no case here exercises — but not in order to survive a deleted product, because `restrict`
 *   makes that deletion impossible. It has no bearing on the parent FK, which is a separate constraint on a separate
 *   column (working_order_lines_parent_fk, 0034_drop_tenant_id_after_sql.sql).
 * - `option_snapshots` — the dish's frozen options answers, NOT NULL and defaulting to an empty list.
 *   It names no list and no label, so deleting either cannot reach a saved order.
 */
describe("working_order_lines — the draft line's links", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  // Raw insert so a missing column fails here rather than as a TypeScript error against the drizzle
  // `workingOrderLines` type. product_id is passed explicitly (NULL for a line naming no product).
  async function insertLine(opts: {
    workingOrderId: string;
    lineNo: number;
    productId: string | null;
    parentLineId?: string | null;
    descriptions?: string;
  }): Promise<{ id: string }[]> {
    const descriptions = opts.descriptions ?? '{"es":"Café solo","ca":"Cafè sol"}';
    return rows<{ id: string }>(
      db,
      sql`insert into working_order_lines (working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total, parent_line_id) values (${opts.workingOrderId}, ${opts.lineNo}, ${opts.productId}, 'Café solo',
             ${descriptions}::jsonb, '1.000', '1.30', '1.43', '10.00', '1.30',
             ${opts.parentLineId ?? null}
           ) returning id`,
    );
  }

  it("links a child extra line to its parent dish line, and the child names its own product", async () => {
    const orderId = await openOrder(db);
    const [parent] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    // A child extra line: the PICKED product, linked to the parent dish line.
    const [child] = await insertLine({
      workingOrderId: orderId,
      lineNo: 2,
      productId: productA,
      parentLineId: parent.id,
    });
    const [row] = await rows<{ parent_line_id: string; product_id: string | null }>(
      db,
      sql`select parent_line_id, product_id from working_order_lines where id = ${child.id}::uuid`,
    );
    expect(row.parent_line_id).toBe(parent.id);
    expect(row.product_id).toBe(productA);
  });

  it("refuses to delete a product an open order's child line names, and allows one nothing names", async () => {
    const orderId = await openOrder(db);
    const [parent] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    await insertLine({
      workingOrderId: orderId,
      lineNo: 2,
      productId: productA,
      parentLineId: parent.id,
    });
    const error = await captureError(() => db.delete(products).where(eq(products.id, productA)));
    // `ON DELETE restrict`, not SET NULL: a live basket line must keep naming what the kitchen is
    // cooking (spec §3.5).
    expect(pgErrorMessage(error)).toContain("working_order_lines_product_fk");

    // The control, in the other direction: an unnamed product deletes, so the refusal above is the
    // reference and not the delete itself failing.
    const [spare] = await db
      .insert(products)
      .values({
        catalogueId: (await db.select({ id: catalogues.id }).from(catalogues))[0]!.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: "1.30",
        vatClass: "general",
      })
      .returning({ id: products.id });
    await db.delete(products).where(eq(products.id, spare.id));
    expect(await db.select({ id: products.id }).from(products)).toHaveLength(1);
  });

  it("defaults option_snapshots to an empty list and refuses a null", async () => {
    const orderId = await openOrder(db);
    const [line] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    const [row] = await rows<{ option_snapshots: unknown }>(
      db,
      sql`select option_snapshots from working_order_lines where id = ${line.id}::uuid`,
    );
    expect(row.option_snapshots).toEqual([]);
    const error = await captureError(() =>
      db.execute(
        sql`update working_order_lines set option_snapshots = null where id = ${line.id}::uuid`,
      ),
    );
    expect(pgErrorMessage(error)).toContain("option_snapshots");
  });
});
