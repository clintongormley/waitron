import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_ENROLMENT } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { applyBatch } from "./apply.js";

// Real Postgres, not PGlite: this suite proves the Slice-7 config-conflict gate on the apply path
// under a genuine non-superuser, non-BYPASSRLS role (sync_applier — member of app_user + sync_tailer),
// so the sync_config_conflicts INSERT genuinely runs through the app_user grant and the reject/settle
// bookkeeping is exercised as it is in production. PGlite connects as a superuser and bypasses the
// role model — a false pass here (CLAUDE.md §4). The whole migration manifest runs (sync last), so the
// container carries sync_config_conflicts (0009) plus every enrolled table + capture trigger. The
// injected enrolment set is CORE_ENROLMENT (@waitron/db) — it carries products (configClass: true),
// dining_tables (configClass: false, the excluded mixed table) and working_orders (runtime), the three
// tables this suite exercises.
const postgres = useTemplateDb({ template: "manifest" });

const uuid = (): string => randomUUID();

// The gate keys on two node ids: the serving-primary (the carrier draining a returned node's tail) and
// the fenced/returned node whose config writes primary-wins overrides. They are generated FRESH per
// test — the suite shares one cloned DB across all its tests (useTemplateDb: one clone per file), and
// sync_config_conflicts is whole-DB (no tenant_id/RLS), so a fixed origin id would let one test's
// recorded conflict leak into another test's origin-keyed read-back.

/** Stamps (or re-stamps) the singleton deployment.environment so each test is order-independent. */
async function setEnv(environment: "production" | "preproduction"): Promise<void> {
  await postgres.admin.execute(
    sql`insert into deployment (id, environment) values (1, ${environment})
        on conflict (id) do update set environment = excluded.environment`,
  );
}

interface Base {
  tenantId: string;
  locationId: string;
  tillId: string;
  catalogueId: string;
}

/** Seeds a tenant plus the FK parents the fixture rows reference (a location, a till, a catalogue),
 * as the superuser admin (RLS bypassed; pure setup). English fixture values throughout: packages/sync/src
 * is inside the english-only guard (CLAUDE.md §3). */
async function seedBase(): Promise<Base> {
  const admin = postgres.admin;
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(
    sql`insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${tenantId}, 'Location', array['en']::text[], 'Hospitality') returning id`,
  );
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name)
        values (${tenantId}, ${locationId}, 'Till') returning id`,
  );
  const cat = await admin.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
  );
  return { tenantId, locationId, tillId: till.rows[0]!.id, catalogueId: cat.rows[0]!.id };
}

type Image = Record<string, unknown>;

/** The wire shape: row_image travels as the source's raw row_image::text — a STRING (design §4b). */
const wire = (image: Image): string => JSON.stringify(image);

/** A complete `products` row_image (a config-class table). Every column present, all nullable kitchen/
 * catalogue links NULL — exactly what to_jsonb(products) captures. */
function productImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    catalogue_id: b.catalogueId,
    category_id: null,
    station_id: null,
    course_id: null,
    descriptions: { en: "Coffee" },
    pricing_unit: "each",
    unit_price: "1.30",
    vat_class: "general",
    active: true,
    image: null,
    allergens: null,
    manual_allergens: null,
    recipe_derivation: null,
    diet_derivation: null,
    diet_override: null,
    diet: null,
    created_at: "2026-09-02T10:00:00+00:00",
    updated_at: "2026-09-02T10:00:00+00:00",
    ...over,
  };
}

/** A complete `dining_tables` row_image — the MIXED config/runtime table Slice 7 EXCLUDES from
 * config-class (tab_id is single-writer runtime; per-field merge deferred, spec §7). */
function diningTableImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    location_id: b.locationId,
    label: "T1",
    zone_id: null,
    capacity: null,
    active: true,
    created_at: "2026-08-27T10:00:00+00:00",
    tab_id: null,
    status_id: null,
    pos_x: null,
    pos_y: null,
    shape: null,
    rotation: null,
    ...over,
  };
}

/** A complete `working_orders` row_image — a commercial/runtime table (not config-class). status
 * 'open' ⇒ settled_at NULL (working_orders_settled_at_ck). */
function workingOrderImage(b: Base, orderNumber: number, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    till_id: b.tillId,
    node_id: null,
    order_number: orderNumber,
    label: null,
    status: "open",
    opened_at: "2026-08-27T10:00:00+00:00",
    settled_at: null,
    delivery_table_id: null,
    collected_at: null,
    ...over,
  };
}

// Admin (RLS-bypassing) read-backs of the mirror's actual stored state.
async function scalar(query: ReturnType<typeof sql>): Promise<string | null> {
  const r = await postgres.admin.execute<{ v: string | null }>(query);
  return r.rows[0]?.v ?? null;
}
const productCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from products where id = ${id}`);
const tableCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from dining_tables where id = ${id}`);
const workingOrderCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from working_orders where id = ${id}`);

/** Reads one lane's cursor for (subscriber, origin), or 0n when absent. */
async function laneCursor(subscriberId: string, originId: string, lane: string): Promise<bigint> {
  const r = await postgres.admin.execute<{ seq: string | null }>(
    sql`select last_applied_seq::text as seq from sync_cursor
        where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid and lane = ${lane}`,
  );
  return r.rows[0]?.seq ? BigInt(r.rows[0].seq) : 0n;
}

/** All sync_config_conflicts rows for one origin, read back as the admin (no RLS on this ops table). */
async function conflicts(
  originId: string,
): Promise<{ table_name: string; origin_id: string; lane: string; row_image_id: string | null }[]> {
  const r = await postgres.admin.execute<{
    table_name: string;
    origin_id: string;
    lane: string;
    row_image_id: string | null;
  }>(
    sql`select table_name, origin_id::text as origin_id, lane, row_image->>'id' as row_image_id
        from sync_config_conflicts where origin_id = ${originId}::uuid order by id`,
  );
  return r.rows;
}

