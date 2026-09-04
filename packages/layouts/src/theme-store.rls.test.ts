import { asAppUser, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { ThemeOverride } from "./canvas.js";
import { getTenantTheme, putTenantTheme } from "./theme-store.js";

// Real Postgres, not PGlite: the theme store both AUTHORIZES (authorizeManager reads persons +
// management_sessions under the app role's RLS + grants) and upserts tenant_themes under FORCE ROW
// LEVEL SECURITY. PGlite runs every connection as a superuser, which bypasses FORCE and the
// tenant-isolation policy, so the cross-tenant isolation assertion and the "app role can run the whole
// authorize→upsert path" claim would both be false passes there (CLAUDE.md §4). Seeds run as the
// superuser owner (RLS bypassed — pure setup); every store call runs under withTenant + asAppUser so
// it is a genuine RLS subject, exactly as the sibling store suites do. The `core_identity`
// template pairs core + identity migrations so authorizeManager's tables and tenant_themes both exist.

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
    sql`select count(*)::int as n from tenant_themes where tenant_id = ${tenantId}`,
  );
  return rows.rows[0]!.n;
}

describe("tenant theme store under real row-level security", () => {
  let managerTenant: string;
  let managerSession: string;

  beforeAll(async () => {
    managerTenant = await seedTenant(suite.admin);
    managerSession = await seedSession(managerTenant, "manager");
  });

  it("returns undefined for a tenant that has never authored a theme", async () => {
    const fresh = await seedTenant(suite.admin);
    expect(await asApp(fresh, (tx) => getTenantTheme(tx, fresh))).toBeUndefined();
  });

  it("round-trips a manager-authored theme through put → get", async () => {
    const theme: ThemeOverride = { tokens: { "--wt-color-primary": "#ff0000" } };
    await asApp(managerTenant, (tx) =>
      putTenantTheme(tx, { managementSessionId: managerSession, tenantId: managerTenant, theme }),
    );
    expect(await asApp(managerTenant, (tx) => getTenantTheme(tx, managerTenant))).toEqual(theme);
  });

  it("upserts the single per-tenant row on a second put — no duplicate", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    await asApp(tenantId, (tx) =>
      putTenantTheme(tx, {
        managementSessionId: session,
        tenantId,
        theme: { tokens: { "--wt-color-primary": "#111111" } },
      }),
    );
    const next: ThemeOverride = { tokens: { "--wt-color-surface": "#222222" } };
    await asApp(tenantId, (tx) =>
      putTenantTheme(tx, { managementSessionId: session, tenantId, theme: next }),
    );
    // ON CONFLICT (tenant_id) DO UPDATE — the second write replaces the row, never adds one.
    expect(await rowCount(tenantId)).toBe(1);
    expect(await asApp(tenantId, (tx) => getTenantTheme(tx, tenantId))).toEqual(next);
  });

  it("refuses a put from a staff-role session — the authorizeManager gate (differential)", async () => {
    // The by-deletion proof: staff holds no till.configure, so authorizeManager throws
    // authorization.not_permitted BEFORE any write. Deleting the authorizeManager call from
    // putTenantTheme makes this succeed → codeOf returns "did not throw…" and a row lands, failing both
    // assertions.
    const staffTenant = await seedTenant(suite.admin);
    const staffSession = await seedSession(staffTenant, "staff");
    const code = await codeOf(() =>
      asApp(staffTenant, (tx) =>
        putTenantTheme(tx, {
          managementSessionId: staffSession,
          tenantId: staffTenant,
          theme: { tokens: { "--wt-color-primary": "#000000" } },
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount(staffTenant)).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid theme with theme.invalid before any INSERT", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    // authorize FIRST (manager is permitted), THEN validate — so an invalid theme from an AUTHORISED
    // actor proves validate runs before the write. An un-allowlisted token fails validateThemeOverride.
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        putTenantTheme(tx, {
          managementSessionId: session,
          tenantId,
          theme: { tokens: { "--evil": "red" } },
        }),
      ),
    );
    expect(code).toBe("theme.invalid");
    expect(await rowCount(tenantId)).toBe(0); // validate threw before the INSERT
  });

  it("keeps one tenant's theme invisible to another — RLS isolation", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const sessionA = await seedSession(tenantA, "manager");
    await asApp(tenantA, (tx) =>
      putTenantTheme(tx, {
        managementSessionId: sessionA,
        tenantId: tenantA,
        theme: { tokens: { "--wt-color-primary": "#abcdef" } },
      }),
    );
    // B authored nothing, so its own get returns undefined. Even asking under B's GUC never surfaces
    // A's row — the policy's USING clause filters it out. Drop asAppUser (or the policy) and the
    // superuser owner would read A's row here.
    expect(await asApp(tenantB, (tx) => getTenantTheme(tx, tenantB))).toBeUndefined();
    expect(await asApp(tenantB, (tx) => getTenantTheme(tx, tenantA))).toBeUndefined();
  });
});
