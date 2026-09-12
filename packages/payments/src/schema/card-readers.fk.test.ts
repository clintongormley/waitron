import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, captureError, pgErrorCode, pgErrorMessage, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { freshNif } from "../../test/seed.js";
import { cardReaders } from "./card-readers.js";

// Real Postgres, not PGlite: this suite doubles as the grant check (CLAUDE.md §4). It writes under
// `app_user`'s grants (`asAppUser` inside the transaction), so a missing SELECT/INSERT/UPDATE grant
// from 0004_card_readers_sql.sql fails here, whereas PGlite connects as a superuser holding every
// grant and would pass regardless. A clone of the `core_payments` template (CORE + PAYMENTS).
const postgres = useTemplateDb({ template: "core_payments" });

/** Seeds one tenant (the only row card_readers' FK needs) and returns its id. */
async function seedTenant(db: Database): Promise<string> {
  const t = await db.execute<{ id: string }>(sql`
    insert into tenants (country, tax_id, legal_name)
    values ('ES', ${freshNif()}, 'Test SL') returning id`);
  return t.rows[0]!.id;
}

describe("card_readers", () => {
  it("stores a reader and rejects a duplicate (tenant, provider, provider_ref)", async () => {
    const db = postgres.admin;
    const tenantId = await seedTenant(db);

    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx
        .insert(cardReaders)
        .values({ tenantId, provider: "sumup", providerRef: "rdr_1", name: "Counter" });
    });

    // Round-trips: the row is readable and its defaults are what the schema promises.
    const stored = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(cardReaders)
        .where(and(eq(cardReaders.tenantId, tenantId), eq(cardReaders.providerRef, "rdr_1")));
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe("Counter");
    expect(stored[0]!.provider).toBe("sumup");
    expect(stored[0]!.active).toBe(true);
    expect(stored[0]!.disabledAt).toBeNull();

    // The (tenant_id, provider, provider_ref) unique rejects a second reader with the same ref.
    // `tx.insert` wraps the PG error in a DrizzleQueryError whose top-level `.message` is the
    // generic "Failed query: …"; the constraint name lives on `.cause`, read by `pgErrorMessage`.
    const dup = await captureError(() =>
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx
          .insert(cardReaders)
          .values({ tenantId, provider: "sumup", providerRef: "rdr_1", name: "Dup" });
      }),
    );
    expect(pgErrorCode(dup)).toBe("23505"); // unique_violation
    expect(pgErrorMessage(dup)).toMatch(/card_readers_provider_ref_key/);
  });
});
