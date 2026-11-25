import { expect, it } from "vitest";
import { CORE_MIGRATIONS, enqueueMail, readMail, withTransaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions } from "@waitron/identity";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { jobOrigin } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WORKFORCE_PERMISSIONS,
  WorkforceBackend,
  setPayPeriodCloseGraceDays,
} from "@waitron/workforce";
import { runAttendancePass } from "./attendance-loop.js";
import { monthlyHoursReminderMail } from "./monthly-hours-reminder.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });
const now = new Date("2026-02-04T12:00:00Z");
const scheduledCloseAt = "2026-02-05T04:00:00.000Z";

it.each(["send", "resolved", "moved"])(
  "checks the monthly reminder at claim (%s)",
  async (mode) => {
    registerModulePermissions(WORKFORCE_PERMISSIONS);
    await seedVenue(suite.db, { name: "Madrid", timeZone: "Europe/Madrid", dayCutover: "05:00" });
    const nodeId = await seedNode(suite.db);
    const [worker, manager, revoked] = await seedPersons(suite.db, [
      { displayName: "Worker" },
      { displayName: "Manager", role: "manager", email: "manager@example.test", locale: "en-GB" },
      { displayName: "Other", role: "manager", email: "other@example.test" },
    ]);
    const backend = new WorkforceBackend();
    const event = {
      personId: worker!.id,
      nodeId,
      offsetMinutes: 60,
      origin: jobOrigin("dashboard"),
    };
    await withTransaction(suite.db, (tx) =>
      backend.clockIn(tx, { ...event, at: "2026-01-05T10:00:00Z" }),
    );
    await runAttendancePass({ db: suite.db, nodeId, now: () => now, isPrimary: () => true });
    await withTransaction(suite.db, async (tx) => {
      for (const person of [manager!, revoked!]) {
        await enqueueMail(tx, {
          kind: "monthly_hours_reminder",
          dedupeKey: `reminder:${person.id}`,
          personId: person.id,
          params: { periodStart: "2026-01-01", scheduledCloseAt },
          now,
          notAfter: new Date(scheduledCloseAt),
        });
      }
      await setBuiltInRoleForTest(tx, revoked!.id, "staff");
      if (mode === "moved") await setPayPeriodCloseGraceDays(tx, 4);
      if (mode === "resolved") await backend.clockOut(tx, { ...event, at: "2026-01-05T18:00:00Z" });
    });
    if (mode === "resolved")
      await runAttendancePass({ db: suite.db, nodeId, now: () => now, isPrimary: () => true });

    const owner = monthlyHoursReminderMail({
      venueLanguage: "es",
      managementOrigin: "https://box.test",
    });
    expect(owner.deliveryRule).toBe("venue_smtp");
    const mail = (await readMail(suite.db, `reminder:${manager!.id}`))!;
    const claim = await owner.claim(suite.db, mail, now);
    if (mode === "send") {
      const other = (await readMail(suite.db, `reminder:${revoked!.id}`))!;
      expect(await owner.claim(suite.db, other, now)).toBeNull();
      expect(claim).toMatchObject({ recipient: "manager@example.test" });
      if (!claim || !("prepared" in claim)) throw new Error("Reminder was not claimed");
      expect(await owner.compose(claim.prepared, mail)).toEqual({
        subject: "Review hours for January 2026",
        text: expect.stringMatching(
          /1 issue needs[\s\S]*5 February 2026[\s\S]*https:\/\/box\.test\/hours/,
        ),
      });
    } else {
      expect(claim).toBeNull();
    }
  },
);