const PROD = {
  localEnvironment: "production",
  sourceEnvironment: "production",
  enrolments: CORE_ENROLMENT,
} as const;

describe("Slice 7 — the config-conflict apply gate (primary-wins)", () => {
  it("rejects a config-class row from a non-serving-primary origin: not applied, recorded, cursor advances", async () => {
    // The carrier is draining the RETURNED node's tail. A products (config-class) row it produced is
    // NOT the serving-primary's, so primary-wins REJECTS it: not applied, recorded to
    // sync_config_conflicts, and settled so the cursor advances (the drain is never blocked).
    await setEnv("production");
    const b = await seedBase();
    const subscriberId = uuid();
    const NODE_PRIMARY = uuid(); // the serving-primary this batch is keyed to
    const NODE_RETURNED = uuid(); // the fenced/returned node (≠ serving-primary), fresh per test
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = productImage(b);
      const productId = img.id as string;
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId: NODE_RETURNED,
            table: "products",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(img),
          },
        ],
        { subscriberId, servingPrimaryId: NODE_PRIMARY, ...PROD },
      );
      expect(result).toEqual({ applied: 0, deferred: 0, rejected: 1, versionParked: 0 });
      expect(await productCount(productId)).toBe("0"); // primary-wins: the row was NOT applied

      const recorded = await conflicts(NODE_RETURNED);
      expect(recorded).toHaveLength(1); // recorded exactly once
      expect(recorded[0]!.table_name).toBe("products");
      expect(recorded[0]!.origin_id).toBe(NODE_RETURNED);
      expect(recorded[0]!.lane).toBe("ordered");
      expect(recorded[0]!.row_image_id).toBe(productId); // the rejected row verbatim in row_image

      // Settled (not parked): the cursor advanced past the seq, so a re-deliver of the same seq is a
      // no-op — never re-applied and never re-recorded (drain not blocked, spec §7).
      expect(await laneCursor(subscriberId, NODE_RETURNED, "ordered")).toBe(1n);
      const redeliver = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId: NODE_RETURNED,
            table: "products",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(img),
          },
        ],
        { subscriberId, servingPrimaryId: NODE_PRIMARY, ...PROD },
      );
      expect(redeliver).toEqual({ applied: 0, deferred: 0, rejected: 0, versionParked: 0 }); // skipped by the cursor
      expect(await conflicts(NODE_RETURNED)).toHaveLength(1); // not recorded a second time
    } finally {
      await applier.close();
    }
  });

  it("accepts a config-class row from the serving-primary origin", async () => {
    await setEnv("production");
    const b = await seedBase();
    const subscriberId = uuid();
    const NODE_PRIMARY = uuid(); // origin === serving-primary here (the accepted case)
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = productImage(b);
      const productId = img.id as string;
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId: NODE_PRIMARY,
            table: "products",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(img),
          },
        ],
        { subscriberId, servingPrimaryId: NODE_PRIMARY, ...PROD },
      );
      expect(result).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 }); // origin IS the serving-primary
      expect(await productCount(productId)).toBe("1"); // applied
      expect(await conflicts(NODE_PRIMARY)).toHaveLength(0); // nothing rejected
    } finally {
      await applier.close();
    }
  });

  it("fail-safe: applies a config-class row from any origin when no serving-primary is known", async () => {
    // servingPrimaryId omitted ⇒ the gate is inert: normal config down-flow must never break when the
    // node is not a carrier / has no serving-primary (R-S7-2 fail-safe).
    await setEnv("production");
    const b = await seedBase();
    const subscriberId = uuid();
    const NODE_RETURNED = uuid(); // any origin; the gate is inert with no serving-primary
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = productImage(b);
      const productId = img.id as string;
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId: NODE_RETURNED,
            table: "products",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(img),
          },
        ],
        { subscriberId, ...PROD }, // no servingPrimaryId
      );
      expect(result).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });
      expect(await productCount(productId)).toBe("1"); // applied — gate inert
      expect(await conflicts(NODE_RETURNED)).toHaveLength(0);
    } finally {
      await applier.close();
    }
  });

  it("does NOT reject a non-config-class row from a non-primary origin (dining_tables + working_orders)", async () => {
    // dining_tables (the EXCLUDED mixed table) and a commercial table (working_orders) are runtime,
    // not config-class, so primary-wins does not touch them even from a non-serving-primary origin.
    // This pins R-S7-1's exclusion of dining_tables.
    await setEnv("production");
    const b = await seedBase();
    const subscriberId = uuid();
    const NODE_PRIMARY = uuid(); // the serving-primary this batch is keyed to
    const NODE_RETURNED = uuid(); // the fenced/returned node (≠ serving-primary), fresh per test
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const table = diningTableImage(b);
      const order = workingOrderImage(b, 1);
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId: NODE_RETURNED,
            table: "dining_tables",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(table),
          },
          {
            seq: 2n,
            originId: NODE_RETURNED,
            table: "working_orders",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(order),
          },
        ],
        { subscriberId, servingPrimaryId: NODE_PRIMARY, ...PROD },
      );
      expect(result).toEqual({ applied: 2, deferred: 0, rejected: 0, versionParked: 0 }); // both applied, none rejected
      expect(await tableCount(table.id as string)).toBe("1");
      expect(await workingOrderCount(order.id as string)).toBe("1");
      expect(await conflicts(NODE_RETURNED)).toHaveLength(0); // no config-conflict recorded
    } finally {
      await applier.close();
    }
  });
});
