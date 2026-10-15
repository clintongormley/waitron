import { beforeEach } from "vitest";
import { CORE_MIGRATIONS, type Transaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import * as api from "../src/index.js";
import { seedEmployment, seedLocation } from "./fixtures.js";

export function attendanceFixture() {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, api.WORKFORCE_MIGRATIONS],
  });
  const backend = new api.WorkforceBackend();
  const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
  let locationId: string,
    elsewhere: string,
    personId: string,
    other: string,
    manager: string,
    nodeId: string;
  beforeEach(async () => {
    await seedTenant(suite.db);
    locationId = await seedLocation(suite.db);
    elsewhere = await seedLocation(suite.db);
    nodeId = await seedNode(suite.db, brandLocationId(locationId));
    const rows = await suite.db
      .insert(persons)
      .values([
        { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
        { displayName: "Other", pinHash: "scrypt$00$00", role: "staff" },
        { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
      ])
      .returning({ id: persons.id });
    [personId, other, manager] = rows.map((r) => r.id) as [string, string, string];
    await seedEmployment(suite.db, { personId });
    await run((tx) => api.enqueueAttendanceDay(tx, day()));
  });
  const day = (): api.AttendanceDay => ({
    locationId,
    businessDay: "2026-01-05",
    startAt: "2026-01-05T04:00:00.000Z",
    endAt: "2026-01-06T04:00:00.000Z",
  });
  const event = (at: string) => ({
    nodeId,
    personId,
    locationId,
    at,
    offsetMinutes: 0,
    origin: jobOrigin("dashboard"),
  });
  const fact = (at = "2026-01-05T16:40:00.000Z", key = "last"): api.AttendanceFact => ({
    source: "order",
    key,
    personId,
    locationId,
    kind: "order",
    at,
    offsetMinutes: 0,
  });
  const plan = (id: string, startsAt: string, endsAt: string): api.PlannedAttendanceShift => ({
    id,
    personId,
    locationId,
    startsAt,
    endsAt,
    rosterVersionId: "published",
  });
  const input = (patch: Partial<api.AttendanceDayInput> = {}): api.AttendanceDayInput => ({
    day: day(),
    nodeId,
    facts: [fact()],
    planned: [],
    now: new Date("2026-01-06T04:00:00.000Z"),
    ...patch,
  });
  const processor = (
    api as typeof api & {
      processAttendanceDay: (
        tx: Transaction,
        input: api.AttendanceDayInput,
      ) => Promise<api.AttendanceDayResult>;
    }
  ).processAttendanceDay;
  const process = (patch: Partial<api.AttendanceDayInput> = {}) =>
    run((tx) => processor(tx, input(patch)));
  const entries = () => suite.db.select().from(api.timeEntries).orderBy(api.timeEntries.sequenceNo);
  const questions = () => run((tx) => api.listPendingAttendanceQuestions(tx, personId));
  const state = async () => ({
    entries: await entries(),
    chains: await suite.db.select().from(api.workforceChains),
    questions: await suite.db.select().from(api.attendanceQuestions),
    mail: await suite.db.select().from(api.attendanceMail),
    work: await suite.db.select().from(api.attendanceDayWork),
  });
  const open = async (at = "2026-01-05T09:00:00Z") => {
    await run((tx) => backend.clockIn(tx, event(at)));
    return (await entries()).at(-1)!.id;
  };
  return {
    suite,
    backend,
    run,
    event,
    fact,
    plan,
    input,
    process,
    processor,
    entries,
    questions,
    state,
    open,
    day,
    get personId() {
      return personId;
    },
    get other() {
      return other;
    },
    get manager() {
      return manager;
    },
    get locationId() {
      return locationId;
    },
    get elsewhere() {
      return elsewhere;
    },
    get nodeId() {
      return nodeId;
    },
  };
}
