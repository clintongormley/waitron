import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { CORE_MIGRATIONS, catalogues, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant, seedNode } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId } from "@waitron/shared";
import {
  departments,
  menuPeriods,
  menuSlots,
  menuDayTimetables,
  replaceMenuWeek,
  saveMenuPeriod,
  VENUE_SERVICE_PROVISIONING,
} from "@waitron/venue-service";
import { readSetupOpeningHours } from "./setup-opening-hours.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function seed(withMenu = true) {
  const db = suite.db;
  await seedTenant(db);
  const [menu] = await db.insert(catalogues).values({ name: "First menu" }).returning();
  const [venue] = await db
    .insert(locations)
    .values({
      name: "First venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      catalogueId: withMenu ? menu!.id : null,
    })
    .returning();
  const cfg = {
    locationId: locationId(venue!.id),
    nodeId: await seedNode(db, locationId(venue!.id)),
  };
  await withTransaction(db, (tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, cfg));
  const [department] = await db
    .select()
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId));
  return { cfg, department: department! };
}

describe("setup's saved first opening hours", () => {
  it("reports the default department's actual seeded weekday hours", async () => {
    const { cfg, department } = await seed();
    expect(await readSetupOpeningHours(suite.db, cfg)).toEqual({ departmentId: department.id });
  });

  it("has no weekday summary when provisioning has no catalogue", async () => {
    const { cfg } = await seed(false);
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });

  it("has no summary without a default department", async () => {
    const { cfg, department } = await seed();
    await suite.db
      .update(departments)
      .set({ isDefault: false })
      .where(eq(departments.id, department.id));
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });

  it("has no summary for an inactive department", async () => {
    const { cfg, department } = await seed();
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, department.id));
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });

  it("has no first-Open summary for an authored period", async () => {
    const { cfg } = await seed();
    await suite.db.update(menuPeriods).set({ name: "Lunch" });
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });

  it("has no first-Open summary when another period has been added", async () => {
    const { cfg, department } = await seed();
    const [period] = await suite.db
      .select()
      .from(menuPeriods)
      .where(eq(menuPeriods.departmentId, department.id));
    await withTransaction(suite.db, (tx) =>
      saveMenuPeriod(tx, cfg, department.id, {
        name: "Evening",
        menuId: period!.menuId,
        staffMenuIds: [],
      }),
    );
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });

  it("has no weekday-only summary when Saturday also opens", async () => {
    const { cfg, department } = await seed();
    const [period] = await suite.db
      .select()
      .from(menuPeriods)
      .where(eq(menuPeriods.departmentId, department.id));
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        cfg,
        department.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 0 ? [] : [{ periodId: period!.id, startsAt: "09:00", endsAt: "17:00" }],
        })),
        new Date(),
      ),
    );
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });

  it("has no full-week summary when a weekday has no range", async () => {
    const { cfg, department } = await seed();
    const [tuesday] = await suite.db
      .select()
      .from(menuDayTimetables)
      .where(
        and(eq(menuDayTimetables.departmentId, department.id), eq(menuDayTimetables.weekday, 2)),
      );
    await suite.db.delete(menuSlots).where(eq(menuSlots.timetableId, tuesday!.id));
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });

  it("does not describe an authored shorter week as the first weekday schedule", async () => {
    const { cfg } = await seed();
    await suite.db.update(menuSlots).set({ endsAt: "16:00:00" });
    expect(await readSetupOpeningHours(suite.db, cfg)).toBeUndefined();
  });
});

describe("setup without venue-service installed", () => {
  const core = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("does not query absent period tables", async () => {
    expect(await readSetupOpeningHours(core.db, { locationId: "uninstalled" })).toBeUndefined();
  });
});
