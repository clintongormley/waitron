import { asAppUser, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, DEFAULT_RECEIPT } from "./defaults.js";
import { getLayout, putLayout, putReceipt } from "./store.js";
import type { LayoutDef, ReceiptConfig } from "./types.js";

// Real Postgres, not PGlite: the store both AUTHORIZES (authorizeManager reads persons +
// management_sessions under the app role's RLS + grants) and UPSERTS till_layouts under
// FORCE ROW LEVEL SECURITY. PGlite runs every connection as a superuser, which bypasses FORCE and the
// tenant-isolation policy, so the cross-tenant isolation assertion and the "app role can run the
// whole authorize→upsert path" claim would both be false passes there (CLAUDE.md §4). Seeds run as
// the superuser owner (RLS bypassed — pure setup); every store call runs under withTenant + asAppUser
// so it is a genuine RLS subject, exactly as packages/db/src/schema/layouts.rls.test.ts and
// packages/catalogue/src/operations.rls.test.ts do. Both migration sets are applied, core first,
// because authorizeManager needs the identity tables and the store needs till_layouts — that pairing
// now lives in the package's globalSetup's `core_identity` template (`src/testing/global-setup.ts`),
// which this suite clones, in place of the INLINE `startMigratedPostgres` it used to run.

// A sale-critical-complete layout (validateLayout requires product-grid + basket + total + tender-pay,
// design D4). `columns` on the product grid is the one wired config key (design D6).
function saleLayout(columns: number): LayoutDef {
  return [
    { type: "product-grid", region: "main", config: { columns } },
    { type: "basket", region: "aside", config: {} },
    { type: "total", region: "aside", config: {} },
    { type: "tender-pay", region: "aside", config: {} },
  ];
}

const suite = useTemplateDb({ template: "core_identity" });

/** Run `fn` as the non-owner app role, scoped to `tenantId` — the shape the management/till routes
 * wrap every store call in (withTenant + asAppUser). */
function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Seed a person of `role` and an open management session for them, as the superuser owner. Returns
 * the session id the store's authorizeManager gate resolves. */
async function seedSession(tenantId: string, role: PersonRoleValue): Promise<string> {
  const person = await suite.admin.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, 'Operator', 'seed-pin-hash', ${role}) returning id`);
  const session = await withTenant(suite.admin, tenantId, (tx) =>
    startManagementSession(tx, { tenantId, personId: person.rows[0]!.id }),
  );
  return session.id;
}

/** The AppError code a rejected store call threw, or a describing string when it was not an AppError
 * (so a call that DID NOT throw — e.g. an authorizeManager gate deleted — reports plainly). */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

/** Rows for `tenantId` read straight as the superuser owner (RLS bypassed), to count duplicates the
 * app role could never see across the isolation policy. */
async function rowCount(tenantId: string): Promise<number> {
  const rows = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from till_layouts where tenant_id = ${tenantId}`,
  );
  return rows.rows[0]!.n;
}

