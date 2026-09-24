import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ThemeOverride } from "./canvas.js";
import { getTenantTheme, putTenantTheme } from "./theme-store.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Through drizzle rather than raw SQL: `persons.id` and `created_at` take their value from the
 * table's `$defaultFn`, which is not a SQL DEFAULT, so a raw insert naming neither is refused
 * `NOT NULL constraint failed: persons.id`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.token;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

async function rowCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from tenant_themes`);
  return rows.rows[0]!.n;
}

describe("tenant theme store against a real migrated database", () => {
  it("returns undefined for a tenant that has never authored a theme", async () => {
    await seedTenant(suite.db);
    expect(await inTx((tx) => getTenantTheme(tx))).toBeUndefined();
  });

  it("round-trips a manager-authored theme through put → get", async () => {
    await seedTenant(suite.db);
    const managerSession = await seedSession("manager");
    const theme: ThemeOverride = { tokens: { "--wt-color-primary": "#ff0000" } };
    await inTx((tx) => putTenantTheme(tx, { managementSessionId: managerSession, theme }));
    expect(await inTx((tx) => getTenantTheme(tx))).toEqual(theme);
  });

  it("upserts the single per-tenant row on a second put — no duplicate", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      putTenantTheme(tx, {
        managementSessionId: session,
        theme: { tokens: { "--wt-color-primary": "#111111" } },
      }),
    );
    const next: ThemeOverride = { tokens: { "--wt-color-surface": "#222222" } };
    await inTx((tx) => putTenantTheme(tx, { managementSessionId: session, theme: next }));
    expect(await rowCount()).toBe(1);
    expect(await inTx((tx) => getTenantTheme(tx))).toEqual(next);
  });

  it("refuses a put from a staff-role session — the authorizeManager gate (differential)", async () => {
    await seedTenant(suite.db);
    const staffSession = await seedSession("staff");
    const code = await codeOf(() =>
      inTx((tx) =>
        putTenantTheme(tx, {
          managementSessionId: staffSession,
          theme: { tokens: { "--wt-color-primary": "#000000" } },
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount()).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid theme with theme.invalid before any INSERT", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    // A manager passes the gate, so this refusal is validation's.
    const code = await codeOf(() =>
      inTx((tx) =>
        putTenantTheme(tx, {
          managementSessionId: session,
          theme: { tokens: { "--evil": "red" } },
        }),
      ),
    );
    expect(code).toBe("theme.invalid");
    expect(await rowCount()).toBe(0); // validate threw before the INSERT
  });
});
