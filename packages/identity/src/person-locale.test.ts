import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { setPersonLocale } from "./staff.js";
import { codeOf, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function localeOf(id: string): Promise<string | null> {
  const rows = await suite.db.execute<{ locale: string | null }>(
    sql`select locale from persons where id = ${id}`,
  );
  return rows.rows[0]!.locale;
}

describe("setPersonLocale", () => {
  it("writes a supported locale to the person's row", async () => {
    const personId = await seedPerson(suite.db); // locale null (no preference)

    await run((tx) => setPersonLocale(tx, { personId, locale: "en-GB" }));

    expect(await localeOf(personId)).toBe("en-GB");
  });

  it("rejects an unsupported locale and writes nothing", async () => {
    const personId = await seedPerson(suite.db); // locale null

    // "ca-ES" is not in SUPPORTED_LOCALES.
    const code = await codeOf(() =>
      run((tx) => setPersonLocale(tx, { personId, locale: "ca-ES" })),
    );
    expect(code).toBe("locale.unsupported");

    expect(await localeOf(personId)).toBeNull();
  });
});