describe("layouts store under real row-level security", () => {
  let managerTenant: string;
  let managerSession: string;

  beforeAll(async () => {
    // A shared tenant + manager session for the read/write/upsert/no-clobber tests. The isolation and
    // refusal tests seed their own tenants so a cross-test leak cannot flatter them.
    managerTenant = await seedTenant(suite.admin);
    managerSession = await seedSession(managerTenant, "manager");
  });

  it("returns the built-in defaults for a tenant that has never authored a layout", async () => {
    // A fresh tenant has no row — getLayout returns DEFAULT_LAYOUT/DEFAULT_RECEIPT rather than seeding
    // one (no backfill; the till boots against defaults, design §5).
    const fresh = await seedTenant(suite.admin);
    const result = await asApp(fresh, (tx) => getLayout(tx, fresh));
    expect(result).toEqual({ definition: DEFAULT_LAYOUT, receipt: DEFAULT_RECEIPT });
  });

  it("persists a manager-authored layout and reads it back verbatim", async () => {
    const definition = saleLayout(4);
    await asApp(managerTenant, (tx) =>
      putLayout(tx, { managementSessionId: managerSession, tenantId: managerTenant, definition }),
    );
    const result = await asApp(managerTenant, (tx) => getLayout(tx, managerTenant));
    // Read back exactly what was written; receipt stays at its default (putLayout never touches it).
    expect(result.definition).toEqual(definition);
    expect(result.receipt).toEqual(DEFAULT_RECEIPT);
  });

  it("refuses a putLayout from a staff-role session — the authorizeManager gate (differential)", async () => {
    // The differential the plan requires: staff holds no till.configure, so authorizeManager throws
    // authorization.not_permitted BEFORE any write. Deleting the authorizeManager call from putLayout
    // makes this call succeed → codeOf returns "did not throw…" and the write lands, failing both
    // assertions. That is the by-deletion proof this case exists for.
    const staffTenant = await seedTenant(suite.admin);
    const staffSession = await seedSession(staffTenant, "staff");
    const code = await codeOf(() =>
      asApp(staffTenant, (tx) =>
        putLayout(tx, {
          managementSessionId: staffSession,
          tenantId: staffTenant,
          definition: saleLayout(3),
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    // The gate runs before the upsert, so a denied actor wrote nothing — getLayout still sees defaults.
    const after = await asApp(staffTenant, (tx) => getLayout(tx, staffTenant));
    expect(after).toEqual({ definition: DEFAULT_LAYOUT, receipt: DEFAULT_RECEIPT });
    expect(await rowCount(staffTenant)).toBe(0);
  });

  it("upserts the single per-tenant row on a second putLayout — no duplicate", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    await asApp(tenantId, (tx) =>
      putLayout(tx, { managementSessionId: session, tenantId, definition: saleLayout(2) }),
    );
    await asApp(tenantId, (tx) =>
      putLayout(tx, { managementSessionId: session, tenantId, definition: saleLayout(6) }),
    );
    // ON CONFLICT (tenant_id) DO UPDATE — the second write replaces the row, never adds one.
    expect(await rowCount(tenantId)).toBe(1);
    const result = await asApp(tenantId, (tx) => getLayout(tx, tenantId));
    expect(result.definition).toEqual(saleLayout(6));
  });

  it("putLayout and putReceipt each update only their own column — neither clobbers the other", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const definition = saleLayout(5);
    const receipt: ReceiptConfig = { footerMessage: "Gracias por su visita" };

    // Author the RECEIPT first: this INSERTs the row with definition = DEFAULT_LAYOUT, receipt set.
    await asApp(tenantId, (tx) =>
      putReceipt(tx, { managementSessionId: session, tenantId, receipt }),
    );
    // Now author the LAYOUT: the ON CONFLICT UPDATE touches definition + updated_at only, so the
    // previously-authored receipt must survive. Deleting `updated_at`/setting receipt here is what a
    // clobbering upsert would look like.
    await asApp(tenantId, (tx) =>
      putLayout(tx, { managementSessionId: session, tenantId, definition }),
    );
    const afterLayout = await asApp(tenantId, (tx) => getLayout(tx, tenantId));
    expect(afterLayout.definition).toEqual(definition);
    expect(afterLayout.receipt).toEqual(receipt); // the receipt survived the putLayout

    // And the reverse: a putReceipt must not clobber the authored definition.
    const receipt2: ReceiptConfig = { headerSubtitle: "Calle Mayor 1" };
    await asApp(tenantId, (tx) =>
      putReceipt(tx, { managementSessionId: session, tenantId, receipt: receipt2 }),
    );
    const afterReceipt = await asApp(tenantId, (tx) => getLayout(tx, tenantId));
    expect(afterReceipt.receipt).toEqual(receipt2);
    expect(afterReceipt.definition).toEqual(definition); // the layout survived the putReceipt
  });

  it("keeps one tenant's authored layout invisible to another — RLS isolation", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const sessionA = await seedSession(tenantA, "manager");
    await asApp(tenantA, (tx) =>
      putLayout(tx, {
        managementSessionId: sessionA,
        tenantId: tenantA,
        definition: saleLayout(7),
      }),
    );
    // Tenant B authored nothing, so its own getLayout returns defaults (true even without RLS).
    const bOwn = await asApp(tenantB, (tx) => getLayout(tx, tenantB));
    expect(bOwn).toEqual({ definition: DEFAULT_LAYOUT, receipt: DEFAULT_RECEIPT });
    // The RLS differential: even asking for A's id from under B's GUC returns defaults, because the
    // policy's USING clause filters A's row out. Drop asAppUser (or the policy) and the superuser owner
    // would read A's saleLayout(7) here, failing this assertion.
    const aFromB = await asApp(tenantB, (tx) => getLayout(tx, tenantA));
    expect(aFromB.definition).toEqual(DEFAULT_LAYOUT);
  });
});
