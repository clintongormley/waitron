/**
 * Two clock-ins for one person, started together, leave ONE open shift.
 *
 * ## What this suite was, and what converting it cost
 *
 * It ran against real PostgreSQL through `useTemplateDb`, on distinct backends authenticated as a
 * non-superuser `workforce_clock_probe` login, and it caught a TOCTOU: each of
 * `clockIn`/`clockOut`/`breakStart`/`breakEnd` read the worker's shift state with an unlocked
 * select and then appended, so two concurrent same-person clock-ins could both observe `out` and
 * both append an `in` — after which `projectWorkSessions` counts worked time from the SECOND `in`
 * and UNDERCOUNTS paid time in a legal working-time record. The fix was a per-person
 * `for no key update` on `persons` (`clocking.ts`'s `lockPerson`), and that clause is now deleted
 * with the rest of the row locks: SQLite has none, and drizzle's SQLite builder has no `.for()`.
 *
 * What refuses the second clock-in now is the venue file's write queue: `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, so the second caller's
 * `begin` does not run until the first has committed and its `in` is on file. The mechanism, its
 * measurement and its control in the other direction are recorded once on `racePair`
 * (`packages/catalogue/test/fixtures.ts`).
 *
 * **Three things stopped being checked, and none of them is a rewording:**
 *
 * 1. `runs its two writers on distinct backend processes` — `pg_backend_pid()` has no counterpart
 *    and there are no backends. Nothing confirms the two callers below are genuinely separate; what
 *    they are is two `withTransaction` calls started without awaiting each other.
 * 2. The barrier that made the RED reproducible is gone with it. On PostgreSQL a third connection
 *    held the location chain head so BOTH racers reached their state read before either could
 *    commit, which is what made the buggy code fail every time. There is no third connection and no
 *    lock to hold, so the case below can no longer stage the interleaving that produced the double
 *    `in`; it asserts the OUTCOME, on an engine where that interleaving cannot occur.
 * 3. `clockIn does not deadlock against a concurrent same-person correction` is DELETED outright.
 *    It existed to pin a lock MODE — `for no key update` rather than `for update`, to stay out of an
 *    ABBA cycle with the `for key share` locks a `time_entries` insert took on its referenced
 *    `persons` rows. The engine takes neither lock and there is one writer, so there is no question
 *    left to ask. It is retired by the engine, not moved.
 *
 * The suite also no longer runs as a non-superuser login, because there is no role to run as.
 * Nothing here now shows that the clock path is PERMITTED what it does — only that it does it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { insertTimeEntry, seedLocation, seedPerson } from "../test/fixtures.js";
import { readChain } from "./chain.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

const backend = new WorkforceBackend();

let personId: string;
let otherPersonId: string;
let locationId: string;
let nodeId: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  personId = await seedPerson(suite.db, "Ana");
  otherPersonId = await seedPerson(suite.db, "Ben");
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
});

function event(at: string): ClockEventInput {
  return { nodeId, personId, locationId, at, offsetMinutes: 0 };
}

/**
 * Classifies a racer's outcome for a `.toEqual` assertion: a domain rejection reports its AppError
 * code (e.g. `attendance.already_open`), anything else is stringified so an unexpected failure
 * names itself rather than hiding behind a generic label.
 *
 * `pgErrorCode` is deliberately NOT used. On this engine it answers the same string
 * (`ERR_SQLITE_ERROR`) for every driver failure alike, so classifying by it would report every
 * distinct refusal identically — the trap `packages/db/src/constraint-target.ts` documents.
 */
function classify(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return `unexpected: ${String(error)}`;
}

/** Runs `clockIn` for `personId`, returning "ok" on success or the classified error otherwise. */
async function attemptClockIn(at: string): Promise<string> {
  try {
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, event(at)));
    return "ok";
  } catch (error) {
    return classify(error);
  }
}

async function countInEntries(): Promise<number> {
  const chain = await readChain(suite.db, { nodeId, locationId });
  return chain.filter((e) => e.personId === personId && e.entryKind === "in").length;
}

describe("clockIn admits one of two concurrent same-person clock-ins", () => {
  it("admits exactly one and refuses the other with attendance.already_open", async () => {
    // A different person's entry first, so the location chain head exists before the two racers
    // start while `personId`'s own live state is still "out" (currentState filters by person_id).
    // On PostgreSQL this row was what the barrier connection locked; here it only establishes the
    // same starting state.
    await insertTimeEntry(suite.db, {
      nodeId,
      personId: otherPersonId,
      locationId,
      eventAt: "2026-01-05T05:00:00Z",
    });

    // Started without awaiting each other: nothing but the write queue keeps the second out until
    // the first has committed.
    const results = await Promise.all([
      attemptClockIn("2026-01-05T09:00:00Z"),
      attemptClockIn("2026-01-05T09:00:05Z"),
    ]);

    // Exactly one commits its `in`, the other is refused, and the legal record holds ONE open shift
    // — not the double-`in` the projection undercounts.
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results).toContain("attendance.already_open");
    expect(await countInEntries()).toBe(1);
  });
});
