import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { ALL_SYNC_ENROLMENTS } from "./modules.js";

// The invariant (survey §4, SP-2a): SP-2a moved the enrolment metadata out of @waitron/sync into
// each owning package (CORE_ENROLMENT/IDENTITY_ENROLMENT/PAYMENTS_ENROLMENT), assembled by
// apps/server as `ALL_SYNC_ENROLMENTS` (`ALL_MODULES.flatMap((m) => m.sync ?? [])`). The capture-trigger DDL still lives in
// @waitron/sync's migrations, unchanged. Nothing checks that the assembled TS enrolment list and the
// installed triggers still agree — the manual convention a human kept in sync is now unguarded. This
// suite reads the ACTUAL catalog (not a hardcoded list) so any drift between the TS enrolment set and
// the DDL — a table enrolled with no trigger, or a trigger with no enrolment — fails here.
const postgres = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("the assembled enrolment set equals the installed sync_capture triggers", () => {
  it("every enrolled table carries a sync_capture trigger, and vice versa (no drift)", async () => {
    // The distinct tables carrying a non-internal AFTER trigger whose function is `sync_capture`.
    // pg_trigger → pg_class (the table) → pg_proc (the trigger function); `not tgisinternal` drops
    // the constraint-backed system triggers, leaving only the ones the sync migrations declared.
    const rows = await postgres.db.execute<{ table_name: string }>(sql`
      select distinct c.relname as table_name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
      where p.proname = 'sync_capture' and not t.tgisinternal`);
    const triggered = new Set(rows.rows.map((r) => r.table_name));

    const enrolled = new Set(ALL_SYNC_ENROLMENTS.map((e) => e.table));

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
