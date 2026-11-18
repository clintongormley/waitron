import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { persons } from "./identity/persons.js";
import { printJobs } from "./print-jobs.js";
import { printers } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const confirmedAt = "2026-11-18T12:00:00.000Z";
let printerId: string;
let personId: string;
let jobId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  const [printer] = await suite.db
    .insert(printers)
    .values({ name: "Receipt", transport: "network_tcp", host: "192.0.2.10" })
    .returning({ id: printers.id });
  printerId = printer!.id;
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Dana", displayNameFolded: "dana" })
    .returning({ id: persons.id });
  personId = person!.id;
  const [job] = await suite.db
    .insert(printJobs)
    .values({ printerId, payload: new Uint8Array([1]) })
    .returning({ id: printJobs.id });
  jobId = job!.id;
});

const write = (person: string | null, time: string | null) =>
  suite.db.execute(sql`
    update print_jobs set handed_over_by = ${person}, handed_over_at = ${time} where id = ${jobId}
  `);

it("accepts an absent handover and a complete handover", async () => {
  const read = () =>
    suite.db.all(sql`select handed_over_by, handed_over_at from print_jobs where id = ${jobId}`);
  expect(read()).toEqual([{ handed_over_by: null, handed_over_at: null }]);
  await write(personId, confirmedAt);
  expect(read()).toEqual([{ handed_over_by: personId, handed_over_at: confirmedAt }]);
});

it("refuses either half of a handover on its own", async () => {
  for (const [person, time] of [
    [personId, null],
    [null, confirmedAt],
  ] as const) {
    const error = await captureError(() => write(person, time));
    expect(engineErrorMessage(error)).toBe("CHECK constraint failed: print_jobs_handover_pair_ck");
  }
});

it("refuses a handover that names a missing person", async () => {
  const error = await captureError(() =>
    write("00112233-4455-4677-8899-aabbccddeeff", confirmedAt),
  );
  expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");
});

it("refuses deleting the person named by a handover", async () => {
  const remove = () => suite.db.delete(persons).where(eq(persons.id, personId));
  await write(personId, confirmedAt);
  expect(engineErrorMessage(await captureError(remove))).toBe("FOREIGN KEY constraint failed");
  await write(null, null);
  await remove();
  expect(await suite.db.select().from(persons).where(eq(persons.id, personId))).toEqual([]);
});
