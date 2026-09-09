import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { usePgliteDb } from "../testing/lifecycle.js";

// The core migration chain (0011_device_profile_inactivity_timeout_sql) adds a nullable
// `inactivity_timeout_seconds` integer to `device_profiles`. PGlite is sufficient here: this is about
// column shape and nullability, not grants or triggers (CLAUDE.md §4). The real-PG grant path is
// covered by the app-role suites in packages/layouts.
const TENANT = "11111111-1111-4111-8111-111111111111";

describe("device_profiles.inactivity_timeout_seconds", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });
  let admin: Database;

  beforeAll(async () => {
    admin = suite.db;
    await admin.execute(sql`
      insert into tenants (id, country, tax_id, legal_name)
      values (${TENANT}, 'ES', 'B00000000', 'Fixture Tenant')
      on conflict (id) do nothing`);
  });

  it("exists as a nullable integer column (information_schema)", async () => {
    const meta = await admin.execute<{ data_type: string; is_nullable: string }>(sql`
      select data_type, is_nullable
      from information_schema.columns
      where table_name = 'device_profiles' and column_name = 'inactivity_timeout_seconds'`);
    expect(meta.rows).toHaveLength(1);
    expect(meta.rows[0]!.data_type).toBe("integer");
    expect(meta.rows[0]!.is_nullable).toBe("YES");
  });

  it("defaults to NULL when omitted on insert, and round-trips a value", async () => {
    const omitted = await admin.execute<{ inactivity_timeout_seconds: number | null }>(sql`
      insert into device_profiles (tenant_id, name, form_factor)
      values (${TENANT}, 'No timeout', 'till')
      returning inactivity_timeout_seconds`);
    expect(omitted.rows[0]!.inactivity_timeout_seconds).toBeNull();

    const withValue = await admin.execute<{ inactivity_timeout_seconds: number | null }>(sql`
      insert into device_profiles (tenant_id, name, form_factor, inactivity_timeout_seconds)
      values (${TENANT}, 'Five minutes', 'phone-portrait', 300)
      returning inactivity_timeout_seconds`);
    expect(withValue.rows[0]!.inactivity_timeout_seconds).toBe(300);
  });
});
