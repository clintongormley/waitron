import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { type Database, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, verifyPassword } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { runBreakGlassReset } from "./break-glass-command.js";

// Real Postgres, not PGlite: the reset writes `persons` under FORCE ROW LEVEL SECURITY as the
// non-owner app role, and `withTenant` scoping that write is exactly what PGlite's superuser
// connection cannot exercise (CLAUDE.md §4). The box's DATABASE_URL is the app_login/app_user
// connection, so the test's `connect` returns an `app_login` pool — the same shape as production.
const LOCALE = "es-ES";
const OLD_PASSWORD = "dashPass123"; // ≥ MIN_PASSWORD_LENGTH; the seeded admin's original password.
const NEW_PASSWORD = "brandNewSecret"; // what break-glass sets.

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each provisioned venue needs its own NIF — the per-suite counter the siblings use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(73_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Stand up a fresh provisioned venue (as the owner). Provisioning seeds exactly one ADMIN with the
 * given password; returns the tenant plus that admin's id. */
async function setupTenant(
  adminPassword: string = OLD_PASSWORD,
): Promise<{ tenantId: string; adminId: string }> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(adminPassword),
      },
    }),
    { db: suite.admin },
  );
  const adminId = await readSoleAdminId(venue.tenantId);
  return { tenantId: venue.tenantId, adminId };
}

/** Open a fresh `app_login` (member of app_user) pool, run `fn`, and always close it — the house
 * per-test connectAs pattern (a try/finally closer is outside guarded-teardowns' remit). */
async function withAppUserDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = await suite.pg.connectAs("app_login", "app_pw");
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function readSoleAdminId(tenantId: string): Promise<string> {
  return withAppUserDb((db) =>
    withTenant(db, tenantId, async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        sql`select id from persons where role = 'admin'`,
      );
      return rows.rows[0]!.id;
    }),
  );
}

/** Read one person's password_hash + status back as the app role under the tenant. */
async function readPerson(
  tenantId: string,
  personId: string,
): Promise<{ passwordHash: string | null; status: string } | undefined> {
  return withAppUserDb((db) =>
    withTenant(db, tenantId, async (tx) => {
      const rows = await tx.execute<{ password_hash: string | null; status: string }>(
        sql`select password_hash, status from persons where id = ${personId}`,
      );
      const row = rows.rows[0];
      return row === undefined
        ? undefined
        : { passwordHash: row.password_hash, status: row.status };
    }),
  );
}

/** Run the command with a `connect` that hands back a real app_login pool (the URL is ignored — the
 * container is fixed for the suite). Collects `out` lines. */
async function run(
  env: Record<string, string | undefined>,
  argv: string[] = [],
): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await runBreakGlassReset({
    argv,
    env,
    out: (line) => out.push(line),
    connect: () => suite.pg.connectAs("app_login", "app_pw"),
  });
  return { code, out };
}

// `null` (not `undefined`) means "omit the password env var" — an explicit `undefined` argument
// would trigger the `= NEW_PASSWORD` default and defeat the very test that wants it absent.
function baseEnv(tenantId: string, password: string | null = NEW_PASSWORD) {
  return {
    DATABASE_URL: "postgres://ignored-in-test",
    WAITRON_TILL_TENANT_ID: tenantId,
    ...(password === null ? {} : { WAITRON_BREAKGLASS_PASSWORD: password }),
  };
}

