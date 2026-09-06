import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { captureError, CORE_ENROLMENT } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_ENROLMENT } from "@waitron/identity";
import type { EnrolledTable } from "@waitron/sync-enrolment";
import { applyBatch, type SyncLogRow } from "./apply.js";

// The apply loop consumes an INJECTED enrolment set (SP-2a inversion) — `@waitron/sync` no longer owns
// it. The 17 core-owned tables come from `CORE_ENROLMENT` (`@waitron/db`), and identity's two tables
// (persons/webauthn_credentials) from `IDENTITY_ENROLMENT` — `@waitron/sync` KEEPS its `@waitron/identity`
// dep (peers.ts's scrypt helpers), so importing its enrolment re-adds no coupling. Only the three payments
// tables stay hand-built: `@waitron/payments` was deliberately DROPPED from `@waitron/sync`'s deps by the
// inversion, so importing `PAYMENTS_ENROLMENT` would re-add exactly the coupling the slice removed. These
// three entries are hand-copied to mirror `PAYMENTS_ENROLMENT`, but nothing here ties the hand-copy back to
// the payments schema: `@waitron/payments` is intentionally not a dependency of `@waitron/sync`, so this
// fixture cannot import the schema to self-check, and a payments-schema change would leave this copy stale
// with no guard here to catch it — it must be kept in sync by hand. The authoritative, schema-pinned copy is
// `PAYMENTS_ENROLMENT` in `@waitron/payments`'s own `enrolment.test.ts` (which checks `columns` against
// `getTableColumns` of the real tables); this fixture is a manual mirror of it, not a guarded one.
const NON_CORE_ENROLMENT: readonly EnrolledTable[] = [
  {
    table: "payments",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 3,
    lane: "fast",
    configClass: false,
    columns: [
      "id",
      "tenant_id",
      "working_order_id",
      "sale_id",
      "node_id",
      "provider",
      "payment_ref",
      "external_ref",
      "amount",
      "state",
      "settled_at",
      "reconcile_remediated_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: "payment_refunds",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "fast",
    configClass: false,
    columns: [
      "id",
      "tenant_id",
      "payment_id",
      "provider",
      "payment_ref",
      "amount",
      "state",
      "authorized_by",
      "created_at",
    ],
  },
  {
    table: "payment_policy",
    mode: "watermark-upsert",
    conflictKey: ["tenant_id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
    configClass: true,
    columns: ["tenant_id", "offline_mode", "offline_amount_cap", "created_at", "updated_at"],
  },
  // persons + webauthn_credentials, from the kept @waitron/identity dep (mirrors the ...CORE_ENROLMENT spread).
  ...IDENTITY_ENROLMENT,
];
// The full 22-table set the composition root would assemble, built ONCE at module scope so the apply
// loop's dispatch WeakMap (keyed on the array reference) builds its map a single time across this suite.
const ENROLMENT: readonly EnrolledTable[] = [...CORE_ENROLMENT, ...NON_CORE_ENROLMENT];

// PostgreSQL exercises apply through a non-superuser app_user member, including enrolled-table
// writes, capture suppression and cursor updates. PGlite's superuser sessions cannot check the
// caller's grants. The shared template includes every enrolled table and capture trigger, and
// global setup creates sync_applier once per cluster.
const postgres = useTemplateDb({ template: "manifest" });

const uuid = (): string => randomUUID();

/** Stamps (or re-stamps) the singleton deployment.environment. Every apply test sets this at its
 * start so it does not depend on another test's leftover value (CLAUDE.md order-independence). */
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
  nodeId: string;
  catalogueId: string;
}

/** Seeds a tenant plus the reference parents an enrolled commercial row references — location, till,
 * node, catalogue — as the superuser admin (fixture setup). English fixture values
 * throughout: packages/sync/src is inside the english-only guard (CLAUDE.md §3). */
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
  const tillId = till.rows[0]!.id;
  const node = await admin.execute<{ id: string }>(
    sql`insert into nodes (tenant_id, location_id, name)
        values (${tenantId}, ${locationId}, 'Node') returning id`,
  );
  const nodeId = node.rows[0]!.id;
  const cat = await admin.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
  );
  return { tenantId, locationId, tillId, nodeId, catalogueId: cat.rows[0]!.id };
}

async function seedSeries(b: Base): Promise<string> {
  const s = await postgres.admin.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code)
        values (${b.tenantId}, ${b.nodeId}, 'A') returning id`,
  );
  return s.rows[0]!.id;
}

/** An OPEN working order (status defaults to 'open'). */
async function seedWorkingOrder(b: Base, orderNumber: number): Promise<string> {
  const wo = await postgres.admin.execute<{ id: string }>(
    sql`insert into working_orders (tenant_id, till_id, order_number)
        values (${b.tenantId}, ${b.tillId}, ${orderNumber}) returning id`,
  );
  return wo.rows[0]!.id;
}

async function seedProduct(b: Base): Promise<string> {
  const p = await postgres.admin.execute<{ id: string }>(
    sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (${b.tenantId}, ${b.catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', '1.30', 'general')
        returning id`,
  );
  return p.rows[0]!.id;
}

async function seedLine(
  b: Base,
  orderId: string,
  productId: string,
  lineNo: number,
): Promise<string> {
  const l = await postgres.admin.execute<{ id: string }>(
    sql`insert into working_order_lines
          (tenant_id, working_order_id, line_no, product_id, descriptions,
           quantity, unit_price, unit_price_gross, vat_rate, line_total)
        values (${b.tenantId}, ${orderId}, ${lineNo}, ${productId}, '{"en":"Coffee"}'::jsonb,
                '1.000', '1.30', '1.43', '10.00', '1.30') returning id`,
  );
  return l.rows[0]!.id;
}

type Image = Record<string, unknown>;

/** The wire shape: row_image travels as the source's raw `row_image::text` — a STRING — so JS never
 * re-quotes a numeric (design §4b). Tests serialise their fixture object the way `to_jsonb(row)::text`
 * would; `readSyncLogSince` (Task 5) does the same on the source. */
const wire = (image: Image): string => JSON.stringify(image);

/** A complete `sales` row_image — every NOT NULL column present, valid against every CHECK — exactly
 * the shape `to_jsonb(sales)` would capture. jsonb_populate_record restores it on apply. */
function saleImage(b: Base, seriesId: string, invoiceNumber: number, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    till_id: b.tillId,
    series_id: seriesId,
    node_id: b.nodeId,
    invoice_number: invoiceNumber,
    issued_at: "2026-08-11T10:00:00+00:00",
    issued_offset_minutes: 60,
    total: "10.00",
    vat_breakdown: [],
    locale: "en",
    invoice_locales: ["en"],
    fiscal_backend: "fake",
    fiscal_state: "not_applicable",
    corrects_sale_id: null,
    counterparty_tax_id: null,
    counterparty_legal_name: null,
    counterparty_country_code: null,
    authorized_by: null,
    operator_id: null,
    working_order_id: null,
    ...over,
  };
}

function saleLineImage(b: Base, saleId: string, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    sale_id: saleId,
    line_no: 1,
    descriptions: { en: "Coffee" },
    quantity: "1.000",
    unit_price: "10.00",
    vat_rate: "21.00",
    line_total: "10.00",
    category: null,
    ...over,
  };
}

function paymentImage(b: Base, workingOrderId: string, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    working_order_id: workingOrderId,
    sale_id: null,
    node_id: null,
    provider: "fake",
    payment_ref: uuid(),
    external_ref: null,
    amount: "10.00",
    state: "captured",
    settled_at: null,
    reconcile_remediated_at: null,
    created_at: "2026-08-11T10:00:00+00:00",
    updated_at: "2026-08-11T10:00:00+00:00",
    ...over,
  };
}

