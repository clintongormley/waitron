import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, pgErrorCode, pgErrorMessage, CORE_ENROLMENT } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { applyBatch } from "./apply.js";

// Real Postgres, not PGlite: the redelivery guard proof needs the apply loop under a genuine
// non-superuser, non-BYPASSRLS role (FORCE RLS actually fences it) and the real business BEFORE
// triggers that migration 0037 gates — PGlite bypasses all of it, a false pass (CLAUDE.md §4). The
// whole manifest runs (0037 included, `sync` last), so the container carries the gated triggers.
// The apply worker's role sync_applier — a LOGIN member of BOTH app_user AND sync_tailer, the
// sanctioned path (spec §7; CLAUDE.md §3, never widen app_user to reach sync_cursor) — is now created
// once in src/testing/global-setup.ts with both memberships in its inRole array, shared across the
// gate suites: a shared cluster is one cluster, so a per-file `create role` would collide on the
// second. Reached below with `connectAs("sync_applier", "ap")`.
const postgres = useTemplateDb({ template: "manifest" });

const uuid = (): string => randomUUID();

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
  nodeId: string;
  catalogueId: string;
}

/** Seeds a tenant plus the reference parents an enrolled commercial row references — location, till,
 * node, catalogue — as the superuser admin (RLS bypassed; pure setup). English fixtures throughout:
 * packages/sync/src is inside the english-only guard (CLAUDE.md §3). */
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

