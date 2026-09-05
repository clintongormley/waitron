import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { ALL_MODULES } from "./modules.js";

// Real Postgres, not PGlite: this suite reads the pg_trigger catalog of a FULLY-MIGRATED database.
// The `manifest` template runs the whole migration manifest (sync last), so the clone carries every
// per-table `CREATE TRIGGER … sync_capture()` the sync migrations install. PGlite would migrate the
// same manifest, but the invariant here is about the catalog the production migration path produces,
// so the suite stays on the same real-PG template the other sync gate suites clone.
//
// The invariant (survey §4, SP-2a): SP-2a moved the enrolment metadata out of @waitron/sync into
// each owning package (CORE_ENROLMENT/IDENTITY_ENROLMENT/PAYMENTS_ENROLMENT), assembled by
// apps/server as `ALL_MODULES.flatMap((m) => m.sync ?? [])`. The capture-trigger DDL still lives in
// @waitron/sync's migrations, unchanged. Nothing checks that the assembled TS enrolment list and the
// installed triggers still agree — the manual convention a human kept in sync is now unguarded. This
// suite reads the ACTUAL catalog (not a hardcoded list) so any drift between the TS enrolment set and
// the DDL — a table enrolled with no trigger, or a trigger with no enrolment — fails here.
const postgres = useTemplateDb({ template: "manifest" });

describe("the assembled enrolment set equals the installed sync_capture triggers", () => {
  it("every enrolled table carries a sync_capture trigger, and vice versa (no drift)", async () => {
    // The distinct tables carrying a non-internal AFTER trigger whose function is `sync_capture`.
    // pg_trigger → pg_class (the table) → pg_proc (the trigger function); `not tgisinternal` drops
    // the constraint-backed system triggers, leaving only the ones the sync migrations declared.
    const rows = await postgres.admin.execute<{ table_name: string }>(sql`
      select distinct c.relname as table_name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
      where p.proname = 'sync_capture' and not t.tgisinternal`);
    const triggered = new Set(rows.rows.map((r) => r.table_name));

    const enrolled = new Set(ALL_MODULES.flatMap((m) => m.sync ?? []).map((e) => e.table));

    // Control against the trivial pass: if either read came back empty the sets would still be
    // "equal" only by both being empty, which would mean the manifest never migrated or the modules
    // list lost its enrolments. Pin the count so a silent zero is caught, not just a mismatch.
    expect(triggered.size).toBeGreaterThan(0);
    expect(enrolled.size).toBeGreaterThan(0);

    // The invariant: the two sets are identical. A table enrolled in TS with no installed trigger,
    // or an installed trigger over a table nobody enrolled, fails here. toEqual over Sets compares
    // membership regardless of order.
    expect(enrolled).toEqual(triggered);
  });
});