// The C1 table-service floor closure that working_orders.delivery_table_id depends on. Each helper
// lists EVERY column of its table (to_jsonb captures all; jsonb_populate_record fills an absent key
// with NULL, so an omitted NOT NULL column would fail the apply). Columns verified against the live
// Drizzle schema (floor-zones.ts, table-service-statuses.ts, dining-tables.ts).
function floorZoneImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    location_id: b.locationId,
    name: "Dining Room",
    display_order: 0,
    active: true,
    created_at: "2026-08-27T10:00:00+00:00",
    ...over,
  };
}
function statusImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    label: "Needs cleaning",
    color: "#ef4444",
    display_order: 0,
    active: true,
    created_at: "2026-08-27T10:00:00+00:00",
    ...over,
  };
}
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
function workingOrderImage(b: Base, orderNumber: number, over: Image = {}): Image {
  // status 'open' ⇒ settled_at must be NULL (the working_orders_settled_at_ck CHECK). INSERT of an
  // open order is not a status transition, so working_orders_enforce_transition (BEFORE UPDATE) does
  // not fire here.
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

// The kitchen KDS closure this slice enrols (spec 2026-09-02-sync-kitchen-enrolment-design.md §2/§3).
// Each helper lists EVERY column of its table (to_jsonb captures all; jsonb_populate_record fills an
// absent key with NULL, so an omitted NOT NULL column would fail the apply). Columns verified against
// the live Drizzle schema (kitchen-stations.ts, kitchen-courses.ts, ticket-items.ts).
function kitchenStationImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    location_id: b.locationId,
    name: "Cocina",
    display_order: 0,
    warm_after_minutes: 5,
    overdue_after_minutes: 10,
    forgotten_after_minutes: 15,
    is_default: false,
    active: true,
    created_at: "2026-09-02T10:00:00+00:00",
    ...over,
  };
}
function kitchenCourseImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    location_id: b.locationId,
    name: "Entrantes",
    display_order: 0,
    active: true,
    created_at: "2026-09-02T10:00:00+00:00",
    ...over,
  };
}
// A routed product: station_id/course_id set via `over` point at an enrolled kitchen parent (spec §1's
// 23503 gate). All the nullable jsonb columns (allergens/diet/…) travel as NULL, exactly as to_jsonb
// of a freshly-seeded product captures them.
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
// A fired kitchen ticket item. Its NOT NULL FK columns (working_order_id/working_order_line_id/
// station_id) MUST be supplied via `over`; node_id defaults to the seeded node. Verified against
// ticket-items.ts (the queued_at default + the nullable lifecycle timestamps).
function ticketItemImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    node_id: b.nodeId,
    working_order_id: null,
    working_order_line_id: null,
    station_id: null,
    state: "queued",
    queued_at: "2026-09-02T10:00:00+00:00",
    preparing_at: null,
    ready_at: null,
    course_id: null,
    fired_at: null,
    away_at: null,
    note: null,
    doneness: null,
    ...over,
  };
}

// Admin read-backs of the mirror's actual stored state.
async function scalar(query: ReturnType<typeof sql>): Promise<string | null> {
  const r = await postgres.admin.execute<{ v: string | null }>(query);
  return r.rows[0]?.v ?? null;
}
const saleTotal = (id: string) => scalar(sql`select total::text as v from sales where id = ${id}`);
// The first element of the jsonb vat_breakdown as text — a jsonb column stores its numeric verbatim
// (scale preserved), unlike a fixed-scale numeric column, so this is where byte-identity is visible.
const saleVat0 = (id: string) =>
  scalar(sql`select vat_breakdown->>0 as v from sales where id = ${id}`);
const saleCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from sales where id = ${id}`);
const saleLineCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from sale_lines where id = ${id}`);
const lineCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from working_order_lines where id = ${id}`);
const paymentState = (id: string) => scalar(sql`select state as v from payments where id = ${id}`);
const woStatus = (id: string) =>
  scalar(sql`select status as v from working_orders where id = ${id}`);

/** Reads one lane's cursor for (subscriber, origin), or 0n when absent — the admin read-back. With
 * separate lanes each (subscriber, origin) can have two cursor rows, so a lane must be named. */
async function laneCursor(subscriberId: string, originId: string, lane: string): Promise<bigint> {
  const r = await postgres.admin.execute<{ seq: string | null }>(
    sql`select last_applied_seq::text as seq from sync_cursor
        where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid and lane = ${lane}`,
  );
  return r.rows[0]?.seq ? BigInt(r.rows[0].seq) : 0n;
}

const PROD = {
  localEnvironment: "production",
  sourceEnvironment: "production",
  enrolments: ENROLMENT,
  // SP-2b gate opts: inert here (sourceModuleVersions absent → gate disabled), so empty no-op values.
  subscriberModuleVersions: {},
  moduleByTable: new Map<string, string>(),
} as const;

describe("the commercial-lane apply loop", () => {
  it("append-only INSERT is idempotent: a re-delivery carrying different bytes is a no-op", async () => {
    // Failing case: ON CONFLICT DO NOTHING is missing and the second, different image overwrites the
    // stored append-only row. Control (a first delivery and a re-delivery visibly differ, CLAUDE.md
    // §1): applied is 1 then 0, and the stored total stays the first one.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = saleImage(b, seriesId, 1, { total: "10.00" });
      const saleId = img.id as string;
      const first = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(img),
          },
        ],
        { subscriberId, ...PROD },
      );
      expect(first).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });

      // The SAME id at a HIGHER seq (so the seq cursor does not mask it — this isolates ON CONFLICT
      // DO NOTHING) carrying a DIFFERENT total.
      const repeat = await applyBatch(
        applier,
        [
          {
            seq: 2n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire({ ...img, total: "999.99" }),
          },
        ],
        { subscriberId, ...PROD },
      );
      expect(repeat).toEqual({ applied: 0, deferred: 0, rejected: 0, versionParked: 0 });

      expect(await saleTotal(saleId)).toBe("10.00"); // unchanged — the different bytes did NOT overwrite
      expect(await saleCount(saleId)).toBe("1"); // exactly one row, never a duplicate
    } finally {
      await applier.close();
    }
  });

  it("watermark upsert never regresses: an older/equal image is a no-op, a newer one moves the row", async () => {
    // Failing case: a late older image regresses the mirror. Control: the NEWER image DID move the
    // row (captured→refunded); the older and equal ones do not (state stays refunded).
    await setEnv("production");
    const b = await seedBase();
    const woId = await seedWorkingOrder(b, 1);
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const id = uuid();
      const ref = uuid();
      const key = { id, payment_ref: ref };
      const t0 = "2026-08-11T09:00:00+00:00";
      const t1 = "2026-08-11T10:00:00+00:00";
      const t2 = "2026-08-11T11:00:00+00:00";
      const deliver = (seq: bigint, op: SyncLogRow["op"], over: Image) =>
        applyBatch(
          applier,
          [
            {
              seq,
              originId,
              table: "payments",
              op,
              tenantId: b.tenantId,
              rowImage: wire(paymentImage(b, woId, { ...key, ...over })),
            },
          ],
          { subscriberId, ...PROD },
        );

      // seqs strictly ascending, so the cursor never masks the watermark WHERE guard.
      expect((await deliver(1n, "insert", { state: "captured", updated_at: t1 })).applied).toBe(1);
      expect((await deliver(2n, "update", { state: "refunded", updated_at: t2 })).applied).toBe(1);
      expect(await paymentState(id)).toBe("refunded"); // the newer image moved it (the control)
      expect((await deliver(3n, "update", { state: "voided", updated_at: t0 })).applied).toBe(0);
      expect(await paymentState(id)).toBe("refunded"); // older image: no regression
      expect((await deliver(4n, "update", { state: "voided", updated_at: t2 })).applied).toBe(0);
      expect(await paymentState(id)).toBe("refunded"); // equal image: strictly-greater guard holds
    } finally {
      await applier.close();
    }
  });

  it("Group C: the seq cursor refuses an older seq, and a DELETE is idempotent", async () => {
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const opts = { subscriberId, ...PROD };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // (a) working_orders insert (seq1) then update open→placed (seq2): both land (Group C's
      // unconditional upsert). watermarkColumn is null, so non-regression rests on the seq cursor.
      const woId = uuid();
      expect(
        (
          await applyBatch(
            applier,
            [
              {
                seq: 1n,
                originId,
                table: "working_orders",
                op: "insert",
                tenantId: b.tenantId,
                rowImage: wire(workingOrderImage(b, 1, { id: woId, status: "open" })),
              },
            ],
            opts,
          )
        ).applied,
      ).toBe(1);
      expect(
        (
          await applyBatch(
            applier,
            [
              {
                seq: 2n,
                originId,
                table: "working_orders",
                op: "update",
                tenantId: b.tenantId,
                rowImage: wire(workingOrderImage(b, 1, { id: woId, status: "placed" })),
              },
            ],
            opts,
          )
        ).applied,
      ).toBe(1);
      expect(await woStatus(woId)).toBe("placed");

      // Re-apply the OLDER seq (seq1, the 'open' image): refused by the cursor — a clean no-op.
      // Failing case: without the seq cursor this unconditional Group-C upsert re-runs; here the
      // state machine would even reject placed→open, so the cursor turns a would-be error into a
      // silent idempotent skip (applied 0, no change).
      const replay = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "working_orders",
            op: "update",
            tenantId: b.tenantId,
            rowImage: wire(workingOrderImage(b, 1, { id: woId, status: "open" })),
          },
        ],
        opts,
      );
      expect(replay.applied).toBe(0);
      expect(await woStatus(woId)).toBe("placed"); // unchanged — the cursor refused the older seq

      // (b) DELETE of a working_order_lines row on a SEPARATE open order.
      const openWo = await seedWorkingOrder(b, 2);
      const productId = await seedProduct(b);
      const lineId = await seedLine(b, openWo, productId, 1);
      const del = await applyBatch(
        applier,
        [
          {
            seq: 3n,
            originId,
            table: "working_order_lines",
            op: "delete",
            tenantId: b.tenantId,
            rowImage: wire({ id: lineId, tenant_id: b.tenantId }),
          },
        ],
        opts,
      );
      expect(del.applied).toBe(1);
      expect(await lineCount(lineId)).toBe("0"); // the line is gone

      // Re-apply the SAME delete at a higher seq (so the cursor does not mask it): a 0-row no-op.
      const delAgain = await applyBatch(
        applier,
        [
          {
            seq: 4n,
            originId,
            table: "working_order_lines",
            op: "delete",
            tenantId: b.tenantId,
            rowImage: wire({ id: lineId, tenant_id: b.tenantId }),
          },
        ],
        opts,
      );
      expect(delAgain.applied).toBe(0); // idempotent — the row was already absent
    } finally {
      await applier.close();
    }
  });

  it("seq order preserves FK across a batch; shuffling a child before its parent defers then lands it", async () => {
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const opts = { subscriberId, ...PROD };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // In seq order: parent sale (seq1) then its child line (seq2) → zero 23503 (seq order IS a
      // topological order of the FK graph, gate 4).
      const parentSale = saleImage(b, seriesId, 1);
      const inOrder = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(parentSale),
          },
          {
            seq: 2n,
            originId,
            table: "sale_lines",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(saleLineImage(b, parentSale.id as string)),
          },
        ],
        opts,
      );
      expect(inOrder).toEqual({ applied: 2, deferred: 0, rejected: 0, versionParked: 0 });

      // Control (the other direction): shuffle the child BELOW its parent — line at seq3, sale at
      // seq4. Applied ascending, the line hits its absent parent → 23503 → parked; the sale lands;
      // the retry lands the parked line. deferred >= 1 and the final state is correct.
      const laterSale = saleImage(b, seriesId, 2);
      const laterLine = saleLineImage(b, laterSale.id as string);
      const shuffled = await applyBatch(
        applier,
        [
          {
            seq: 3n,
            originId,
            table: "sale_lines",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(laterLine),
          },
          {
            seq: 4n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(laterSale),
          },
        ],
        opts,
      );
      expect(shuffled.applied).toBe(2);
      expect(shuffled.deferred).toBe(1); // the child was parked once
      expect(await saleCount(laterSale.id as string)).toBe("1");
      expect(await saleLineCount(laterLine.id as string)).toBe("1"); // landed AFTER its parent
    } finally {
      await applier.close();
    }
  });

  it("holds the cursor below a permanently-parked row while advancing past the settled ones", async () => {
    // A child whose parent is neither in the batch nor in the mirror stays parked forever: the apply
    // path never drops the FK or widens a grant to force it in (CLAUDE.md §3). The cursor advances to
    // the settled parent but is HELD below the gap, so a later batch redelivers the child
    // (at-least-once).
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const goodSale = saleImage(b, seriesId, 1);
      const orphanLine = saleLineImage(b, uuid()); // sale_id → a sale that will never exist
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(goodSale),
          },
          {
            seq: 2n,
            originId,
            table: "sale_lines",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(orphanLine),
          },
        ],
        { subscriberId, ...PROD },
      );
      expect(result).toEqual({ applied: 1, deferred: 1, rejected: 0, versionParked: 0 });
      expect(await saleCount(goodSale.id as string)).toBe("1");
      expect(await saleLineCount(orphanLine.id as string)).toBe("0"); // never forced in
      const cursor = await postgres.admin.execute<{ seq: string }>(
        sql`select last_applied_seq::text as seq from sync_cursor
            where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid`,
      );
      expect(cursor.rows[0]!.seq).toBe("1"); // advanced past 1, held below the gap at 2
    } finally {
      await applier.close();
    }
  });

  it("refuses a mismatched source environment before any row applies, in both directions", async () => {
    // Failing case: a peer in a different environment applies a row before the mismatch is caught,
    // burning a preproduction record into a production series (unrecoverable, CLAUDE.md §5) — or the
    // guard fires in only one direction.
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // Production mirror refuses a preproduction source.
      await setEnv("production");
      const b1 = await seedBase();
      const s1 = await seedSeries(b1);
      const imgA = saleImage(b1, s1, 1);
      const rowA: SyncLogRow = {
        seq: 1n,
        originId: uuid(),
        table: "sales",
        op: "insert",
        tenantId: b1.tenantId,
        rowImage: wire(imgA),
      };
      const sub1 = uuid();
      const refusedA = await captureError(() =>
        applyBatch(applier, [rowA], {
          subscriberId: sub1,
          localEnvironment: "production",
          sourceEnvironment: "preproduction",
          enrolments: ENROLMENT,
          subscriberModuleVersions: {},
          moduleByTable: new Map<string, string>(),
        }),
      );
      expect(refusedA).toBeInstanceOf(AppError);
      expect((refusedA as AppError).code).toBe("sync.peer_environment_mismatch");
      expect((refusedA as AppError).params).toEqual({ local: "production", peer: "preproduction" });
      expect(await saleCount(imgA.id as string)).toBe("0"); // nothing applied
      // The matching direction applies.
      const matchedA = await applyBatch(applier, [rowA], { subscriberId: sub1, ...PROD });
      expect(matchedA.applied).toBe(1);
      expect(await saleCount(imgA.id as string)).toBe("1");

      // Preproduction mirror refuses a production source (the other direction).
      await setEnv("preproduction");
      const b2 = await seedBase();
      const s2 = await seedSeries(b2);
      const imgB = saleImage(b2, s2, 1);
      const rowB: SyncLogRow = {
        seq: 1n,
        originId: uuid(),
        table: "sales",
        op: "insert",
        tenantId: b2.tenantId,
        rowImage: wire(imgB),
      };
      const sub2 = uuid();
      const refusedB = await captureError(() =>
        applyBatch(applier, [rowB], {
          subscriberId: sub2,
          localEnvironment: "preproduction",
          sourceEnvironment: "production",
          enrolments: ENROLMENT,
          subscriberModuleVersions: {},
          moduleByTable: new Map<string, string>(),
        }),
      );
      expect(refusedB).toBeInstanceOf(AppError);
      expect((refusedB as AppError).code).toBe("sync.peer_environment_mismatch");
      expect((refusedB as AppError).params).toEqual({ local: "preproduction", peer: "production" });
      expect(await saleCount(imgB.id as string)).toBe("0");
      const matchedB = await applyBatch(applier, [rowB], {
        subscriberId: sub2,
        localEnvironment: "preproduction",
        sourceEnvironment: "preproduction",
        enrolments: ENROLMENT,
        subscriberModuleVersions: {},
        moduleByTable: new Map<string, string>(),
      });
      expect(matchedB.applied).toBe(1);
    } finally {
      await applier.close();
    }
  });

  it("applies verbatim numeric and jsonb values under app_user", async () => {
    await setEnv("production");
    const mirror = await seedBase(); // tenant B — the applying scope
    const seriesId = await seedSeries(mirror);
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // Verbatim: a same-tenant sale carrying a distinctive numeric total and a jsonb vat_breakdown.
      // Failing case: apply recomputes or re-quotes a value so the mirror drifts from the source.
      const img = saleImage(mirror, seriesId, 1, {
        total: "123.45",
        vat_breakdown: [{ rate: "21.00", base: "102.02", tax: "21.43" }],
      });
      const saleId = img.id as string;
      const applied = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: mirror.tenantId,
            rowImage: wire(img),
          },
        ],
        { subscriberId, ...PROD },
      );
      expect(applied.applied).toBe(1);
      const rb = await postgres.admin.execute<{
        total: string;
        vat: { rate: string; base: string; tax: string }[];
      }>(sql`select total::text as total, vat_breakdown as vat from sales where id = ${saleId}`);
      expect(rb.rows[0]!.total).toBe("123.45"); // numeric round-trips to the exact string
      expect(rb.rows[0]!.vat).toEqual([{ rate: "21.00", base: "102.02", tax: "21.43" }]); // jsonb exact
    } finally {
      await applier.close();
    }
  });

  it("refuses to apply into a mirror that carries no deployment.environment stamp", async () => {
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // Remove the stamp, probe, then restore it in a finally so this test is order-independent
      // (every other apply test re-stamps at its start anyway).
      await postgres.admin.execute(sql`delete from deployment`);
      try {
        const err = await captureError(() =>
          applyBatch(applier, [], { subscriberId: uuid(), ...PROD }),
        );
        expect((err as Error).message).toContain("no deployment.environment stamp");
      } finally {
        await setEnv("production");
      }
    } finally {
      await applier.close();
    }
  });

  it("refuses when the caller's localEnvironment disagrees with the DB stamp", async () => {
    await setEnv("production");
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const err = await captureError(() =>
        applyBatch(applier, [], {
          subscriberId: uuid(),
          localEnvironment: "preproduction",
          sourceEnvironment: "preproduction",
          enrolments: ENROLMENT,
          subscriberModuleVersions: {},
          moduleByTable: new Map<string, string>(),
        }),
      );
      expect((err as Error).message).toContain("disagrees with the stamped");
    } finally {
      await applier.close();
    }
  });

  it("throws sync.table_not_enrolled for a row naming a table the registry does not carry", async () => {
    // Also an H2 guard that a hash-chained / fiscal-adjacent table is not enrollable: order_amendments
    // (a SHA-256 chain, spec §2 defers it with the owner-reviewed lane), like the fiscal core's
    // registros_facturacion (spec §1 defers the whole fiscal lane), has no apply statement here — so a
    // row naming any unenrolled table is a hard error, never a silent skip. The table name in code is
    // the deliberately English-named order_amendments so @waitron/sync stays inside the english-only
    // guard (CLAUDE.md §3); the mechanism it exercises rejects every unenrolled table alike.
    await setEnv("production");
    const b = await seedBase();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const err = await captureError(() =>
        applyBatch(
          applier,
          [
            {
              seq: 1n,
              originId: uuid(),
              table: "order_amendments",
              op: "insert",
              tenantId: b.tenantId,
              rowImage: wire({ id: uuid() }),
            },
          ],
          { subscriberId: uuid(), ...PROD },
        ),
      );
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("sync.table_not_enrolled");
      expect((err as AppError).params).toEqual({ table: "order_amendments" });
    } finally {
      await applier.close();
    }
  });

  it("applies a numeric via raw jsonb TEXT byte-identically; a JS round-trip would corrupt 1.50 to 1.5", async () => {
    // Failing case (current code JSON.stringify's row.rowImage): passing the raw jsonb TEXT double-
    // encodes it into a jsonb STRING scalar, so jsonb_populate_record gets a scalar not an object and
    // the sale never lands ("cannot call populate_composite on a scalar"). The byte-identity property
    // (design §4b, findings (ii)): a numeric captured as a JSON *number* with its scale (1.50) survives
    // apply verbatim only if JS never JSON.parses it. It is observable where the value is stored
    // VERBATIM — a jsonb column (sales.vat_breakdown) — NOT in a fixed-scale numeric column like
    // sales.total, which normalises both 1.5 and 1.50 to the same "1.50" and so cannot tell them apart.
    // That is exactly why the guarantee must live in the wire (raw text), not lean on the column type.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // Build the SOURCE's row_image::text with vat_breakdown carrying a JSON *number* 1.50 (scale
      // preserved), NOT the string "1.50" — via Postgres so the test uses real canonical jsonb, exactly
      // what to_jsonb(row)::text emits.
      const img = saleImage(b, seriesId, 1); // object, vat_breakdown:[]
      const built = await postgres.admin.execute<{ t: string }>(
        sql`select jsonb_set(${JSON.stringify(img)}::jsonb, '{vat_breakdown}',
                   jsonb_build_array(to_jsonb(1.50::numeric(12,2))))::text as t`,
      );
      const rowImageText = built.rows[0]!.t; // {..., "vat_breakdown":[1.50], ...} — 1.50 is a JSON number
      const raw = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: rowImageText,
          },
        ],
        { subscriberId: uuid(), ...PROD },
      );
      expect(raw.applied).toBe(1);
      expect(await saleVat0(img.id as string)).toBe("1.50"); // jsonb preserved the scale through $1::jsonb

      // Control (the two directions visibly differ, CLAUDE.md §1): a JS round-trip of the SAME text
      // collapses 1.50 -> 1.5, so the mirror's jsonb would store "1.5". A different sale id, fresh insert.
      const jsCorrupted = saleImage(b, seriesId, 2);
      const corruptedText = JSON.stringify({
        ...JSON.parse(rowImageText),
        id: jsCorrupted.id,
        invoice_number: 2,
      });
      await applyBatch(
        applier,
        [
          {
            seq: 2n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: corruptedText,
          },
        ],
        { subscriberId: uuid(), ...PROD },
      );
      expect(await saleVat0(jsCorrupted.id as string)).toBe("1.5"); // JS parse dropped the trailing zero
    } finally {
      await applier.close();
    }
  });
});

describe("the fast and ordered lanes advance independent cursors (spec §4e)", () => {
  it("a fast apply advances ONLY the fast cursor and never drags the ordered lane past an un-applied lower seq", async () => {
    // Two lanes read the same sync_log ordered by the same seq, but a fast pull (lane 'fast') advances
    // only the fast cursor row. With ONE shared cursor, a fast apply to seq 5 would make the ordered
    // lane skip an un-applied ordered row at seq 3 — silent data loss (spec §4e). Separate lane cursors
    // remove that: apply a payments row (fast) at seq 5, then a sales row (ordered) at the LOWER seq 3,
    // and the sales row still lands (the ordered cursor started at 0, independent of the fast cursor).
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const woId = await seedWorkingOrder(b, 1); // the payments FK parent, seeded so the fast row lands
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // FAST: a payments row at seq 5 → advances the fast cursor to 5, leaves the ordered cursor at 0.
      const pay = paymentImage(b, woId);
      const fast = await applyBatch(
        applier,
        [
          {
            seq: 5n,
            originId,
            table: "payments",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(pay),
          },
        ],
        { subscriberId, ...PROD, lane: "fast" },
      );
      expect(fast.applied).toBe(1);
      expect(await laneCursor(subscriberId, originId, "fast")).toBe(5n);
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // untouched

      // ORDERED: a sales row at the LOWER seq 3. A shared cursor at 5 would SKIP it (3 <= 5) — the
      // data-loss bug. With an independent ordered cursor (still 0) it applies.
      const sale = saleImage(b, seriesId, 1);
      const ordered = await applyBatch(
        applier,
        [
          {
            seq: 3n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(sale),
          },
        ],
        { subscriberId, ...PROD, lane: "ordered" },
      );
      expect(ordered.applied).toBe(1); // NOT skipped — the ordered lane's own cursor was 0
      expect(await saleCount(sale.id as string)).toBe("1");
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(3n);
      expect(await laneCursor(subscriberId, originId, "fast")).toBe(5n); // fast still 5 — lanes disjoint
    } finally {
      await applier.close();
    }
  });

  it("a fast payments row whose ordered working_orders parent is absent parks, holds the fast cursor, and lands on redelivery", async () => {
    // payments.working_order_id is NOT NULL → working_orders (payments' schema, payments.ts),
    // and working_orders is an ORDERED-lane table. So a fast payments row can arrive before its parent.
    // The pre-existing 23503 park (apply.ts's tryApplyRow + the retry pass) holds the fast cursor below
    // it; the in-batch retry cannot land it (the parent is never in a fast batch); a later fast pull
    // redelivers it, and it lands once the parent exists. No new code — this proves the cross-lane case
    // reuses the backstop.
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const woId = uuid(); // a working_orders id NOT yet present on the mirror
    const pay = paymentImage(b, woId);
    const batch: SyncLogRow[] = [
      {
        seq: 4n,
        originId,
        table: "payments",
        op: "insert",
        tenantId: b.tenantId,
        rowImage: wire(pay),
      },
    ];
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // Parent absent → 23503 → parked. applied 0, deferred 1, fast cursor NOT advanced.
      const parked = await applyBatch(applier, batch, { subscriberId, ...PROD, lane: "fast" });
      expect(parked.applied).toBe(0);
      expect(parked.deferred).toBe(1);
      expect(await laneCursor(subscriberId, originId, "fast")).toBe(0n); // held below the parked seq
      const absent = await postgres.admin.execute<{ v: string }>(
        sql`select count(*)::int::text as v from payments where id = ${pay.id as string}`,
      );
      expect(absent.rows[0]!.v).toBe("0"); // nothing applied

      // The ordered lane delivers the parent (seed it — the FK resolves once the parent exists, exactly
      // as the ordered lane applying a working_orders row would leave the mirror).
      await postgres.admin.execute(
        sql`insert into working_orders (id, tenant_id, till_id, order_number)
            values (${woId}, ${b.tenantId}, ${b.tillId}, 99)`,
      );

      // Redeliver the SAME fast batch → now lands. applied 1, fast cursor advances.
      const landed = await applyBatch(applier, batch, { subscriberId, ...PROD, lane: "fast" });
      expect(landed.applied).toBe(1);
      expect(await laneCursor(subscriberId, originId, "fast")).toBe(4n);
      const present = await postgres.admin.execute<{ v: string }>(
        sql`select count(*)::int::text as v from payments where id = ${pay.id as string}`,
      );
      expect(present.rows[0]!.v).toBe("1"); // landed once the parent arrived
    } finally {
      await applier.close();
    }
  });
});

describe("C1 — the dining_tables FK-closure enrolment (the ordered-lane hard gate)", () => {
  it("a counter-delivery working_order applies with no park once its dining_tables closure is enrolled", async () => {
    // Failing case (proven by deletion): drop the dining_tables entry from the injected enrolment set
    // (CORE_ENROLMENT, in @waitron/db) and re-run —
    // applyBatch throws sync.table_not_enrolled on the dining_tables row (DISPATCH has no entry), so the
    // whole batch fails. Restore → this passes. That is the C1 gate made a test.
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const zone = floorZoneImage(b);
      const status = statusImage(b);
      const table = diningTableImage(b, { zone_id: zone.id, status_id: status.id });
      const order = workingOrderImage(b, 1, { delivery_table_id: table.id });
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "floor_zones",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(zone),
        },
        {
          seq: 2n,
          originId,
          table: "table_service_statuses",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(status),
        },
        {
          seq: 3n,
          originId,
          table: "dining_tables",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(table),
        },
        {
          seq: 4n,
          originId,
          table: "working_orders",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(order),
        },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 4, deferred: 0, rejected: 0, versionParked: 0 }); // all four landed, nothing parked
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(4n); // cursor advanced past them
      // The delivery order is present AND still points at the mirrored table.
      const back = await scalar(
        sql`select delivery_table_id::text as v from working_orders where id = ${order.id as string}`,
      );
      expect(back).toBe(table.id);
    } finally {
      await applier.close();
    }
  });

  it("negative control: without the dining_tables parent, the delivery working_order parks on 23503 and holds the cursor", async () => {
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // A dining_table that is NEVER applied: this models an ABSENT FK PARENT (the 23503 park path),
      // NOT the literal "not enrolled" case — that is the inline proven-by-deletion above, which
      // throws sync.table_not_enrolled when dining_tables is dropped from the injected enrolment set.
      const missingTableId = uuid();
      const order = workingOrderImage(b, 2, { delivery_table_id: missingTableId });
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "working_orders",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(order),
        },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 0, deferred: 1, rejected: 0, versionParked: 0 }); // parked on the absent FK parent
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // cursor held below it
      expect(
        await scalar(
          sql`select count(*)::int::text as v from working_orders where id = ${order.id as string}`,
        ),
      ).toBe("0"); // never inserted
    } finally {
      await applier.close();
    }
  });

  it("negative control: a dining_table carrying an un-applied zone parks — floor_zones enrolment is forced (spec §2)", async () => {
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // A floor_zone that is NEVER applied: the dining_table's (tenant_id, zone_id) → floor_zones FK
      // (both columns non-null, so MATCH SIMPLE checks it) finds no parent → 23503 park. This is why
      // enrolling dining_tables FORCES enrolling floor_zones (spec §2's forced closure): a zoned table
      // would stall the ordered lane without its zone parent, the same way an un-enrolled dining_tables
      // stalls the working_order above. The spec §6 second deletion control, as a park test.
      const missingZoneId = uuid();
      const table = diningTableImage(b, { zone_id: missingZoneId });
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "dining_tables",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(table),
        },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 0, deferred: 1, rejected: 0, versionParked: 0 }); // parked on the absent floor_zones parent
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // cursor held below it
      expect(
        await scalar(
          sql`select count(*)::int::text as v from dining_tables where id = ${table.id as string}`,
        ),
      ).toBe("0"); // never inserted
    } finally {
      await applier.close();
    }
  });

  it("replicates a settle's status clear: the working_orders→dining_tables cascade applies and echo-suppresses", async () => {
    // Models the REAL source→mirror flow for a tab settling on a laid-out floor. On the SOURCE a single
    // settle UPDATE of the working_order fires working_orders_clear_table_status
    // (packages/db/drizzle/0001_db_baseline_sql.sql:389-393 — AFTER UPDATE, NOT gated on
    // app.sync_apply), which cascades `UPDATE dining_tables SET status_id = NULL WHERE tab_id = NEW.id`
    // (0001_db_baseline_sql.sql:381-384). Because working_orders_capture fires before
    // working_orders_clear_table_status (alphabetical trigger order), the source captures BOTH — a working_orders UPDATE (status=settled)
    // at the LOWER seq and the cascaded dining_tables UPDATE (status_id=NULL) at the higher. This asserts
    // a DR mirror converges on applying that batch.
    //
    // On the apply path applyBatch sets app.sync_apply='on' (apply.ts:298-312), so the BEFORE-UPDATE
    // working_orders_enforce_transition is gated OFF (0037 — the settle applies verbatim) while the
    // AFTER-UPDATE 0050 cascade is NOT gated → it fires locally and clears the mirror's status_id, and
    // the dining_tables_capture WHEN clause (0006, IS DISTINCT FROM 'on') echo-suppresses that cascaded
    // write so it is not re-captured. The 0050 comment defers exactly this to "a future replication
    // slice" (0050:32) — C1 is that slice.
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // Pre-state on the mirror: an OPEN tab whose dining_table is occupied (tab_id → the order) and
      // carries a manual status. Seed the FK-parents first — the open working_order
      // (dining_tables.tab_id → it) and the status (dining_tables.status_id → it) — THEN the
      // dining_table, respecting the dining_tables.tab_id → working_orders FK ordering.
      const woId = await seedWorkingOrder(b, 1); // open
      const statusRes = await postgres.admin.execute<{ id: string }>(
        sql`insert into table_service_statuses (tenant_id, label, color)
            values (${b.tenantId}, 'Bill requested', '#f59e0b') returning id`,
      );
      const statusId = statusRes.rows[0]!.id;
      const tableRes = await postgres.admin.execute<{ id: string }>(
        sql`insert into dining_tables (tenant_id, location_id, label, tab_id, status_id)
            values (${b.tenantId}, ${b.locationId}, 'T1', ${woId}, ${statusId}) returning id`,
      );
      const tableId = tableRes.rows[0]!.id;

      const tableStatusId = () =>
        scalar(sql`select status_id::text as v from dining_tables where id = ${tableId}`);
      const syncLogCount = () =>
        scalar(sql`select count(*)::int::text as v from sync_log where tenant_id = ${b.tenantId}`);

      // Control (the other direction): the table carries the status BEFORE the settle arrives.
      expect(await tableStatusId()).toBe(statusId);

      // The settle batch the source captured: the working_orders UPDATE (open→settled, settled_at set to
      // satisfy working_orders_settled_at_ck) at the lower seq, then the cascaded dining_tables UPDATE
      // (status_id cleared, tab_id left set — 0050 clears only status_id) at the higher seq.
      const settledOrder = workingOrderImage(b, 1, {
        id: woId,
        status: "settled",
        settled_at: "2026-08-27T12:00:00+00:00",
      });
      const clearedTable = diningTableImage(b, {
        id: tableId,
        tab_id: woId,
        status_id: null,
        zone_id: null,
      });
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "working_orders",
          op: "update",
          tenantId: b.tenantId,
          rowImage: wire(settledOrder),
        },
        {
          seq: 2n,
          originId,
          table: "dining_tables",
          op: "update",
          tenantId: b.tenantId,
          rowImage: wire(clearedTable),
        },
      ];

      const before = await syncLogCount();
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 2, deferred: 0, rejected: 0, versionParked: 0 }); // both landed, nothing parked (wedge-free)
      expect(await woStatus(woId)).toBe("settled"); // the settle applied verbatim (transition gated off)
      // Converged to cleared: the local 0050 cascade (firing on the seq-1 settle apply) and the captured
      // seq-2 dining_tables UPDATE are the same idempotent status clear — this asserts convergence, not
      // which of the two cleared it; the load-bearing claims are the wedge-freedom (applied:2/deferred:0)
      // and no-recapture (syncLogCount) checks around it.
      expect(await tableStatusId()).toBeNull();
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(2n); // cursor advanced past both
      expect(await syncLogCount()).toBe(before); // echo suppressed — apply captured no new sync_log row
    } finally {
      await applier.close();
    }
  });
});

describe("kitchen-sync enrolment (the ordered-lane gate)", () => {
  it("a routed products row applies with no park once its kitchen closure is enrolled", async () => {
    // Failing case (proven by deletion): drop the kitchen_stations (or kitchen_courses) entry from the
    // injected enrolment set (CORE_ENROLMENT) and re-run — applyBatch throws sync.table_not_enrolled on
    // that kitchen row (DISPATCH has
    // no entry), so the whole batch fails. Restore → this passes. That is spec §1's hard gate made a
    // test: a menu whose products are routed to a station/course would stall the ordered lane if the
    // kitchen parents were not enrolled.
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const station = kitchenStationImage(b);
      const course = kitchenCourseImage(b);
      const product = productImage(b, { station_id: station.id, course_id: course.id });
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "kitchen_stations",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(station),
        },
        {
          seq: 2n,
          originId,
          table: "kitchen_courses",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(course),
        },
        {
          seq: 3n,
          originId,
          table: "products",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(product),
        },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 3, deferred: 0, rejected: 0, versionParked: 0 }); // all three landed, nothing parked
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(3n); // cursor advanced past them
      // The routed product is present AND still points at the mirrored station + course.
      const routed = await postgres.admin.execute<{ station: string; course: string }>(
        sql`select station_id::text as station, course_id::text as course
            from products where id = ${product.id as string}`,
      );
      expect(routed.rows[0]).toEqual({ station: station.id, course: course.id });
    } finally {
      await applier.close();
    }
  });

  it("a ticket_items row lands once its kitchen closure + line are present", async () => {
    // The KDS operational row the mirror exists to show. Its FK closure: node_id → nodes (present by
    // construction, seeded), working_order_line_id → working_order_lines (CASCADE FK), station_id →
    // kitchen_stations, course_id → kitchen_courses. The station + course arrive on the ordered lane
    // (enrolled here); the line + its order are seeded as admin reference rows (working_order_lines is
    // itself enrolled Group C, but this case isolates ticket_items' apply).
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const woId = await seedWorkingOrder(b, 1);
      const productId = await seedProduct(b);
      const lineId = await seedLine(b, woId, productId, 1);
      const station = kitchenStationImage(b);
      const course = kitchenCourseImage(b);
      const item = ticketItemImage(b, {
        working_order_id: woId,
        working_order_line_id: lineId,
        station_id: station.id,
        course_id: course.id,
      });
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "kitchen_stations",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(station),
        },
        {
          seq: 2n,
          originId,
          table: "kitchen_courses",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(course),
        },
        {
          seq: 3n,
          originId,
          table: "ticket_items",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(item),
        },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 3, deferred: 0, rejected: 0, versionParked: 0 }); // station, course and item all landed
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(3n);
      expect(
        await scalar(
          sql`select count(*)::int::text as v from ticket_items where id = ${item.id as string}`,
        ),
      ).toBe("1"); // the item is on the mirror
    } finally {
      await applier.close();
    }
  });

  it("negative control: a routed products row whose station is never applied parks on 23503 and holds the cursor", async () => {
    // The mirror image of spec §1: enrolling kitchen_stations is FORCED because a routed product whose
    // station parent is absent → 23503 → park, stalling the whole ordered lane. Models an ABSENT FK
    // PARENT (the 23503 park path), NOT the literal "not enrolled" case — that is the inline
    // proven-by-deletion in the first test, which throws sync.table_not_enrolled.
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const missingStationId = uuid(); // a kitchen_station that is NEVER applied
      const product = productImage(b, { station_id: missingStationId });
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "products",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(product),
        },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 0, deferred: 1, rejected: 0, versionParked: 0 }); // parked on the absent kitchen_stations parent
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // cursor held below it
      expect(
        await scalar(
          sql`select count(*)::int::text as v from products where id = ${product.id as string}`,
        ),
      ).toBe("0"); // never inserted
    } finally {
      await applier.close();
    }
  });
});

describe("apply lands identity config as app_user (spec §3/§4)", () => {
  it("applies a persons row as app_user, seq-cursor idempotent", async () => {
    await setEnv("preproduction");
    const tenantId = await seedTenant(postgres.admin);
    // Mint the exact row_image the capture trigger would write, then remove the row so apply re-creates
    // it, checking that app-role apply restores the captured image.
    const seeded = await postgres.admin.execute<{ id: string; img: string }>(sql`
      with ins as (
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'Ada', 'hash', 'staff') returning *
      ) select id::text as id, to_jsonb(ins.*)::text as img from ins`);
    const personId = seeded.rows[0]!.id;
    const rowImage = seeded.rows[0]!.img;
    await postgres.admin.execute(sql`delete from persons where id = ${personId}`);

    const subscriberId = uuid();
    const originId = uuid();
    const row: SyncLogRow = {
      seq: 1n,
      originId,
      table: "persons",
      op: "insert",
      tenantId,
      rowImage,
    };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const first = await applyBatch(applier, [row], {
        subscriberId,
        localEnvironment: "preproduction",
        sourceEnvironment: "preproduction",
        enrolments: ENROLMENT,
        subscriberModuleVersions: {},
        moduleByTable: new Map<string, string>(),
      });
      expect(first.applied).toBe(1);
      const landed = await scalar(
        sql`select count(*)::text as v from persons where id = ${personId} and tenant_id = ${tenantId}`,
      );
      expect(landed).toBe("1"); // the app role restored the captured person

      // Re-deliver the SAME seq: skipped by the cursor (null-watermark idempotency rests on the seq
      // cursor, NOT ON CONFLICT — an unconditional upsert would otherwise re-run). applied = 0.
      const second = await applyBatch(applier, [row], {
        subscriberId,
        localEnvironment: "preproduction",
        sourceEnvironment: "preproduction",
        enrolments: ENROLMENT,
        subscriberModuleVersions: {},
        moduleByTable: new Map<string, string>(),
      });
      expect(second.applied).toBe(0);
    } finally {
      await applier.close();
    }
  });

  it("applies a webauthn_credentials delete (removes the mirror row)", async () => {
    await setEnv("preproduction");
    const tenantId = await seedTenant(postgres.admin);
    const person = await postgres.admin.execute<{ id: string }>(
      sql`insert into persons (tenant_id, display_name, pin_hash, role)
          values (${tenantId}, 'Ada', 'hash', 'staff') returning id`,
    );
    const personId = person.rows[0]!.id;
    const cred = await postgres.admin.execute<{ id: string; img: string }>(sql`
      with ins as (
        insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
        values (${tenantId}, ${personId}, 'cred-1', 'pk-1') returning *
      ) select id::text as id, to_jsonb(ins.*)::text as img from ins`);
    const credId = cred.rows[0]!.id;
    const subscriberId = uuid();
    const originId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const del = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "webauthn_credentials",
            op: "delete",
            tenantId,
            rowImage: cred.rows[0]!.img,
          },
        ],
        {
          subscriberId,
          localEnvironment: "preproduction",
          sourceEnvironment: "preproduction",
          enrolments: ENROLMENT,
          subscriberModuleVersions: {},
          moduleByTable: new Map<string, string>(),
        },
      );
      expect(del.applied).toBe(1);
      const remaining = await scalar(
        sql`select count(*)::text as v from webauthn_credentials where id = ${credId}`,
      );
      expect(remaining).toBe("0");
    } finally {
      await applier.close();
    }
  });
});

describe("the schema-version park gate (SP-2b, the anti-silent-corruption gate)", () => {
  // Builds the applyBatch opts for a version-gate scenario. `source` undefined models a pre-SP-2b peer
  // that serves no moduleVersions map (gate disabled); a map with the row's module ahead of `subscriber`
  // makes the gate fire. `moduleByTable` resolves a row's owning module. Everything else matches PROD.
  const gateOpts = (
    subscriberId: string,
    source: Record<string, number> | undefined,
    subscriber: Record<string, number>,
    moduleByTable: ReadonlyMap<string, string>,
  ) => ({
    ...PROD,
    subscriberId,
    sourceModuleVersions: source,
    subscriberModuleVersions: subscriber,
    moduleByTable,
  });

  // `to_jsonb(sales) ? 'future_col'` — does the applied row carry the extra key? jsonb_populate_record
  // drops any JSON key with no matching column, so a real applied row never carries it: this is how the
  // silent-drop hazard is made visible (the source's rowImage carried it; the mirror row does not).
  const hasFutureCol = (id: string) =>
    scalar(sql`select (to_jsonb(s) ? 'future_col')::text as v from sales s where id = ${id}`);

  it("parks a row whose module the SOURCE migrated ahead of us, holds the cursor, and lands it once we catch up", async () => {
    // The core safety property. sales → module 'core'; the source is at core v2, this subscriber at v1,
    // so the source's row may carry a column our table lacks (modelled by the extra `future_col` key,
    // which jsonb_populate_record would silently drop — the corruption). The gate PARKS it instead:
    // never applied, never dropped, held below the cursor until this node reboots+migrates.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const moduleByTable = new Map<string, string>([["sales", "core"]]);
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = saleImage(b, seriesId, 1, { future_col: "SENTINEL-would-be-dropped" });
      const saleId = img.id as string;
      const batch: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "sales",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(img),
        },
      ];

      // Source ahead (core 2 > 1): PARKED. Nothing applied, nothing FK-deferred, cursor held below seq 1.
      const parked = await applyBatch(
        applier,
        batch,
        gateOpts(subscriberId, { core: 2 }, { core: 1 }, moduleByTable),
      );
      expect(parked).toEqual({ applied: 0, deferred: 0, rejected: 0, versionParked: 1 });
      expect(await saleCount(saleId)).toBe("0"); // never applied — no silent drop
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // held below the parked seq

      // This subscriber reboots and migrates → its core version is now 2, equal to the source. Redeliver
      // the SAME batch (at-least-once): the verdict flips, the row applies, the cursor advances.
      const landed = await applyBatch(
        applier,
        batch,
        gateOpts(subscriberId, { core: 2 }, { core: 2 }, moduleByTable),
      );
      expect(landed).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });
      expect(await saleCount(saleId)).toBe("1"); // landed after catch-up
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(1n); // advanced past it
    } finally {
      await applier.close();
    }
  });

  it("PROVE-BY-DELETION: with the gate disabled (a pre-SP-2b peer), the ahead-version row applies and the extra column is SILENTLY DROPPED", async () => {
    // The corruption the gate closes, demonstrated directly. Same ahead-version row as above, but the
    // source served NO moduleVersions map (an older peer) → the gate is disabled (isVersionAhead returns
    // false when sourceModuleVersions is undefined). The row now APPLIES, and jsonb_populate_record drops
    // its `future_col` key with no matching column — the exact silent cross-node corruption. The gate
    // (previous test) is the only thing standing between this row and that drop.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const moduleByTable = new Map<string, string>([["sales", "core"]]);
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = saleImage(b, seriesId, 1, { future_col: "SENTINEL-silently-dropped" });
      const saleId = img.id as string;
      const rowImage = wire(img);
      expect(rowImage).toContain("future_col"); // the SOURCE's row genuinely carries the newer column

      // Gate disabled (source map absent): applies despite the version skew that WOULD have parked it.
      const result = await applyBatch(
        applier,
        [{ seq: 1n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage }],
        gateOpts(subscriberId, undefined, { core: 1 }, moduleByTable),
      );
      expect(result).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });
      expect(await saleCount(saleId)).toBe("1"); // it landed
      expect(await hasFutureCol(saleId)).toBe("false"); // …but the newer column was SILENTLY DROPPED
    } finally {
      await applier.close();
    }
  });

  it("older-peer tolerance: a source that serves no moduleVersions applies normally (behaviour-preserving)", async () => {
    // The compatibility case in isolation (no schema skew): an older peer's ordinary row applies exactly
    // as it did pre-SP-2b — the gate must never disturb a peer that predates it.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const moduleByTable = new Map<string, string>([["sales", "core"]]);
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = saleImage(b, seriesId, 1);
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(img),
          },
        ],
        gateOpts(subscriberId, undefined, { core: 5 }, moduleByTable),
      );
      expect(result).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(1n);
    } finally {
      await applier.close();
    }
  });

  it("subscriber ahead or equal → no park (applying an older row into a newer/equal table is safe)", async () => {
    // subscriber > source and subscriber == source both apply: the steady state after this node has
    // migrated (jsonb_populate_record fills only the present columns; a newer column takes its default).
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const moduleByTable = new Map<string, string>([["sales", "core"]]);
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // Subscriber AHEAD (core 2 > 1).
      const ahead = saleImage(b, seriesId, 1);
      const r1 = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(ahead),
          },
        ],
        gateOpts(subscriberId, { core: 1 }, { core: 2 }, moduleByTable),
      );
      expect(r1).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });
      expect(await saleCount(ahead.id as string)).toBe("1");

      // EQUAL (core 1 == 1).
      const equal = saleImage(b, seriesId, 2);
      const r2 = await applyBatch(
        applier,
        [
          {
            seq: 2n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(equal),
          },
        ],
        gateOpts(subscriberId, { core: 1 }, { core: 1 }, moduleByTable),
      );
      expect(r2).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });
      expect(await saleCount(equal.id as string)).toBe("1");
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(2n);
    } finally {
      await applier.close();
    }
  });

  it("mixed batch: the ahead module parks while the equal module applies, and the cursor holds below the LOWEST parked seq", async () => {
    // Cross-module cursor-safety. Two modules mapped arbitrarily (the gate consults ONLY moduleByTable +
    // the version maps): working_orders → 'moduleB' (source ahead, v2 > v1 → parks) at the LOWER seq 1,
    // sales → 'moduleA' (equal → applies) at the HIGHER seq 2. The applied higher-seq row must NOT drag
    // the cursor past the parked lower-seq row — the cursor holds at 0, below seq 1.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const moduleByTable = new Map<string, string>([
      ["working_orders", "moduleB"],
      ["sales", "moduleA"],
    ]);
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const order = workingOrderImage(b, 1); // moduleB, ahead → parks
      const sale = saleImage(b, seriesId, 1); // moduleA, equal → applies
      const rows: SyncLogRow[] = [
        {
          seq: 1n,
          originId,
          table: "working_orders",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(order),
        },
        {
          seq: 2n,
          originId,
          table: "sales",
          op: "insert",
          tenantId: b.tenantId,
          rowImage: wire(sale),
        },
      ];
      const result = await applyBatch(
        applier,
        rows,
        gateOpts(
          subscriberId,
          { moduleA: 1, moduleB: 2 },
          { moduleA: 1, moduleB: 1 },
          moduleByTable,
        ),
      );
      // One applied (the equal-module sale), one version-parked (the ahead-module order), no FK-defer.
      expect(result).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 1 });
      expect(await saleCount(sale.id as string)).toBe("1"); // the equal module landed
      expect(
        await scalar(
          sql`select count(*)::int::text as v from working_orders where id = ${order.id as string}`,
        ),
      ).toBe("0"); // the ahead module parked — never applied
      // The cursor is HELD at 0 below the parked seq 1, even though seq 2 applied above it. A shared-cursor
      // bug would let the higher applied seq drag it to 2 and silently skip the parked seq 1 forever.
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n);
    } finally {
      await applier.close();
    }
  });

  it("a row whose table has no module mapping falls through the gate and applies (never masked as a park)", async () => {
    // The unknown-table edge (spec §5): even with a version map served, a row whose table is absent from
    // moduleByTable resolves to no module → isVersionAhead returns false → it is NOT parked. Because the
    // table IS enrolled it applies normally (an UNENROLLED table would instead hit the pre-existing
    // sync.table_not_enrolled throw — the gate must not mask that as a version-park).
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = saleImage(b, seriesId, 1);
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(img),
          },
        ],
        // source ahead on 'core', but sales is NOT mapped to any module → the gate cannot resolve it.
        gateOpts(subscriberId, { core: 2 }, { core: 1 }, new Map<string, string>()),
      );
      expect(result).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 0 });
      expect(await saleCount(img.id as string)).toBe("1");
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(1n);
    } finally {
      await applier.close();
    }
  });

  it("a per-module version missing from one side counts as 0, not 'skip' (subscriber absent → parks; source absent → applies)", async () => {
    // spec §4 "robustness at the edges", the `?? 0` fallbacks. Two rows, both mapped to modules, with the
    // maps deliberately incomplete: 'ahead' — the SUBSCRIBER has no entry (0) while the source is ahead
    // (1) → PARKS; 'behind' — the SOURCE has no entry (0) while the subscriber is at 1 → 0 never exceeds,
    // so it APPLIES. A "missing means skip the check" bug would apply the first row (the corruption).
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const moduleByTable = new Map<string, string>([
      ["sales", "modAhead"],
      ["working_orders", "modBehind"],
    ]);
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const sale = saleImage(b, seriesId, 1); // modAhead: subscriber map omits it (→0) < source 1 → parks
      const order = workingOrderImage(b, 1); // modBehind: source map omits it (→0), subscriber 1 → applies
      const result = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "sales",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(sale),
          },
          {
            seq: 2n,
            originId,
            table: "working_orders",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(order),
          },
        ],
        // source knows only modAhead; subscriber knows only modBehind.
        gateOpts(subscriberId, { modAhead: 1 }, { modBehind: 1 }, moduleByTable),
      );
      expect(result).toEqual({ applied: 1, deferred: 0, rejected: 0, versionParked: 1 });
      expect(await saleCount(sale.id as string)).toBe("0"); // subscriber-absent (0) < source 1 → parked
      expect(
        await scalar(
          sql`select count(*)::int::text as v from working_orders where id = ${order.id as string}`,
        ),
      ).toBe("1"); // source-absent (0) never exceeds → applied
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // held below the parked seq 1
    } finally {
      await applier.close();
    }
  });

  it("the environment gate still precedes the version check: a mismatched environment is refused regardless of versions", async () => {
    // Ordering guarantee (spec §3/§4): the whole-batch environment handshake runs FIRST, before any
    // per-module version comparison. A source in the wrong environment is refused even when its versions
    // would independently park the row — the env burn (CLAUDE.md §5) is caught ahead of everything.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const moduleByTable = new Map<string, string>([["sales", "core"]]);
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const img = saleImage(b, seriesId, 1);
      const err = await captureError(() =>
        applyBatch(
          applier,
          [
            {
              seq: 1n,
              originId: uuid(),
              table: "sales",
              op: "insert",
              tenantId: b.tenantId,
              rowImage: wire(img),
            },
          ],
          {
            subscriberId: uuid(),
            localEnvironment: "production",
            sourceEnvironment: "preproduction", // mismatch — must be refused before the version check
            enrolments: ENROLMENT,
            sourceModuleVersions: { core: 2 }, // versions WOULD park, but the env gate fires first
            subscriberModuleVersions: { core: 1 },
            moduleByTable,
          },
        ),
      );
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("sync.peer_environment_mismatch");
      expect(await saleCount(img.id as string)).toBe("0"); // nothing applied — whole batch refused
    } finally {
      await applier.close();
    }
  });
});
