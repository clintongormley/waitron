import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { setPersonLocale } from "./staff.js";
import { codeOf, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: setPersonLocale is LOGIC — the supported-locale assertion, then the
// UPDATE. Nothing here depends on the privilege set (a PGlite connection is superuser holding every
// grant, so a grant assertion would be a false pass, CLAUDE.md §4).
let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

// Read `locale` back as the superuser owner. A validation that rejects
// BEFORE its UPDATE leaves the column untouched.
async function localeOf(id: string): Promise<string | null> {
  const rows = await suite.db.execute<{ locale: string | null }>(
    sql`select locale from persons where id = ${id}`,
  );
  return rows.rows[0]!.locale;
}

describe("setPersonLocale", () => {
  it("writes a supported locale to the person's row", async () => {
    const personId = await seedPerson(suite.db, tenantId); // locale null (no preference)

    await run((tx) => setPersonLocale(tx, { tenantId, personId, locale: "en-GB" }));

    expect(await localeOf(personId)).toBe("en-GB");
  });

  it("rejects an unsupported locale and writes nothing", async () => {
    const personId = await seedPerson(suite.db, tenantId); // locale null

    // "ca-ES" is not in SUPPORTED_LOCALES: assertSupportedLocale throws locale.unsupported BEFORE the
    // UPDATE, so the column stays null — a mutant that skips the assertion (writing "ca-ES") fails both
    // the code check and the null read-back.
    const code = await codeOf(() =>
      run((tx) => setPersonLocale(tx, { tenantId, personId, locale: "ca-ES" })),
    );
    expect(code).toBe("locale.unsupported");

    expect(await localeOf(personId)).toBeNull();
  });
});
