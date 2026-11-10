import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { WORKFORCE_MIGRATIONS, validateRoster, type PlannedShift } from "@waitron/workforce";
import { convenioConfig } from "./schema/convenio-config.js";
import { resolveWorkTimeRuleset } from "./convenio.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
});

beforeEach(async () => {
  await seedVenue(suite.db);
});

it("characterizes stored agreement values reaching break and weekly-rest warnings", async () => {
  await suite.db.insert(convenioConfig).values({});
  const baseline = await resolveWorkTimeRuleset(suite.db);
  await suite.db.update(convenioConfig).set({
    weeklyRestMinutes: 2880,
    breakThresholdMinutes: 300,
    minBreakMinutes: 20,
    breaksCountAsWorked: false,
  });
  const configured = await resolveWorkTimeRuleset(suite.db);
  const shifts: PlannedShift[] = [];
  for (let week = 0; week < 3; week++)
    for (let day = 0; day < 6; day++) {
      const date = new Date(Date.UTC(2026, 0, 5 + week * 7 + day)).toISOString().slice(0, 10);
      shifts.push({
        shiftId: `${week}-${day}`,
        personId: "worker",
        startsAt: `${date}T08:00:00Z`,
        startsOffsetMinutes: 0,
        endsAt: `${date}T13:01:00Z`,
        endsOffsetMinutes: 0,
      });
    }
  const before = validateRoster(shifts, baseline);
  const after = validateRoster(shifts, configured);
  expect(
    before.filter((x) => x.kind === "break_owed" || x.kind === "weekly_rest_insufficient"),
  ).toEqual([]);
  expect(after.filter((x) => x.kind === "weekly_rest_insufficient")).toEqual([
    {
      kind: "weekly_rest_insufficient",
      personId: "worker",
      weekStart: "2026-01-12",
      longestRestMinutes: 2579,
      requiredMinutes: 2880,
    },
  ]);
  expect(after.filter((x) => x.kind === "break_owed")).toHaveLength(18);
  expect(after.find((x) => x.kind === "break_owed")).toMatchObject({
    thresholdMinutes: 300,
    minBreakMinutes: 20,
  });
  const exactThreshold = { ...shifts[0]!, endsAt: "2026-01-05T13:00:00Z" };
  expect(
    validateRoster([exactThreshold], configured).filter((x) => x.kind === "break_owed"),
  ).toEqual([]);
  for (const [end, count] of [
    ["08:00", 0],
    ["08:01", 1],
  ] as const) {
    const boundary = shifts.map((shift) =>
      shift.shiftId.endsWith("-5")
        ? {
            ...shift,
            startsAt: shift.startsAt.replace("T08:00:", "T07:59:"),
            endsAt: shift.endsAt.replace("T13:01:", `T${end}:`),
          }
        : shift,
    );
    expect(
      validateRoster(boundary, configured).filter((x) => x.kind === "weekly_rest_insufficient"),
    ).toHaveLength(count);
  }
});
