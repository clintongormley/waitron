import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { seedTenant } from "../test/fixtures.js";
import {
  findIncident,
  listOpenIncidents,
  markIncidentHandled,
  recordIncident,
} from "./incidents.js";

/**
 * Two managers acknowledging one incident, started together. First-wins is the
 * `acknowledged_at is null` predicate in `markIncidentHandled`, not a lock: the second update
 * matches no row whichever order the two arrive in. Weaker than a race test: nothing observes the
 * second caller reaching the row, because the write queue runs the two transactions in turn.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS], timeoutMs: 60_000 });

const BASE = new Date("2026-03-01T12:05:00.000Z");

describe("markIncidentHandled — two managers at once", () => {
  it("keeps the first committed handler and time, and both calls succeed", async () => {
    const seed = await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await recordIncident(tx, {
        tillId: seed.tillId,
        error: new AppError("chain.verification_failed", {
          tillId: seed.tillId,
          issues: [{ issueCode: "predecessor-hash-mismatch", recordId: null, issueParams: {} }],
        }),
        severity: "error",
        detectedAt: BASE,
      });
    });
    const [open] = await withTransaction(suite.db, async (tx) => {
      return listOpenIncidents(tx);
    });
    const first = { personId: "00000000-0000-4000-8000-000000000001", handledAt: BASE };
    const second = {
      personId: "00000000-0000-4000-8000-000000000002",
      handledAt: new Date(BASE.getTime() + 5_000),
    };
    const mark = (by: typeof first) =>
      withTransaction(suite.db, async (tx) => {
        await markIncidentHandled(tx, { id: open!.id, ...by });
      });

    // Both started together and NOT awaited in turn. The write queue decides which transaction
    // runs first; `Promise.all` starting `first` first is what makes it the one that gets there,
    // and the queue is FIFO on `begin immediate` (`packages/store/src/write-queue.ts`).
    await Promise.all([mark(first), mark(second)]);

    const stored = await withTransaction(suite.db, async (tx) => {
      return findIncident(tx, open!.id);
    });
    expect({
      personId: stored?.acknowledgedBy,
      handledAt: stored?.acknowledgedAt?.toISOString(),
    }).toEqual({ personId: first.personId, handledAt: first.handledAt.toISOString() });
  });
});
