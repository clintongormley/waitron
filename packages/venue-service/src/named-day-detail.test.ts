import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readSpecialDate, saveSpecialDate } from "./hours.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});

it("reads named-day facts and enforces venue ownership without station-hours tables", async () => {
  const { cfg, other, day } = await withTransaction(suite.db, async (tx) => {
    const venues = await tx
      .insert(locations)
      .values(
        ["Here", "Elsewhere"].map((name) => ({
          name: `${name} ${randomUUID()}`,
          invoiceLocales: ["en-GB"],
          operationDescription: "Hospitality",
          timeZone: "Europe/Madrid",
        })),
      )
      .returning();
    const cfg = { locationId: locationId(venues[0]!.id) };
    const day = await saveSpecialDate(
      tx,
      cfg,
      null,
      {
        date: "2026-12-25",
        name: "Christmas",
        kind: "holiday",
        repeats: true,
        ownHours: false,
        closeWholeVenue: true,
        cells: [],
      },
      new Date("2026-10-09T12:00:00Z"),
    );
    return { cfg, other: { locationId: locationId(venues[1]!.id) }, day };
  });
  const read = await withTransaction(suite.db, (tx) => readSpecialDate(tx, cfg, day.id));
  expect(read).toEqual({
    id: day.id,
    date: "2026-12-25",
    name: "Christmas",
    kind: "holiday",
    repeats: true,
    ownHours: false,
    closeWholeVenue: true,
  });
  await expect(
    withTransaction(suite.db, (tx) => readSpecialDate(tx, other, day.id)),
  ).rejects.toMatchObject({ code: "special_date.not_found", params: { specialDateId: day.id } });
  const unknown = randomUUID();
  await expect(
    withTransaction(suite.db, (tx) => readSpecialDate(tx, cfg, unknown)),
  ).rejects.toMatchObject({ code: "special_date.not_found", params: { specialDateId: unknown } });
});
