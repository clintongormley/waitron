import { withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { preparePersonalData } from "@waitron/module";
import { absences, rosterVersions, shiftSwaps, shifts } from "@waitron/workforce";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { ALL_MODULES } from "./modules.js";
import { personalDataServerParts } from "./personal-data-export-api.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const AT = "2026-11-21T19:00:00.000Z";
const FILE = "workforce-decisions.json";

async function workforceDecisions(personId: string) {
  const parts = personalDataServerParts(ALL_MODULES, suite.db).filter(({ part }) =>
    part.files.includes(FILE),
  );
  const build = await suite.db.withWriteLock(() =>
    preparePersonalData(suite.db, parts, {
      personId,
      language: "en",
      at: new Date(AT),
      timeZone: "UTC",
    }),
  );
  return build();
}

it("exports only decisions made for other staff", async () => {
  await withTransaction(suite.db, async (tx) => {
    for (const id of ["ana", "bea", "clara", "dina"]) await seedPerson(tx, { id, displayName: id });
    const absence = {
      kind: "sick_leave",
      startsOn: "2026-11-23",
      endsOn: "2026-11-24",
      status: "approved",
      decidedAt: AT,
      note: "Private health note",
    } as const;
    await tx.insert(absences).values([
      { ...absence, id: "absence", personId: "bea", decidedByPersonId: "ana" },
      { ...absence, id: "own-absence", personId: "ana", decidedByPersonId: "ana" },
      { ...absence, id: "other-absence", personId: "bea", decidedByPersonId: "clara" },
    ]);
    const period = { periodStart: "2026-11-23", periodEnd: "2026-11-29" };
    await tx.insert(rosterVersions).values([
      {
        ...period,
        id: "first-rota",
        status: "superseded",
        publishedAt: "2026-11-20T19:00:00.000Z",
        publishedByPersonId: "ana",
      },
      {
        ...period,
        id: "second-rota",
        status: "published",
        publishedAt: AT,
        publishedByPersonId: "ana",
      },
      { ...period, id: "draft-rota", publishedByPersonId: "ana" },
      {
        ...period,
        id: "other-rota",
        status: "superseded",
        publishedAt: AT,
        publishedByPersonId: "clara",
      },
    ]);
    const shift = {
      startsAt: "2026-11-23T19:00:00.000Z",
      endsAt: "2026-11-23T23:00:00.000Z",
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
      rosterVersionId: "second-rota",
    };
    await tx.insert(shifts).values([
      { ...shift, id: "bea-shift", personId: "bea" },
      { ...shift, id: "ana-shift", personId: "ana" },
    ]);
    const swap = { status: "approved", decidedAt: AT, decidedByPersonId: "ana" } as const;
    await tx.insert(shiftSwaps).values([
      {
        ...swap,
        id: "swap",
        requestedByPersonId: "bea",
        fromShiftId: "bea-shift",
        toPersonId: "clara",
      },
      {
        ...swap,
        id: "offered-to-ana",
        requestedByPersonId: "bea",
        fromShiftId: "bea-shift",
        toPersonId: "ana",
      },
      {
        ...swap,
        id: "requested-by-ana",
        requestedByPersonId: "ana",
        fromShiftId: "ana-shift",
        toPersonId: "clara",
      },
      {
        ...swap,
        id: "other-swap",
        requestedByPersonId: "bea",
        fromShiftId: "bea-shift",
        toPersonId: "dina",
        decidedByPersonId: "clara",
      },
    ]);
    for (const [id, personId, requestedBy, authorizedBy, action] of [
      ["answer", "bea", "clara", "ana", "approve"],
      ["own-answer", "ana", "ana", "ana", "confirm"],
      ["only-requested", "bea", "ana", "clara", "propose"],
    ]) {
      await tx.run(sql`insert into attendance_answers
        (id, person_id, requested_by_person_id, authorized_by_person_id, action, input, entry_ids, created_at)
        values (${id}, ${personId}, ${requestedBy}, ${authorizedBy}, ${action},
          '{"reason":"Private attendance note"}', '["private-entry"]', ${AT})`);
    }
  });

  const files = await workforceDecisions("ana");
  expect(files.map((file) => file.name)).toEqual([FILE]);
  expect(JSON.parse(files[0]!.content as string)).toEqual({
    absences: [{ id: "absence", outcome: "approved", at: AT }],
    swaps: [{ id: "swap", outcome: "approved", at: AT }],
    rotas: [
      {
        id: "first-rota",
        periodStart: "2026-11-23",
        periodEnd: "2026-11-29",
        at: "2026-11-20T19:00:00.000Z",
      },
      { id: "second-rota", periodStart: "2026-11-23", periodEnd: "2026-11-29", at: AT },
    ],
    attendance: [{ id: "answer", action: "approve", at: AT }],
  });
  await expect(workforceDecisions("dina")).resolves.toEqual([]);
});