async function seedProduct(b: Base): Promise<string> {
  const p = await postgres.admin.execute<{ id: string }>(
    sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (${b.tenantId}, ${b.catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', '1.30', 'general')
        returning id`,
  );
  return p.rows[0]!.id;
}

type Image = Record<string, unknown>;

/** The wire shape: row_image travels as the source's raw `row_image::text` — a STRING (design §4b). */
const wire = (image: Image): string => JSON.stringify(image);

/** A complete `sales` row_image — every NOT NULL column present, exactly what `to_jsonb(sales)` captures. */
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

function workingOrderImage(b: Base, id: string, over: Image = {}): Image {
  return {
    id,
    tenant_id: b.tenantId,
    till_id: b.tillId,
    node_id: null,
    order_number: 1,
    label: null,
    status: "open",
    opened_at: "2026-08-11T10:00:00+00:00",
    settled_at: null,
    ...over,
  };
}

const PROD = {
  localEnvironment: "production",
  sourceEnvironment: "production",
  enrolments: CORE_ENROLMENT,
} as const;

describe("redelivery does not wedge the stream: business BEFORE-triggers are gated on app.sync_apply", () => {
  it("a redelivered tender after its settlement is a clean no-op, and WITHOUT the gate raises WT002", async () => {
    // Redelivery re-applies a below-cursor range at least once. Without the gate, re-inserting a
    // tender after its sale_settlements row committed fires tenders_reject_post_settlement -> WT002,
    // a NON-23503 that applyBatch does not park -> the stream wedges. The 0037 gate skips the trigger
    // under app.sync_apply='on', so the re-insert reaches ON CONFLICT DO NOTHING instead. Prove the
    // guard by DELETION: recreate the trigger ungated, watch the redelivery raise, restore.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const opts = { subscriberId, ...PROD };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const sale = saleImage(b, seriesId, 1, { total: "10.00" });
      const saleId = sale.id as string;
      // tenders columns (0005_sales.sql:47-55 + 0012:9 tip_amount): id, tenant_id, sale_id, method
      // (tender_method enum — 'cash' is valid), amount, settled_at (NOT NULL, no default), tip_amount.
      const tender = {
        id: uuid(),
        tenant_id: b.tenantId,
        sale_id: saleId,
        method: "cash",
        amount: "10.00",
        tip_amount: "0.00",
        settled_at: "2026-08-11T10:00:00+00:00",
      };
      const settlement = {
        id: uuid(),
        tenant_id: b.tenantId,
        sale_id: saleId,
        settled_at: "2026-08-11T10:00:00+00:00",
      };
      // Apply sale (seq1) -> tender (seq2) -> settlement (seq3), in order. Coverage holds
      // (sum(amount)=10.00 = total 10.00 + tips 0.00), so sale_settlements_check_coverage passes.
      const first = await applyBatch(
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
            table: "tenders",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(tender),
          },
          {
            seq: 3n,
            originId,
            table: "sale_settlements",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(settlement),
          },
        ],
        opts,
      );
      expect(first.applied).toBe(3);

      // Redeliver the tender at a HIGHER seq (seq4) so the cursor does not mask it -> it re-attempts
      // the INSERT. With the gate: ON CONFLICT DO NOTHING, applied 0, no throw.
      const redelivered = await applyBatch(
        applier,
        [
          {
            seq: 4n,
            originId,
            table: "tenders",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(tender),
          },
        ],
        opts,
      );
      expect(redelivered.applied).toBe(0); // clean no-op, stream not wedged

      // DELETION control: recreate the trigger UNGATED and redeliver again -> WT002 propagates.
      await postgres.admin.execute(
        sql.raw(`drop trigger tenders_reject_post_settlement on tenders`),
      );
      await postgres.admin.execute(
        sql.raw(`create trigger tenders_reject_post_settlement before insert on tenders
                 for each row execute function tenders_reject_post_settlement()`),
      );
      try {
        const err = await captureError(() =>
          applyBatch(
            applier,
            [
              {
                seq: 5n,
                originId,
                table: "tenders",
                op: "insert",
                tenantId: b.tenantId,
                rowImage: wire(tender),
              },
            ],
            opts,
          ),
        );
        expect(pgErrorCode(err)).toBe("WT002");
      } finally {
        // Restore the GATED trigger (triggers are DB-global; leave the DB as 0037 left it).
        await postgres.admin.execute(
          sql.raw(`drop trigger tenders_reject_post_settlement on tenders`),
        );
        await postgres.admin.execute(
          sql.raw(`create trigger tenders_reject_post_settlement before insert on tenders
                   for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
                   execute function tenders_reject_post_settlement()`),
        );
      }
    } finally {
      await applier.close();
    }
  });

  it("a redelivered working_orders update after the order settled is clean, ungated it RAISES", async () => {
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const opts = { subscriberId, ...PROD };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const woId = uuid();
      const open = workingOrderImage(b, woId, { status: "open" });
      const settled = workingOrderImage(b, woId, {
        status: "settled",
        settled_at: "2026-08-11T11:00:00+00:00",
      });
      const first = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "working_orders",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(open),
          },
          {
            seq: 2n,
            originId,
            table: "working_orders",
            op: "update",
            tenantId: b.tenantId,
            rowImage: wire(settled),
          },
        ],
        opts,
      );
      expect(first.applied).toBe(2);
      // Redeliver the settled image (seq3): gated -> unconditional Group-C upsert re-sets same values,
      // no enforce_transition raise. (working_orders is watermark-upsert with watermarkColumn null.)
      const redelivered = await applyBatch(
        applier,
        [
          {
            seq: 3n,
            originId,
            table: "working_orders",
            op: "update",
            tenantId: b.tenantId,
            rowImage: wire(settled),
          },
        ],
        opts,
      );
      expect(redelivered.applied).toBe(1);
      // DELETION control: ungate -> OLD.status='settled' is terminal -> RAISE (a plain error).
      await postgres.admin.execute(
        sql.raw(`drop trigger working_orders_enforce_transition on working_orders`),
      );
      await postgres.admin.execute(
        sql.raw(`create trigger working_orders_enforce_transition before update on working_orders
                 for each row execute function working_orders_enforce_transition()`),
      );
      try {
        const err = await captureError(() =>
          applyBatch(
            applier,
            [
              {
                seq: 4n,
                originId,
                table: "working_orders",
                op: "update",
                tenantId: b.tenantId,
                rowImage: wire(settled),
              },
            ],
            opts,
          ),
        );
        expect(pgErrorMessage(err)).toContain("cannot transition"); // the enforce_transition RAISE
      } finally {
        await postgres.admin.execute(
          sql.raw(`drop trigger working_orders_enforce_transition on working_orders`),
        );
        await postgres.admin.execute(
          sql.raw(`create trigger working_orders_enforce_transition before update on working_orders
                   for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
                   execute function working_orders_enforce_transition()`),
        );
      }
    } finally {
      await applier.close();
    }
  });

  it("a redelivered working_order_lines op after the parent left 'open' is clean, ungated it RAISES", async () => {
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const opts = { subscriberId, ...PROD };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const woId = uuid();
      const lineId = uuid();
      const productId = await seedProduct(b); // product_id is NOT NULL + FK to products (0029)
      const open = workingOrderImage(b, woId, { status: "open" });
      const settled = workingOrderImage(b, woId, {
        status: "settled",
        settled_at: "2026-08-11T11:00:00+00:00",
      });
      // A line while the parent is open, then settle the parent. descriptions must equal the venue
      // locales (['en']) so the ungated working_order_lines_check_locales still passes on redelivery.
      const line = {
        id: lineId,
        tenant_id: b.tenantId,
        working_order_id: woId,
        product_id: productId,
        line_no: 1,
        descriptions: { en: "Coffee" },
        quantity: "1.000",
        unit_price: "1.30",
        unit_price_gross: "1.43",
        vat_rate: "10.00",
        line_total: "1.30",
      };
      const first = await applyBatch(
        applier,
        [
          {
            seq: 1n,
            originId,
            table: "working_orders",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(open),
          },
          {
            seq: 2n,
            originId,
            table: "working_order_lines",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(line),
          },
          {
            seq: 3n,
            originId,
            table: "working_orders",
            op: "update",
            tenantId: b.tenantId,
            rowImage: wire(settled),
          },
        ],
        opts,
      );
      expect(first.applied).toBe(3);
      const redelivered = await applyBatch(
        applier,
        [
          {
            seq: 4n,
            originId,
            table: "working_order_lines",
            op: "insert",
            tenantId: b.tenantId,
            rowImage: wire(line),
          },
        ],
        opts,
      );
      expect(redelivered.applied).toBe(1); // gated -> ON CONFLICT DO UPDATE, parent-open check skipped
      await postgres.admin.execute(
        sql.raw(`drop trigger working_order_lines_require_open_parent on working_order_lines`),
      );
      await postgres.admin.execute(
        sql.raw(`create trigger working_order_lines_require_open_parent
                 before insert or update or delete on working_order_lines
                 for each row execute function working_order_lines_require_open_parent()`),
      );
      try {
        const err = await captureError(() =>
          applyBatch(
            applier,
            [
              {
                seq: 5n,
                originId,
                table: "working_order_lines",
                op: "insert",
                tenantId: b.tenantId,
                rowImage: wire(line),
              },
            ],
            opts,
          ),
        );
        expect(pgErrorMessage(err)).toContain("order is open"); // the require_open_parent RAISE
      } finally {
        await postgres.admin.execute(
          sql.raw(`drop trigger working_order_lines_require_open_parent on working_order_lines`),
        );
        await postgres.admin.execute(
          sql.raw(`create trigger working_order_lines_require_open_parent
                   before insert or update or delete on working_order_lines
                   for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
                   execute function working_order_lines_require_open_parent()`),
        );
      }
    } finally {
      await applier.close();
    }
  });
});
