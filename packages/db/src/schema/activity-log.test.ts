import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { restrictRefused, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { activityLog } from "./activity-log.js";
import { persons } from "./identity/persons.js";
import { devices } from "./devices.js";

describe("activity log storage", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let personId: string, deviceId: string;
  beforeEach(async () => {
    await seedVenue(suite.db, {
      name: "Venue",
      invoiceLocales: ["en"],
      operationDescription: "Sale on premises",
    });
    ({ deviceId } = await seedDevice(suite.db));
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "P-" + randomUUID() })
      .returning();
    personId = person!.id;
  });
  function insert(person: string | null = personId, device: string | null = deviceId) {
    return suite.db
      .insert(activityLog)
      .values({
        at: new Date("2026-11-08T10:00:00.000Z"),
        kind: "membership.node_removed",
        subjectKind: "node",
        subjectId: "node",
        personId: person,
        deviceId: device,
        data: { term: 3, contactUrl: "https://a.example" },
      })
      .returning();
  }
  it("keeps an entry naming a real person and device, and one naming neither", async () => {
    const [named] = await insert();
    const [anonymous] = await insert(null, null);
    expect(named).toMatchObject({ personId, deviceId, at: new Date("2026-11-08T10:00:00.000Z") });
    expect(named!.data).toEqual({ term: 3, contactUrl: "https://a.example" });
    expect(anonymous).toMatchObject({ personId: null, deviceId: null });
    expect(
      await suite.db
        .select()
        .from(activityLog)
        .where(eq(activityLog.kind, "membership.node_removed")),
    ).toHaveLength(2);
  });
  it.each(["person", "device"])(
    "refuses an entry naming a %s who does not exist",
    async (target) => {
      const error = await captureError(() =>
        insert(
          target === "person" ? "missing" : personId,
          target === "device" ? "missing" : deviceId,
        ),
      );
      expect(FOREIGN_KEY_VIOLATION).toContain((error as { errcode: number }).errcode);
      expect(
        await suite.db
          .select()
          .from(activityLog)
          .where(eq(activityLog.kind, "membership.node_removed")),
      ).toEqual([]);
    },
  );
  it("refuses deleting a person an entry names", async () => {
    await insert();
    const error = await captureError(() =>
      suite.db.delete(persons).where(eq(persons.id, personId)),
    );
    expect(restrictRefused(error)).toBe(true);
    expect(await suite.db.select().from(persons).where(eq(persons.id, personId))).toHaveLength(1);
  });
  it("refuses deleting a device an entry names", async () => {
    await insert();
    const error = await captureError(() =>
      suite.db.delete(devices).where(eq(devices.id, deviceId)),
    );
    expect(restrictRefused(error)).toBe(true);
    expect(await suite.db.select().from(devices).where(eq(devices.id, deviceId))).toHaveLength(1);
  });
  it("refuses any change to or removal of an entry", async () => {
    const [row] = await insert();
    const changed = await captureError(() =>
      suite.db.update(activityLog).set({ subjectId: "other" }).where(eq(activityLog.id, row!.id)),
    );
    const removed = await captureError(() =>
      suite.db.delete(activityLog).where(eq(activityLog.id, row!.id)),
    );
    expect(triggerRaised(changed, "activity_log is append-only")).toBe(true);
    expect(triggerRaised(removed, "activity_log is append-only")).toBe(true);
    expect(
      await suite.db
        .select()
        .from(activityLog)
        .where(eq(activityLog.kind, "membership.node_removed")),
    ).toEqual([row]);
  });
});