describe("runBreakGlassReset (real postgres, app role under FORCE RLS)", () => {
  it("resets the admin's password: the new one verifies, the old one fails (login restored)", async () => {
    const { tenantId, adminId } = await setupTenant();

    const { code, out } = await run(baseEnv(tenantId));

    expect(code).toBe(0);
    const person = await readPerson(tenantId, adminId);
    expect(person).toBeDefined();
    // The real proof the reset took: the NEW password verifies against the stored hash, the OLD one
    // no longer does.
    expect(verifyPassword(NEW_PASSWORD, person!.passwordHash!)).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, person!.passwordHash!)).toBe(false);
    // Success line names the admin, never the secret.
    expect(out.join("\n")).toMatch(adminId);
    expect(out.join("\n")).not.toMatch(NEW_PASSWORD);
  });

  it("optionally resets the PIN when WAITRON_BREAKGLASS_PIN is set", async () => {
    const { tenantId, adminId } = await setupTenant();
    const before = await readPerson(tenantId, adminId);

    const { code } = await run({ ...baseEnv(tenantId), WAITRON_BREAKGLASS_PIN: "9999" });
    expect(code).toBe(0);

    // Read the pin_hash directly and confirm it changed to the new PIN's hash-verifiable value.
    const after = await withAppUserDb((db) =>
      withTenant(db, tenantId, async (tx) => {
        const rows = await tx.execute<{ pin_hash: string }>(
          sql`select pin_hash from persons where id = ${adminId}`,
        );
        return rows.rows[0]!.pin_hash;
      }),
    );
    expect(before).toBeDefined();
    // A new hash was written (salted scrypt, so it differs from the seed's) and it verifies "9999".
    const { verifyPin } = await import("@waitron/identity");
    expect(verifyPin("9999", after)).toBe(true);
    expect(verifyPin("1234", after)).toBe(false);
  });

  it("reactivates a suspended admin (status → active)", async () => {
    const { tenantId, adminId } = await setupTenant();
    // Suspend the admin as the owner (the app role holds UPDATE too, but the owner is simplest here).
    await withTenant(suite.admin, tenantId, async (tx) => {
      await tx.execute(sql`update persons set status = 'suspended' where id = ${adminId}`);
    });
    expect((await readPerson(tenantId, adminId))!.status).toBe("suspended");

    const { code } = await run(baseEnv(tenantId));
    expect(code).toBe(0);
    expect((await readPerson(tenantId, adminId))!.status).toBe("active");
  });

  it("missing new-password env → returns 2 (usage) and does NOT touch the row", async () => {
    const { tenantId, adminId } = await setupTenant();
    const before = await readPerson(tenantId, adminId);

    const { code } = await run(baseEnv(tenantId, null));
    expect(code).toBe(2);

    const after = await readPerson(tenantId, adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it("too-short new password → returns 2, row untouched", async () => {
    const { tenantId, adminId } = await setupTenant();
    const before = await readPerson(tenantId, adminId);

    const { code } = await run(baseEnv(tenantId, "short")); // < MIN_PASSWORD_LENGTH (8)
    expect(code).toBe(2);

    const after = await readPerson(tenantId, adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it("missing DATABASE_URL / tenant id → returns 2", async () => {
    const noUrl = await run({
      WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      WAITRON_BREAKGLASS_PASSWORD: NEW_PASSWORD,
    });
    expect(noUrl.code).toBe(2);
    const noTenant = await run({
      DATABASE_URL: "postgres://ignored",
      WAITRON_BREAKGLASS_PASSWORD: NEW_PASSWORD,
    });
    expect(noTenant.code).toBe(2);
  });

  it("no admin for the tenant → returns 1, message names it", async () => {
    // A tenant id with no venue: RLS scopes the select to it, and it has no persons.
    const emptyTenant = "22222222-2222-4222-8222-222222222222";
    const { code, out } = await run(baseEnv(emptyTenant));
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/no admin/i);
  });

  it("two admins, no --person → returns 1 and lists both ids; --person resets exactly one", async () => {
    const { tenantId, adminId } = await setupTenant();
    // Insert a second admin as the app role (app_user holds INSERT on persons).
    const secondId = await withAppUserDb((db) =>
      withTenant(db, tenantId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
          values (current_tenant_id(), 'Second Admin', ${hashPin("1234")}, ${hashPassword(OLD_PASSWORD)}, 'admin')
          returning id`);
        return rows.rows[0]!.id;
      }),
    );

    const ambiguous = await run(baseEnv(tenantId));
    expect(ambiguous.code).toBe(1);
    const joined = ambiguous.out.join("\n");
    expect(joined).toMatch(adminId);
    expect(joined).toMatch(secondId);
    // Neither row was reset — both still verify the OLD password.
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(tenantId, adminId))!.passwordHash!)).toBe(
      true,
    );
    expect(
      verifyPassword(OLD_PASSWORD, (await readPerson(tenantId, secondId))!.passwordHash!),
    ).toBe(true);

    // With --person, exactly that one is reset and the other is left alone.
    const targeted = await run(baseEnv(tenantId), ["--person", secondId]);
    expect(targeted.code).toBe(0);
    expect(
      verifyPassword(NEW_PASSWORD, (await readPerson(tenantId, secondId))!.passwordHash!),
    ).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(tenantId, adminId))!.passwordHash!)).toBe(
      true,
    );
  });

  it("--person as the last token (no following id) → returns 2 (usage), nothing reset", async () => {
    const { tenantId, adminId } = await setupTenant();
    const before = await readPerson(tenantId, adminId);
    // `--person` with nothing after it must not silently degrade to "no --person" and reset the
    // sole admin — it is an operator typo, so fail as a usage error and touch nothing.
    const { code, out } = await run(baseEnv(tenantId), ["--person"]);
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/--person/);
    const after = await readPerson(tenantId, adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it("--person naming a non-admin/absent id → returns 1, nothing reset", async () => {
    const { tenantId, adminId } = await setupTenant();
    const { code } = await run(baseEnv(tenantId), [
      "--person",
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(code).toBe(1);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(tenantId, adminId))!.passwordHash!)).toBe(
      true,
    );
  });

  it("the new credential is read from env, never argv: a password in argv is ignored", async () => {
    const { tenantId, adminId } = await setupTenant();
    const before = await readPerson(tenantId, adminId);
    // No WAITRON_BREAKGLASS_PASSWORD in env; the secret is smuggled into argv instead.
    const { code } = await run(baseEnv(tenantId, null), ["--person", adminId, NEW_PASSWORD]);
    // Usage error (no env password) and the row is untouched — argv never supplies the secret.
    expect(code).toBe(2);
    const after = await readPerson(tenantId, adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });
});
