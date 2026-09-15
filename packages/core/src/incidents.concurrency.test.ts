// Real Postgres: two callers on distinct backends. PGlite serialises every query onto one backend,
// so a race there is a false pass (CLAUDE.md §4).
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { AppError } from "@waitron/shared";
import { seedTenant } from "../test/fixtures.js";
import {
  findIncident,
  listOpenIncidents,
  markIncidentHandled,
  recordIncident,
} from "./incidents.js";

const postgres = useTemplateDb({ template: "core_identity" });

const BASE = new Date("2026-03-01T12:05:00.000Z");

/** Waits until a backend in this clone is waiting on a lock: the proof that the second caller has
 * reached the row the first caller holds, rather than merely not having finished yet. */
async function waitForLockWaiter(): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await postgres.admin.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
      where wait_event_type = 'Lock' and datname = current_database()`);
    if ((rows[0]?.n ?? 0) >= 1) return;
    if (Date.now() > deadline) throw new Error("no backend waited on a lock within 10s");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("markIncidentHandled — two managers at once", () => {
  it("keeps the first committed handler and time, and both calls succeed", async () => {
    const seed = await seedTenant(postgres.admin);
    await withTransaction(postgres.admin, async (tx) => {
      await asAppUser(tx);
      await recordIncident(tx, {
        tenantId: seed.tenantId,
        tillId: seed.tillId,
        error: new AppError("chain.verification_failed", {
          tillId: seed.tillId,
          issues: [{ issueCode: "predecessor-hash-mismatch", recordId: null, issueParams: {} }],
        }),
        severity: "error",
        detectedAt: BASE,
      });
    });
    const [open] = await withTransaction(postgres.admin, async (tx) => {
      await asAppUser(tx);
      return listOpenIncidents(tx, seed.tenantId);
    });
    const first = { personId: "00000000-0000-4000-8000-000000000001", handledAt: BASE };
    const second = {
      personId: "00000000-0000-4000-8000-000000000002",
      handledAt: new Date(BASE.getTime() + 5_000),
    };
    const mark = (db: Database, by: typeof first) =>
      withTransaction(db, async (tx) => {
        await asAppUser(tx);
        await markIncidentHandled(tx, { tenantId: seed.tenantId, id: open!.id, ...by });
      });

    let holder: Database | undefined;
    let waiter: Database | undefined;
    let release: () => void = () => {};
    let holderRun: Promise<void> | undefined;
    let waiterRun: Promise<void> | undefined;
    try {
      holder = await postgres.pg.connect();
      waiter = await postgres.pg.connect();
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));

      // The holder's update locks the row and pauses before commit, so the waiter's update must
      // wait for it and then re-check the row the holder committed.
      holderRun = withTransaction(holder, async (tx) => {
        await asAppUser(tx);
        await markIncidentHandled(tx, { tenantId: seed.tenantId, id: open!.id, ...first });
        acquire();
        await held;
      });
      await acquired;
      waiterRun = mark(waiter, second);
      await waitForLockWaiter();

      release();
      await holderRun;
      await waiterRun;
    } finally {
      release();
      if (holderRun !== undefined) await holderRun.catch(() => {});
      if (waiterRun !== undefined) await waiterRun.catch(() => {});
      if (holder !== undefined) await holder.close();
      if (waiter !== undefined) await waiter.close();
    }

    const stored = await withTransaction(postgres.admin, async (tx) => {
      await asAppUser(tx);
      return findIncident(tx, seed.tenantId, open!.id);
    });
    expect({
      personId: stored?.acknowledgedBy,
      handledAt: stored?.acknowledgedAt?.toISOString(),
    }).toEqual({ personId: first.personId, handledAt: first.handledAt.toISOString() });
  });
});
