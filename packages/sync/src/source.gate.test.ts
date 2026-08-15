import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readSyncLogSince } from "./source.js";

// NOTE: `catalogues` is an ENROLLED table, so seedBase's own catalogue INSERT (as admin, no node id)
// captures a sync_log row with the all-zero origin BEFORE any products write — exactly why
// origin.gate.test.ts filters by table_name. The tests below account for that noise: they locate the
// `products` row explicitly, and the RLS control uses a bare `seedTenant` tenant (tenants is NOT
// enrolled, so it captures nothing at all).

// Real Postgres, not PGlite: the source read runs under FORCE ROW LEVEL SECURITY as the non-superuser
// sync_tailer role, which PGlite (superuser) bypasses — a false pass (CLAUDE.md §4). The full manifest
// runs (`sync` last), so the container carries sync_log + sync_capture over the enrolled tables. The
// reader is a sync_tailer MEMBER LOGIN role, the sanctioned per-tenant read path (spec §7).
const postgres = useRealPostgres({
  start: () =>
    startMigratedPostgres({
      dockerRequired:
        "The sync source-read suite requires a running Docker daemon. It cannot be skipped: PGlite " +
        "connects as a superuser and bypasses FORCE ROW LEVEL SECURITY, so it cannot exercise the " +
        "sync_log_tenant_isolation policy this suite drives as a non-superuser sync_tailer member " +
        "(CLAUDE.md §4).",
      migrate: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    }),
  // An app-role LOGIN role to CAPTURE writes (INSERT on sync_log via app_user), and a sync_tailer
  // member LOGIN role to READ them back per-tenant. Both non-superuser so FORCE RLS genuinely applies.
  setup: async ({ admin }) => {
    await admin.execute(sql.raw(`create role app_login login password 'app_pw' in role app_user`));
    await admin.execute(sql.raw(`create role sync_reader login password 'rp'`));
    await admin.execute(sql.raw(`grant sync_tailer to sync_reader`));
  },
  timeoutMs: 180_000,
});

const NODE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface Base {
  tenantId: string;
  catalogueId: string;
}

/** Seeds a tenant plus the one FK parent a `products` row needs (a catalogue), as the superuser. */
async function seedBase(): Promise<Base> {
  const tenantId = await seedTenant(postgres.admin);
  const cat = await postgres.admin.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
  );
  return { tenantId, catalogueId: cat.rows[0]!.id };
}

/** An app_login write under withTenant{nodeId: NODE_A} — sync_capture writes one products row into
 * sync_log with vat_class carrying `unit_price` as the captured numeric so we can assert byte-identity
 * of the raw jsonb text. `price` is a JSON number (via to_jsonb) so a JS re-parse would collapse it. */
