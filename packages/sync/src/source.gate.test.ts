import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { readSyncLogSince } from "./source.js";

// Catalogue fixture writes are captured with the all-zero origin before product writes. Tests
// locate the product explicitly. PostgreSQL exercises source reads through a non-superuser app_user
// member; PGlite's superuser sessions cannot check its grants. Global setup creates both LOGIN
// fixtures once per cluster, and this file clones one migrated template.
const postgres = useTemplateDb({ template: "manifest" });

// Reads cover the whole database, so each case removes the previous case's captured rows.
afterEach(async () => {
  await postgres.admin.execute(sql`delete from sync_log`);
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
 * sync_log carrying `unit_price` as the captured numeric so we can assert byte-identity
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

/** An app_login write into `payment_policy` (an ORDERED-lane table — payments' PAYMENTS_ENROLMENT —
 * used here purely
 * as a distinct `table_name`, NOT for its lane: readSyncLogSince's `tables` filter is lane-agnostic, it
 * groups by table_name; watermark table, standalone PK tenant_id, no FK parent needed beyond the tenant)
 * under withTenant{nodeId: NODE_A}, so sync_capture writes one payment_policy row to sync_log. Columns per
 * payments' payment-policy schema: tenant_id, offline_mode (text, NOT NULL, CHECK in
 * ('accept_offline','cash_only')), offline_amount_cap (numeric, NOT NULL, CHECK >= 0); created_at/updated_at
 * default. Same INSERT shape as packages/payments/test/seed.ts:136. Used to prove readSyncLogSince's
 * `tables` filter separates two arbitrary table_name groups. */
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

describe("readSyncLogSince reads sync_log as app_user", () => {
  it("selects sync_log rows past afterSeq as app_user, with row_image as raw jsonb TEXT", async () => {
    // seq must remain bigint and row_image must remain raw TEXT (design §4b):
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

  it("afterSeq is EXCLUSIVE", async () => {
    // Captured rows have ascending seqs; a read past the first returns only later rows.
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

  it("restricts to the named tables when `tables` is supplied (the table_name filter lane routing builds on)", async () => {
    // readSyncLogSince's `tables` filter is lane-AGNOSTIC — it selects by `table_name`, so this drives it
    // with two arbitrary table_name GROUPS, not lanes. Captured under one tenant: a payment_policy row (an
    // ORDERED-lane table, registry.ts:162), plus products and catalogues (the products write and seedBase).
    // `tables: ['payment_policy','payments']` returns ONLY that group's rows — the payment_policy row (no
    // `payments` row is captured); `tables: ['catalogues','products']` returns the other group and NOT
    // payment_policy. The filter binds as `in ($1, $2, …)`, each table name its own param — no identifier is
    // interpolated (CLAUDE.md §3); not `= any(${tables})`, which drizzle expands to `any(($1, $2))` and
    // fails 42809 (see source.ts and packages/fiscal-verifactu/src/drain.ts:588).
    const b = await seedBase();
    await captureAProductWrite(b, "1.50"); // products (ordered)
    await capturePaymentPolicyWrite(b); //     payment_policy (ordered-lane table, a distinct table_name)
    const reader = await postgres.pg.connectAs("sync_reader", "rp");
    try {
      const groupA = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100, tables: ["payment_policy", "payments"] }),
      );
      expect(groupA.length).toBeGreaterThanOrEqual(1);
      expect(groupA.every((r) => r.table === "payment_policy" || r.table === "payments")).toBe(
        true,
      );
      expect(groupA.some((r) => r.table === "products")).toBe(false); // group B's rows excluded

      const groupB = await withTenant(reader, b.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq: 0n, limit: 100, tables: ["catalogues", "products"] }),
      );
      expect(groupB.some((r) => r.table === "products")).toBe(true);
      expect(groupB.some((r) => r.table === "payment_policy")).toBe(false); // group A's rows excluded

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
