import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTransaction } from "@waitron/db";
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
 * Two managers acknowledging one incident, started together.
 *
 * ## What this file used to be, and what changed
 *
 * It opened two PostgreSQL backends, had the first hold the incident row's write lock open, polled
 * `pg_stat_activity` until the second backend was genuinely WAITING on that lock, and then
 * released. None of that exists here: a venue file has one connection, there are no row locks, and
 * `pg_stat_activity` has no counterpart — so `waitForLockWaiter` is gone with it.
 *
 * **LOST: the observation that the second caller had actually reached the contended row** rather
 * than merely not having finished yet. That was the thing which made this a race test. Nothing
 * replaces it here; the general receipt that the venue file's write queue serialises two
 * overlapping transactions lives in `packages/db/src/tenancy.write-lock.test.ts` ("runs two
 * overlapping transactions one after the other") and, for a fiscal chain, in
 * `packages/fiscal-verifactu/src/chain.concurrency.test.ts`.
 *
 * ## What still holds, and why the case was kept rather than deleted
 *
 * First-wins was never the lock's doing. `markIncidentHandled` (`./incidents.ts:219-222`) updates
 * `where id = ? and acknowledged_at is null`, so the SECOND update matches no row whatever order
 * the two arrive in — that predicate is the whole mechanism and it is engine-independent. The
 * assertion below is unchanged: the stored handler and time are the FIRST caller's, and neither
 * call throws.
 *
 * PROOF BY DELETION, run 2026-09-22: with `isNull(incidents.acknowledgedAt)` removed from that
 * `where` clause, this case fails with the second manager's person id and timestamp stored
 * (`00000000-…-002` / `2026-03-01T12:05:05.000Z` in place of `…-001` / `2026-03-01T12:05:00.000Z`).
 * Restored afterwards.
 *
 * Migration sets: CORE then IDENTITY, the pair the deleted `core_identity` template this file
 * cloned was built from (`git show origin/main:packages/core/src/testing/global-setup.ts`). Kept
 * as the pair rather than narrowed to CORE, so the fixture is the one the suite always had.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS], timeoutMs: 60_000 });

const BASE = new Date("2026-03-01T12:05:00.000Z");

describe("markIncidentHandled — two managers at once", () => {
  it("keeps the first committed handler and time, and both calls succeed", async () => {
    const seed = await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
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
      await asAppUser(tx);
      return listOpenIncidents(tx);
    });
    const first = { personId: "00000000-0000-4000-8000-000000000001", handledAt: BASE };
    const second = {
      personId: "00000000-0000-4000-8000-000000000002",
      handledAt: new Date(BASE.getTime() + 5_000),
    };
    const mark = (by: typeof first) =>
      withTransaction(suite.db, async (tx) => {
        await asAppUser(tx);
        await markIncidentHandled(tx, { id: open!.id, ...by });
      });

    // Both started together and NOT awaited in turn. The write queue decides which transaction
    // runs first; `Promise.all` starting `first` first is what makes it the one that gets there,
    // and the queue is FIFO on `begin immediate` (`packages/store/src/write-queue.ts`).
    await Promise.all([mark(first), mark(second)]);

    const stored = await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      return findIncident(tx, open!.id);
    });
    expect({
      personId: stored?.acknowledgedBy,
      handledAt: stored?.acknowledgedAt?.toISOString(),
    }).toEqual({ personId: first.personId, handledAt: first.handledAt.toISOString() });
  });
});
