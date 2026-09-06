import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { locations, tenants, tills } from "./tenants.js";
import { ticketItems } from "./ticket-items.js";

// Real Postgres (a template clone), not PGlite: the writes run as the non-owner `app_user`, the
// deployment role, which PGlite (every connection a superuser) cannot be. What this suite proves is
// the schema's own behaviour — the produced Drizzle export's column mapping, the additive
// away_at/note/doneness columns, the per-line UNIQUE that stops a concurrent double-fire, and the
// working_order_lines ON DELETE CASCADE. `app_user`'s grants on ticket_items are pinned by the
// privilege matrix (packages/fiscal-verifactu/src/privileges.expected.ts).
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";
// Café solo is this package's placeholder line description (park-retrieve.test.ts): the locale
// trigger checks description KEYS against the venue's invoice_locales (['es'] here), and this literal
// already passes english-only.ts's SPANISH_WORDS guard as test DATA.
const DESCRIPTIONS_A = JSON.stringify({ es: "Café solo" });

// Captured at seed time (the ids the raw inserts below need for tenant-consistent FKs).
let nodeA = "";
let productA = "";
let stationA = "";
let orderNumberSeq = 0;

describe("ticket_items schema (columns + per-line unique + cascade)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    const admin = suite.admin;
    await admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        tenantId: TENANT_A,
        name: "Fixture Location A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    await admin
      .insert(tills)
      .values([{ id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" }]);
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    const [catA] = await admin
      .insert(catalogues)
      .values({ tenantId: TENANT_A, name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prodA] = await admin
      .insert(products)
      .values({
        tenantId: TENANT_A,
        catalogueId: catA!.id,
        descriptions: { es: "Café solo" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prodA!.id;
    // The venue's default station — the FK target for ticket_items.station_id. Seeded as admin.
    stationA = await seedStation(TENANT_A, LOCATION_A);
  });

  async function seedStation(tenant: string, location: string): Promise<string> {
    const r = await suite.admin.execute<{ id: string }>(
      sql`insert into kitchen_stations (tenant_id, location_id, name, is_default)
          values (${tenant}, ${location}, 'Cocina', true) returning id`,
    );
    return r.rows[0]!.id;
  }

  async function seedOrderLine(
    tenant: string,
    till: string,
    node: string,
    product: string,
  ): Promise<{ orderId: string; lineId: string }> {
    orderNumberSeq += 1;
    const order = await suite.admin.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, node_id, order_number, status, opened_at)
          values (${tenant}, ${till}, ${node}, ${orderNumberSeq}, 'open', ${AT}) returning id`,
    );
    const orderId = order.rows[0]!.id;
    const line = await suite.admin.execute<{ id: string }>(
      sql`insert into working_order_lines
            (tenant_id, working_order_id, line_no, product_id, descriptions,
             quantity, unit_price, unit_price_gross, vat_rate, line_total)
          values (${tenant}, ${orderId}, 1, ${product}, ${DESCRIPTIONS_A}::jsonb,
             '1.000', '1.00', '1.10', '10.00', '1.10') returning id`,
    );
    return { orderId, lineId: line.rows[0]!.id };
  }

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  function seedTicket(
    tenant: string,
    node: string,
    orderId: string,
    lineId: string,
    station: string,
    state = "queued",
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into ticket_items
              (tenant_id, node_id, working_order_id, working_order_line_id, station_id, state)
            values (${tenant}, ${node}, ${orderId}, ${lineId}, ${station}, ${state}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("exposes every column through the Drizzle export across the queued → preparing → ready lifecycle", async () => {
    const { orderId, lineId } = await seedOrderLine(TENANT_A, TILL_A1, nodeA, productA);
    const id = await seedTicket(TENANT_A, nodeA, orderId, lineId, stationA);
    // Advance queued → preparing → ready as app_user — the per-line kitchen lifecycle (§2d).
    await asApp(TENANT_A, (tx) =>
      tx.execute(
        sql`update ticket_items set state = 'preparing', preparing_at = now() where id = ${id}`,
      ),
    );
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update ticket_items set state = 'ready', ready_at = now() where id = ${id}`),
    );
    // Read back through the Drizzle `ticketItems` export — exercises the produced table export and its
    // column mapping under the app role, and resolves every column (a missing grant would be 42501, an
    // undefined column 42703).
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(sql`id = ${id}`),
    );
    expect(row!.state).toBe("ready");
    expect(row!.workingOrderLineId).toBe(lineId);
    expect(row!.workingOrderId).toBe(orderId);
    expect(row!.stationId).toBe(stationA);
    expect(row!.nodeId).toBe(nodeA);
    expect(row!.queuedAt).not.toBeNull();
    expect(row!.readyAt).not.toBeNull();
    // The new away_at column (KDS-3, §2a) resolves under the app role and is NULL before the pass
    // dispatches the item — a missing column would be 42703 (undefined_column) rather than a null value.
    expect(row!.awayAt).toBeNull();
  });

  it("app_user can stamp away_at (the pass dispatch) and read it back through the Drizzle export", async () => {
    // The KDS-3 §2a terminal display step: after `ready`, the expo/pass stamps `away_at = now()`. It is
    // an additive nullable timestamptz on ticket_items, so the existing SELECT/INSERT/UPDATE grant to
    // app_user (0055) covers it with no grant change — a write that raised 42501 would mean the column
    // was somehow outside the table grant, and a read that raised 42703 would mean the migration's ADD
    // COLUMN never applied. This is the Task-1 receipt that the added column is visible AND writable.
    const { orderId, lineId } = await seedOrderLine(TENANT_A, TILL_A1, nodeA, productA);
    const id = await seedTicket(TENANT_A, nodeA, orderId, lineId, stationA);
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update ticket_items set away_at = now() where id = ${id}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(sql`id = ${id}`),
    );
    expect(row!.awayAt).not.toBeNull();
  });

  it("carries nullable note + doneness columns that app_user can stamp (spec §2/§3, NON-FISCAL)", async () => {
    // Per-line kitchen customisation snapshotted from the working-order line at fire time (like
    // station_id/course_id). `note` (free-text) and `doneness` (the meat-doneness enum) are additive
    // NULLABLE columns under the existing SELECT/INSERT/UPDATE grant (0055) — a write raising 42501
    // would mean the column was outside the grant, a read raising 42703 that the ADD COLUMN never
    // applied. NON-FISCAL: never read into a filed record.
    const meta = await suite.admin.execute<{
      column_name: string;
      is_nullable: string;
      data_type: string;
      udt_name: string;
    }>(
      sql`select column_name, is_nullable, data_type, udt_name
            from information_schema.columns
           where table_name = 'ticket_items' and column_name in ('note', 'doneness')
           order by column_name`,
    );
    expect(meta.rows).toEqual([
      {
        column_name: "doneness",
        is_nullable: "YES",
        data_type: "USER-DEFINED",
        udt_name: "doneness",
      },
      { column_name: "note", is_nullable: "YES", data_type: "text", udt_name: "text" },
    ]);
    // app_user stamps both (additive columns, existing grant) and reads them back.
    const { orderId, lineId } = await seedOrderLine(TENANT_A, TILL_A1, nodeA, productA);
    const id = await seedTicket(TENANT_A, nodeA, orderId, lineId, stationA);
    await asApp(TENANT_A, (tx) =>
      tx.execute(
        sql`update ticket_items set note = 'sin sal', doneness = 'medium_rare' where id = ${id}`,
      ),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ note: string; doneness: string }>(
          sql`select note, doneness from ticket_items where id = ${id}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.note).toBe("sin sal");
    expect(row!.doneness).toBe("medium_rare");
  });

  it("rejects a second ticket item for the same line (the per-line UNIQUE — the concurrent-fire guard)", async () => {
    // One ticket item per working_order_line: a second insert for the same line is a unique_violation
    // (23505). This is the guard §7 names for a concurrent double-fire — two rounds firing at once
    // collide here rather than duplicating the item.
    const { orderId, lineId } = await seedOrderLine(TENANT_A, TILL_A1, nodeA, productA);
    await seedTicket(TENANT_A, nodeA, orderId, lineId, stationA);
    const e = await captureError(() => seedTicket(TENANT_A, nodeA, orderId, lineId, stationA));
    expect(pgErrorCode(e)).toBe("23505");
  });

  it("cascades a ticket item away when its working_order_line is deleted (ON DELETE CASCADE)", async () => {
    // The composite (tenant_id, working_order_line_id) → working_order_lines FK is ON DELETE CASCADE —
    // the analogue of order_prep's order FK. Deleting the line (as admin; the parent order is open, so
    // working_order_lines_require_open_parent permits it) removes the ticket item with it, which is how
    // a cancelled/abandoned line's item is cleaned up without any DELETE grant on ticket_items.
    const { orderId, lineId } = await seedOrderLine(TENANT_A, TILL_A1, nodeA, productA);
    const id = await seedTicket(TENANT_A, nodeA, orderId, lineId, stationA);
    const before = await countTicket(id);
    expect(before).toBe(1);
    await suite.admin.execute(sql`delete from working_order_lines where id = ${lineId}`);
    const after = await countTicket(id);
    expect(after).toBe(0); // the ticket item went with the line — the cascade fired.
  });

  async function countTicket(id: string): Promise<number> {
    const r = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from ticket_items where id = ${id}`,
    );
    return r.rows[0]!.n;
  }
});
