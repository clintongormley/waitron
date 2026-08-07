import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import {
  endManagementSession,
  resolveManagementSession,
  startManagementSession,
} from "./management-session.js";
import { codeOf, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: this suite tests the lifecycle LOGIC — start/resolve/end, the idle
// timeout, and the mid-session status re-check. A PGlite connection is superuser, so RLS is a false
// pass here (CLAUDE.md §4); tenant-isolation of management_sessions is proven as the app role in
// management-sessions.rls.test.ts and is not re-proven here.
let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
  withTenant(suite.db, tenantId, fn);

describe("management session lifecycle", () => {
  it("starts and resolves a session, returning the person's role", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    const resolved = await run((tx) => resolveManagementSession(tx, session.id));
    expect(resolved).toEqual({ personId, role: "manager" });
  });

  it("throws management_session.required for an unknown id", async () => {
    const code = await run((tx) =>
      codeOf(() => resolveManagementSession(tx, "00000000-0000-4000-8000-000000000000")),
    );
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.required after endManagementSession", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    expect(await run((tx) => endManagementSession(tx, session.id))).toBe(true);
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.id)));
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.expired past the idle timeout", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    // Age last_seen_at beyond the timeout via a raw SQL update — deterministic, no clock injection.
    await run((tx) =>
      tx.execute(
        sql`update management_sessions set last_seen_at = now() - interval '2 days' where id = ${session.id}`,
      ),
    );
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.id)));
    expect(code).toBe("management_session.expired");
  });

  it("throws person.suspended when the person is suspended mid-session", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const session = await run((tx) => startManagementSession(tx, { tenantId, personId }));
    await run((tx) =>
      tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`),
    );
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.id)));
    expect(code).toBe("person.suspended");
  });
});
