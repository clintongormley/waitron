/**
 * Two clock-ins for one person, started together, leave ONE open shift: a double `in` makes
 * `projectWorkSessions` undercount paid time. The venue file's write queue serialises them; the
 * mechanism is recorded on `racePair` (`packages/catalogue/test/fixtures.ts`).
 *
 * Weaker than its name: it asserts the outcome only. It cannot stage the interleaving that produced
 * the double `in`, and nothing confirms the two callers are separate beyond being two
 * `withTransaction` calls started without awaiting each other.
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
 * Not `driverErrorCode`: on this engine it answers `ERR_SQLITE_ERROR` for every driver failure.
 */
function classify(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return `unexpected: ${String(error)}`;
}

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
    // Another person's entry first, so the chain head exists while `personId` is still "out".
    await insertTimeEntry(suite.db, {
      nodeId,
      personId: otherPersonId,
      locationId,
      eventAt: "2026-01-05T05:00:00Z",
    });

    const results = await Promise.all([
      attemptClockIn("2026-01-05T09:00:00Z"),
      attemptClockIn("2026-01-05T09:00:05Z"),
    ]);

    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results).toContain("attendance.already_open");
    expect(await countInEntries()).toBe(1);
  });
});
