import { expect, it } from "vitest";
import { CORE_MIGRATIONS, dayCutoverChanges, outgoingMail, withTransaction } from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions } from "@waitron/identity";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { jobOrigin } from "@waitron/shared";
import { WORKFORCE_MIGRATIONS, WORKFORCE_PERMISSIONS, WorkforceBackend } from "@waitron/workforce";
import { attendanceJob, runAttendancePass } from "./attendance-loop.js";
import { monthlyHoursReminderMail } from "./monthly-hours-reminder.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });
const now = new Date("2026-02-04T12:00:00Z");

it.each(["send", "resolved", "moved"])(
  "checks the monthly reminder at claim (%s)",
  async (mode) => {
    registerModulePermissions(WORKFORCE_PERMISSIONS);
    await seedVenue(suite.db, { name: "Madrid", timeZone: "Europe/Madrid", dayCutover: "00:00" });
    const nodeId = await seedNode(suite.db);
    const [worker, manager, revoked] = await seedPersons(suite.db, [
      { displayName: "Worker" },
      {
        displayName: "Manager",
        role: "supervisor",
        email: "manager@example.test",
        locale: "en-GB",
      },
      { displayName: "Other", role: "manager", email: "other@example.test" },
    ]);
    const backend = new WorkforceBackend();
    const origin = jobOrigin("dashboard");
    const event = { personId: worker!.id, nodeId, offsetMinutes: 60, origin };
    await withTransaction(suite.db, (tx) =>
      backend.clockIn(tx, { ...event, at: "2026-01-05T10:00:00Z" }),
    );
    const deps = { db: suite.db, nodeId, now: () => now, isPrimary: () => true };
    const job = attendanceJob({ ...deps, maxSleepMs: 3_600_000, clockUnconfirmed: () => false });
    await job.pass({ now, signal: new AbortController().signal });
    const emails = (await suite.db.select().from(outgoingMail)).filter(
      (row) => row.kind === "monthly_hours_reminder",
    );
    await withTransaction(suite.db, async (tx) => {
      await setBuiltInRoleForTest(tx, revoked!.id, "staff");
      if (mode === "moved")
        await tx
          .insert(dayCutoverChanges)
          .values({ effectiveBusinessDay: "2026-02-05", dayCutover: "01:00:00" });
      if (mode === "resolved") await backend.clockOut(tx, { ...event, at: "2026-01-05T18:00:00Z" });
    });
    if (mode === "resolved") await runAttendancePass(deps);

    const owner = monthlyHoursReminderMail({
      venueLanguage: "es",
      managementOrigin: "https://box.test",
    });
    expect(owner.deliveryRule).toBe("venue_smtp");
    const mail = emails.find((row) => row.personId === manager!.id)!;
    const claim = await owner.claim(suite.db, mail, now);
    if (mode === "send") {
      const other = emails.find((row) => row.personId === revoked!.id)!;
      expect(await owner.claim(suite.db, other, now)).toBeNull();
      expect(claim).toMatchObject({ recipient: "manager@example.test" });
      if (!claim || !("prepared" in claim)) throw new Error("Reminder was not claimed");
      expect(await owner.compose(claim.prepared, mail)).toEqual({
        subject: "Review hours for January 2026",
        text: expect.stringMatching(
          /1 issue is open[\s\S]*5 February 2026 at 00:00[\s\S]*https:\/\/box\.test\/hours/,
        ),
      });
      const spanish = await owner.compose({ ...claim.prepared, language: "es" }, mail);
      expect(spanish.subject).not.toBe("Review hours for January 2026");
      expect(spanish.text).toMatch(/Hay 1 asunto pendiente.*5 de febrero de 2026 a las 0?0:00/);
    } else {
      expect(claim).toBeNull();
    }
  },
);
