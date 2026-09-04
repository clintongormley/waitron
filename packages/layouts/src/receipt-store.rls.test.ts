import { asAppUser, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RECEIPT } from "./defaults.js";
import { getReceipt, putReceipt } from "./receipt-store.js";
import type { ReceiptConfig } from "./types.js";

// Real Postgres, not PGlite: the receipt store both AUTHORIZES (authorizeManager reads persons +
// management_sessions under the app role's RLS + grants) and upserts tenant_receipts under FORCE ROW
// LEVEL SECURITY. PGlite runs every connection as a superuser, which bypasses FORCE and the
// tenant-isolation policy, so the cross-tenant isolation assertion and the "app role can run the whole
// authorize→upsert path" claim would both be false passes there (CLAUDE.md §4). Seeds run as the
// superuser owner (RLS bypassed — pure setup); every store call runs under withTenant + asAppUser so
// it is a genuine RLS subject, exactly as theme-store.rls.test.ts (tenant_themes) does. The
// `core_identity` template pairs core + identity migrations so authorizeManager's tables and
// tenant_receipts both exist.

const suite = useTemplateDb({ template: "core_identity" });

function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

async function seedSession(tenantId: string, role: PersonRoleValue): Promise<string> {
  const person = await suite.admin.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, 'Operator', 'seed-pin-hash', ${role}) returning id`);
  const session = await withTenant(suite.admin, tenantId, (tx) =>
    startManagementSession(tx, { tenantId, personId: person.rows[0]!.id }),
  );
  return session.id;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

async function rowCount(tenantId: string): Promise<number> {
  const rows = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from tenant_receipts where tenant_id = ${tenantId}`,
  );
  return rows.rows[0]!.n;
}

describe("tenant receipt store under real row-level security", () => {
  let managerTenant: string;
  let managerSession: string;

  beforeAll(async () => {
    managerTenant = await seedTenant(suite.admin);
    managerSession = await seedSession(managerTenant, "manager");
  });

  it("returns DEFAULT_RECEIPT ({}) for a tenant that has never authored a receipt", async () => {
    // Unlike getTenantTheme (which returns undefined on absence), getReceipt returns the built-in
    // DEFAULT_RECEIPT so the till boot always has a trim to render around the mandated fiscal art.
    const fresh = await seedTenant(suite.admin);
    expect(await asApp(fresh, (tx) => getReceipt(tx, fresh))).toEqual(DEFAULT_RECEIPT);
  });

  it("round-trips a manager-authored receipt through put → get", async () => {
    const receipt: ReceiptConfig = { headerSubtitle: "Hola" };
    await asApp(managerTenant, (tx) =>
      putReceipt(tx, { managementSessionId: managerSession, tenantId: managerTenant, receipt }),
    );
    expect(await asApp(managerTenant, (tx) => getReceipt(tx, managerTenant))).toEqual(receipt);
  });

  it("upserts the single per-tenant row on a second put — no duplicate", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    await asApp(tenantId, (tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        tenantId,
        receipt: { headerSubtitle: "Calle Mayor 1" },
      }),
    );
    const next: ReceiptConfig = { footerMessage: "Gracias por su visita" };
    await asApp(tenantId, (tx) =>
      putReceipt(tx, { managementSessionId: session, tenantId, receipt: next }),
    );
    // ON CONFLICT (tenant_id) DO UPDATE — the second write replaces the row, never adds one.
    expect(await rowCount(tenantId)).toBe(1);
    expect(await asApp(tenantId, (tx) => getReceipt(tx, tenantId))).toEqual(next);
  });

  it("refuses a put from a staff-role session — the authorizeManager gate (differential)", async () => {
    // The by-deletion proof: staff holds no till.configure, so authorizeManager throws
    // authorization.not_permitted BEFORE any write. Deleting the authorizeManager call from putReceipt
    // makes this succeed → codeOf returns "did not throw…" and a row lands, failing both assertions.
    const staffTenant = await seedTenant(suite.admin);
    const staffSession = await seedSession(staffTenant, "staff");
    const code = await codeOf(() =>
      asApp(staffTenant, (tx) =>
        putReceipt(tx, {
          managementSessionId: staffSession,
          tenantId: staffTenant,
          receipt: { footerMessage: "Gracias" },
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount(staffTenant)).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid receipt with receipt.invalid before any INSERT", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    // authorize FIRST (manager is permitted), THEN validate — so an invalid receipt from an AUTHORISED
    // actor proves validate runs before the write. An unknown field fails validateReceiptConfig.
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        putReceipt(tx, {
          managementSessionId: session,
          tenantId,
          receipt: { unknownField: "x" },
        }),
      ),
    );
    expect(code).toBe("receipt.invalid");
    expect(await rowCount(tenantId)).toBe(0); // validate threw before the INSERT
  });

  it("keeps one tenant's receipt invisible to another — RLS isolation", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const sessionA = await seedSession(tenantA, "manager");
    await asApp(tenantA, (tx) =>
      putReceipt(tx, {
        managementSessionId: sessionA,
        tenantId: tenantA,
        receipt: { footerMessage: "Solo para A" },
      }),
    );
    // B authored nothing, so its own get returns DEFAULT_RECEIPT. Even asking under B's GUC never
    // surfaces A's row — the policy's USING clause filters it out. Drop asAppUser (or the policy) and
    // the superuser owner would read A's row here.
    expect(await asApp(tenantB, (tx) => getReceipt(tx, tenantB))).toEqual(DEFAULT_RECEIPT);
    expect(await asApp(tenantB, (tx) => getReceipt(tx, tenantA))).toEqual(DEFAULT_RECEIPT);
  });
});
