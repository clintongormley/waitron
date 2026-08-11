import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { captureError, pgErrorCode } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyBatch, type SyncLogRow } from "./apply.js";

// Real Postgres, not PGlite: this suite proves the apply loop under a genuine non-superuser,
// non-BYPASSRLS role, so FORCE ROW LEVEL SECURITY's WITH CHECK actually fences each write to its
// own tenant — PGlite connects as a superuser and bypasses all of it, a false pass (CLAUDE.md §4).
// The whole migration manifest runs (including `sync` last), so the container carries sync_log +
// sync_cursor + sync_capture + the 14 capture triggers over the enrolled commercial tables.
const postgres = useRealPostgres({
  start: () =>
    startMigratedPostgres({
      dockerRequired:
        "The sync apply-gate suite requires a running Docker daemon. It cannot be skipped: PGlite " +
        "connects as a superuser and bypasses FORCE ROW LEVEL SECURITY, so it cannot exercise the " +
        "app-role WITH CHECK tenant fence, the sync_cursor grant path, or the non-superuser apply " +
        "this suite exists to verify (CLAUDE.md §4).",
      migrate: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    }),
  // The apply worker's role: a LOGIN role that is a member of BOTH app_user (INSERT/UPDATE/DELETE on
  // the enrolled tables) AND sync_tailer (SELECT/INSERT/UPDATE on sync_cursor). This is the
  // sanctioned path — app_user is never widened to reach sync_cursor (spec §7; CLAUDE.md §3). It is
  // non-superuser and non-BYPASSRLS, so FORCE RLS genuinely applies to it (that is the whole point).
  setup: async ({ admin }) => {
    await admin.execute(sql.raw(`create role sync_applier login password 'ap' in role app_user`));
    await admin.execute(sql.raw(`grant sync_tailer to sync_applier`));
  },
  timeoutMs: 180_000,
});

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
 * node, catalogue — as the superuser admin (RLS bypassed; pure setup). English fixture values
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

async function seedLine(b: Base, orderId: string, productId: string, lineNo: number): Promise<string> {
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

// Admin (RLS-bypassing) read-backs of the mirror's actual stored state.
async function scalar(query: ReturnType<typeof sql>): Promise<string | null> {
  const r = await postgres.admin.execute<{ v: string | null }>(query);
  return r.rows[0]?.v ?? null;
}
const saleTotal = (id: string) => scalar(sql`select total::text as v from sales where id = ${id}`);
const saleCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from sales where id = ${id}`);
const saleLineCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from sale_lines where id = ${id}`);
const lineCount = (id: string) =>
  scalar(sql`select count(*)::int::text as v from working_order_lines where id = ${id}`);
const paymentState = (id: string) => scalar(sql`select state as v from payments where id = ${id}`);
const woStatus = (id: string) => scalar(sql`select status as v from working_orders where id = ${id}`);

