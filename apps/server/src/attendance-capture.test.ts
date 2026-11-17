import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  type Transaction,
  withTransaction,
  withFoldedPersonChanges,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { attendanceDays, staffActivity, WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import type { AttendanceRecorder } from "./attendance-capture.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(f: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, f);
let personId: string;
const fact = () => ({
  source: "whole-payment" as const,
  key: "attempt:one",
  personId,
  kind: "payment" as const,
  at: "2026-01-05T16:40:23.987Z",
  offsetMinutes: 0,
  outcome: "qualified" as const,
});
async function capture(input: Parameters<AttendanceRecorder>[1]) {
  const { recordAttendanceFact } = await import("./attendance-capture.js");
  return run((tx) => recordAttendanceFact(tx, input));
}
beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "04:00",
    invoiceLocales: ["es"],
  });

  const people = await seedPersons(suite.db, [
    { displayName: "Collector", pinHash: "scrypt$00$00" },
    { displayName: "Later operator", pinHash: "scrypt$00$00" },
  ]);
  personId = people[0]!.id;
});

describe("transactional attendance capture", () => {
  it("records the admitted person and human instant", async () => {
    await capture(fact());
    expect(await suite.db.select().from(staffActivity)).toMatchObject([
      { personId, firstAt: "2026-01-05T16:40:23.000Z", lastAt: "2026-01-05T16:40:23.000Z" },
    ]);
  });
  it.each([{ at: "bad" }, { key: "" }, { personId: "" }, { kind: "sign-in" }])(
    "refuses invalid evidence %j without saving work",
    async (bad) => {
      await expect(
        capture({ ...fact(), ...bad } as Parameters<typeof capture>[0]),
      ).rejects.toMatchObject({ code: "attendance.invalid" });
      expect(await suite.db.select().from(staffActivity)).toEqual([]);
      expect(await suite.db.select().from(attendanceDays)).toEqual([]);
    },
  );
  it("a capture failure rolls back the surrounding accepted command", async () => {
    const { recordAttendanceFact } = await import("./attendance-capture.js");
    await expect(
      run(async (tx) => {
        await tx
          .update(persons)
          .set(withFoldedPersonChanges({ displayName: "Changed" }))
          .where(eq(persons.id, personId));
        await recordAttendanceFact(tx, { ...fact(), key: "" });
      }),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(
      (await suite.db.select().from(persons).where(eq(persons.id, personId)))[0]!.displayName,
    ).toBe("Collector");
    expect(await suite.db.select().from(staffActivity)).toEqual([]);
  });
});
