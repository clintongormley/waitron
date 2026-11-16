import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../migrations.js";
import { restrictRefused } from "../../constraint-target.js";
import { captureError, engineErrorMessage } from "../../testing/errors.js";
import { seedDevice, seedPerson, seedVenue } from "../../testing/seed.js";
import { useVenueDb } from "../../testing/venue-db.js";
import { tillSessions } from "./till-sessions.js";
import { dashboardSessions } from "./dashboard-sessions.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function insertSession(kind: "till" | "dashboard", personId: string) {
  const row = { personId, tokenHash: "a".repeat(64) };
  if (kind === "dashboard")
    return suite.db
      .insert(dashboardSessions)
      .values(row)
      .returning({ personId: dashboardSessions.personId });
  await seedVenue(suite.db, { name: "Session key test", invoiceLocales: ["en"] });
  const { deviceId } = await seedDevice(suite.db);
  return suite.db
    .insert(tillSessions)
    .values({ ...row, deviceId })
    .returning({ personId: tillSessions.personId });
}

it.each(["till", "dashboard"] as const)(
  "refuses a %s session for a missing person",
  async (kind) => {
    const error = await captureError(() => insertSession(kind, randomUUID()));
    expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");
  },
);

it.each(["till", "dashboard"] as const)(
  "refuses deleting the person behind a %s session",
  async (kind) => {
    const personId = await seedPerson(suite.db);
    await insertSession(kind, personId);
    const error = await captureError(() =>
      suite.db.execute(sql`delete from persons where id = ${personId}`),
    );
    expect(restrictRefused(error)).toBe(true);
    expect(
      (await suite.db.execute(sql`select id from persons where id = ${personId}`)).rows,
    ).toEqual([{ id: personId }]);
  },
);

it.each(["till", "dashboard"] as const)(
  "still opens a %s session for a real person",
  async (kind) => {
    const personId = await seedPerson(suite.db);
    expect(await insertSession(kind, personId)).toEqual([{ personId }]);
  },
);

it("plans the day read on opened_at", async () => {
  const result = await suite.db.execute<{ detail: string }>(sql`
    explain query plan select id from till_sessions
    where opened_at >= '2026-11-01' and opened_at < '2026-11-02'
  `);
  expect(result.rows.map((row) => row.detail).join("\n")).toContain(
    "USING INDEX till_sessions_opened_at_idx",
  );
});