async function captureAProductWrite(b: Base, price: string): Promise<void> {
  const app = await postgres.pg.connectAs("app_login", "app_pw");
  try {
    await withTenant(
      app,
      b.tenantId,
      (tx) =>
        tx.execute(
          sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
              values (${b.tenantId}, ${b.catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', ${price}::numeric(12,2), 'general')`,
        ),
      { nodeId: NODE_A },
    );
  } finally {
    await app.close();
  }
}

/** An app_login write into a fast-lane table (payment_policy: watermark table, standalone PK tenant_id,
 * no FK parent needed beyond the tenant) under withTenant{nodeId: NODE_A}, so sync_capture writes one
 * payment_policy row to sync_log. Columns per packages/payments/src/schema/payment-policy.ts: tenant_id,
 * offline_mode (text, NOT NULL, CHECK in ('accept_offline','cash_only')), offline_amount_cap (numeric,
 * NOT NULL, CHECK >= 0); created_at/updated_at default. Same INSERT shape as packages/payments/test/
 * seed.ts:136. Used to prove readSyncLogSince's `tables` filter separates the lanes. */
async function capturePaymentPolicyWrite(b: Base): Promise<void> {
  const app = await postgres.pg.connectAs("app_login", "app_pw");
  try {
    await withTenant(
      app,
      b.tenantId,
      (tx) =>
        tx.execute(
          sql`insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
              values (${b.tenantId}, 'cash_only', '0.00')`,
        ),
      { nodeId: NODE_A },
    );
  } finally {
    await app.close();
  }
}

describe("readSyncLogSince reads sync_log as sync_tailer under the tenant context", () => {
  it("selects sync_log rows past afterSeq as sync_tailer, with row_image as raw jsonb TEXT", async () => {
    // Failing case: no readSyncLogSince yet. It must (a) run under withTenant so RLS admits sync_tailer,
    // (b) return seq as bigint (never a lossy number), (c) return row_image as raw TEXT (design §4b) —
    // a numeric 1.50 must arrive as the string "…1.50…", never a JS-parsed object.
    const b = await seedBase();
    await captureAProductWrite(b, "1.50"); // an app_login write -> sync_capture -> sync_log
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const rows = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100 }),
      );
      // The catalogue (seedBase) and the products write are both captured; find the products row.
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const product = rows.find((r) => r.table === "products")!;
      expect(product).toBeDefined();
      expect(typeof product.seq).toBe("bigint");
      expect(typeof product.rowImage).toBe("string"); // raw jsonb TEXT, not an object
      expect(product.rowImage).toContain("1.50"); // scale preserved, never re-quoted to 1.5
      expect(product.originId).toBe(NODE_A);
      expect(rows.every((r, i) => i === 0 || r.seq > rows[i - 1]!.seq)).toBe(true); // ascending
    } finally {
      await reader.close();
    }
  });

  it("afterSeq is EXCLUSIVE, and RLS fences a reader for a different tenant to nothing", async () => {
    // Two captured rows on ONE tenant at strictly ascending seqs; a read past the first seq returns
    // only the second (afterSeq is a strict lower bound). Control (the two directions differ, §1): a
    // sync_reader read under a DIFFERENT tenant's context returns nothing — RLS visibly bites.
    const b = await seedBase();
    await captureAProductWrite(b, "2.00");
    await captureAProductWrite(b, "3.00");
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const all = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100 }),
      );
      expect(all.length).toBeGreaterThanOrEqual(2);
      const firstSeq = all[0]!.seq;
      const past = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: firstSeq, limit: 100 }),
      );
      expect(past.every((r) => r.seq > firstSeq)).toBe(true); // exclusive lower bound
      expect(past.some((r) => r.seq === firstSeq)).toBe(false);

      // Control: a fresh tenant with NO captured rows (bare seedTenant — `tenants` is not enrolled, so
      // it captures nothing) — the same reader under its context sees nothing, so the tenant scoping is
      // RLS, not an artefact of which rows happen to exist. A seedBase tenant would carry its catalogue
      // capture and mask this, so the control deliberately uses a tenant that captures none.
      const otherTenant = await seedTenant(postgres.admin);
      const fenced = await withTenant(reader, otherTenant, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100 }),
      );
      expect(fenced).toEqual([]);
    } finally {
      await reader.close();
    }
  });

  it("restricts to one originId when supplied", async () => {
    // A single origin id filter: capturing under NODE_A and reading originId: NODE_A returns the row,
    // while reading a DIFFERENT origin id returns none (the filter bites), both under the same tenant.
    const b = await seedBase();
    await captureAProductWrite(b, "4.00");
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const mine = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { originId: NODE_A, afterSeq: 0n, limit: 100 }),
      );
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.every((r) => r.originId === NODE_A)).toBe(true);
      const none = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, {
          originId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          afterSeq: 0n,
          limit: 100,
        }),
      );
      expect(none).toEqual([]);
    } finally {
      await reader.close();
    }
  });

  it("restricts to the named tables when `tables` is supplied (the lane filter)", async () => {
    // A fast-lane table (payment_policy) and ordered-lane tables (catalogues from seedBase, products)
    // are all captured under one tenant. `tables: ['payment_policy','payments']` returns ONLY the fast
    // rows; `tables: <the ordered set>` returns the ordered rows and NOT payment_policy. The array binds
    // as a single `= any($n)` parameter — no identifier is interpolated (CLAUDE.md §3).
    const b = await seedBase();
    await captureAProductWrite(b, "1.50"); // products (ordered)
    await capturePaymentPolicyWrite(b); //     payment_policy (fast)
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const fast = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100, tables: ["payment_policy", "payments"] }),
      );
      expect(fast.length).toBeGreaterThanOrEqual(1);
      expect(fast.every((r) => r.table === "payment_policy" || r.table === "payments")).toBe(true);
      expect(fast.some((r) => r.table === "products")).toBe(false); // ordered rows excluded

      const ordered = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100, tables: ["catalogues", "products"] }),
      );
      expect(ordered.some((r) => r.table === "products")).toBe(true);
      expect(ordered.some((r) => r.table === "payment_policy")).toBe(false); // fast rows excluded

      // An EMPTY allowlist matches no table (a lane with no tables syncs nothing). The brief's
      // `= any('{}')` mechanism is unavailable — drizzle-orm expands an interpolated JS array into a
      // `($1, $2)` placeholder list, never a single Postgres array param (drain.ts:588) — so the guard
      // maps `[]` to `and false` rather than to "every table". Omitted is the every-table case, proven
      // by the three tests above that pass no `tables`.
      const nothing = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100, tables: [] }),
      );
      expect(nothing).toEqual([]);
    } finally {
      await reader.close();
    }
  });
});