const PROD = { localEnvironment: "production", sourceEnvironment: "production" } as const;

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
        [{ seq: 1n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: img }],
        { subscriberId, ...PROD },
      );
      expect(first).toEqual({ applied: 1, deferred: 0 });

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
            rowImage: { ...img, total: "999.99" },
          },
        ],
        { subscriberId, ...PROD },
      );
      expect(repeat).toEqual({ applied: 0, deferred: 0 });

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
          [{ seq, originId, table: "payments", op, tenantId: b.tenantId, rowImage: paymentImage(b, woId, { ...key, ...over }) }],
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
            [{ seq: 1n, originId, table: "working_orders", op: "insert", tenantId: b.tenantId, rowImage: workingOrderImage(b, woId, { status: "open" }) }],
            opts,
          )
        ).applied,
      ).toBe(1);
      expect(
        (
          await applyBatch(
            applier,
            [{ seq: 2n, originId, table: "working_orders", op: "update", tenantId: b.tenantId, rowImage: workingOrderImage(b, woId, { status: "placed" }) }],
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
        [{ seq: 1n, originId, table: "working_orders", op: "update", tenantId: b.tenantId, rowImage: workingOrderImage(b, woId, { status: "open" }) }],
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
        [{ seq: 3n, originId, table: "working_order_lines", op: "delete", tenantId: b.tenantId, rowImage: { id: lineId, tenant_id: b.tenantId } }],
        opts,
      );
      expect(del.applied).toBe(1);
      expect(await lineCount(lineId)).toBe("0"); // the line is gone

      // Re-apply the SAME delete at a higher seq (so the cursor does not mask it): a 0-row no-op.
      const delAgain = await applyBatch(
        applier,
        [{ seq: 4n, originId, table: "working_order_lines", op: "delete", tenantId: b.tenantId, rowImage: { id: lineId, tenant_id: b.tenantId } }],
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
          { seq: 1n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: parentSale },
          { seq: 2n, originId, table: "sale_lines", op: "insert", tenantId: b.tenantId, rowImage: saleLineImage(b, parentSale.id as string) },
        ],
        opts,
      );
      expect(inOrder).toEqual({ applied: 2, deferred: 0 });

      // Control (the other direction): shuffle the child BELOW its parent — line at seq3, sale at
      // seq4. Applied ascending, the line hits its absent parent → 23503 → parked; the sale lands;
      // the retry lands the parked line. deferred >= 1 and the final state is correct.
      const laterSale = saleImage(b, seriesId, 2);
      const laterLine = saleLineImage(b, laterSale.id as string);
      const shuffled = await applyBatch(
        applier,
        [
          { seq: 3n, originId, table: "sale_lines", op: "insert", tenantId: b.tenantId, rowImage: laterLine },
          { seq: 4n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: laterSale },
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
          { seq: 1n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: goodSale },
          { seq: 2n, originId, table: "sale_lines", op: "insert", tenantId: b.tenantId, rowImage: orphanLine },
        ],
        { subscriberId, ...PROD },
      );
      expect(result).toEqual({ applied: 1, deferred: 1 });
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
      const rowA: SyncLogRow = { seq: 1n, originId: uuid(), table: "sales", op: "insert", tenantId: b1.tenantId, rowImage: saleImage(b1, s1, 1) };
      const sub1 = uuid();
      const refusedA = await captureError(() =>
        applyBatch(applier, [rowA], { subscriberId: sub1, localEnvironment: "production", sourceEnvironment: "preproduction" }),
      );
      expect(refusedA).toBeInstanceOf(AppError);
      expect((refusedA as AppError).code).toBe("sync.peer_environment_mismatch");
      expect((refusedA as AppError).params).toEqual({ local: "production", peer: "preproduction" });
      expect(await saleCount((rowA.rowImage as { id: string }).id)).toBe("0"); // nothing applied
      // The matching direction applies.
      const matchedA = await applyBatch(applier, [rowA], { subscriberId: sub1, ...PROD });
      expect(matchedA.applied).toBe(1);
      expect(await saleCount((rowA.rowImage as { id: string }).id)).toBe("1");

      // Preproduction mirror refuses a production source (the other direction).
      await setEnv("preproduction");
      const b2 = await seedBase();
      const s2 = await seedSeries(b2);
      const rowB: SyncLogRow = { seq: 1n, originId: uuid(), table: "sales", op: "insert", tenantId: b2.tenantId, rowImage: saleImage(b2, s2, 1) };
      const sub2 = uuid();
      const refusedB = await captureError(() =>
        applyBatch(applier, [rowB], { subscriberId: sub2, localEnvironment: "preproduction", sourceEnvironment: "production" }),
      );
      expect(refusedB).toBeInstanceOf(AppError);
      expect((refusedB as AppError).code).toBe("sync.peer_environment_mismatch");
      expect((refusedB as AppError).params).toEqual({ local: "preproduction", peer: "production" });
      expect(await saleCount((rowB.rowImage as { id: string }).id)).toBe("0");
      const matchedB = await applyBatch(applier, [rowB], {
        subscriberId: sub2,
        localEnvironment: "preproduction",
        sourceEnvironment: "preproduction",
      });
      expect(matchedB.applied).toBe(1);
    } finally {
      await applier.close();
    }
  });

  it("applies verbatim under the app role and the FORCE-RLS WITH CHECK rejects a cross-tenant row", async () => {
    await setEnv("production");
    const mirror = await seedBase(); // tenant B — the applying scope
    const seriesId = await seedSeries(mirror);
    const other = await seedBase(); // tenant A — the WRONG scope
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
        [{ seq: 1n, originId, table: "sales", op: "insert", tenantId: mirror.tenantId, rowImage: img }],
        { subscriberId, ...PROD },
      );
      expect(applied.applied).toBe(1);
      const rb = await postgres.admin.execute<{
        total: string;
        vat: { rate: string; base: string; tax: string }[];
      }>(sql`select total::text as total, vat_breakdown as vat from sales where id = ${saleId}`);
      expect(rb.rows[0]!.total).toBe("123.45"); // numeric round-trips to the exact string
      expect(rb.rows[0]!.vat).toEqual([{ rate: "21.00", base: "102.02", tax: "21.43" }]); // jsonb exact

      // Cross-tenant: rowImage.tenant_id is B (all its FKs valid), but the SyncLogRow.tenantId is A,
      // so apply opens withTenant(A). current_tenant_id() = A, jsonb_populate_record makes tenant_id
      // = B, and the FORCE-RLS WITH CHECK (tenant_id = current_tenant_id()) rejects it with 42501.
      // The image is otherwise FK-valid, so 42501 is the ONLY reason it fails (not a 23503), and
      // applyBatch does not defer a 42501 — it propagates. Nothing lands.
      const crossImg = saleImage(mirror, seriesId, 2);
      const err = await captureError(() =>
        applyBatch(
          applier,
          [{ seq: 1n, originId: uuid(), table: "sales", op: "insert", tenantId: other.tenantId, rowImage: crossImg }],
          { subscriberId: uuid(), ...PROD },
        ),
      );
      expect(pgErrorCode(err)).toBe("42501");
      expect(await saleCount(crossImg.id as string)).toBe("0");
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
        }),
      );
      expect((err as Error).message).toContain("disagrees with the stamped");
    } finally {
      await applier.close();
    }
  });

  it("throws sync.table_not_enrolled for a row naming a table the registry does not carry", async () => {
    // Also a guard that the fiscal core is not enrollable: registros_facturacion has no apply
    // statement here (spec §1 defers the fiscal lane), so a row naming it is a hard error, never a
    // silent skip.
    await setEnv("production");
    const b = await seedBase();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const err = await captureError(() =>
        applyBatch(
          applier,
          [{ seq: 1n, originId: uuid(), table: "registros_facturacion", op: "insert", tenantId: b.tenantId, rowImage: { id: uuid() } }],
          { subscriberId: uuid(), ...PROD },
        ),
      );
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("sync.table_not_enrolled");
      expect((err as AppError).params).toEqual({ table: "registros_facturacion" });
    } finally {
      await applier.close();
    }
  });
});
