import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { jsonFile } from "@waitron/module";
import { expect, it } from "vitest";
import { cancelBooking } from "./bookings.js";
import { BOOKINGS_MIGRATIONS } from "./migrations.js";
import { BOOKINGS_PERSONAL_DATA } from "./personal-data.js";
import { bookings } from "./schema/bookings.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, BOOKINGS_MIGRATIONS] });
const firstAt = "2026-10-07T09:00:00.000Z";
const laterAt = "2026-10-07T09:15:00.000Z";

async function download(personId: string) {
  const db = suite.db;
  const build = await db.withWriteLock(() =>
    BOOKINGS_PERSONAL_DATA.prepare(db, {
      personId,
      language: "en",
      at: new Date(laterAt),
      timeZone: "UTC",
    }),
  );
  return build();
}

it("lists only the subject’s booking IDs and creation times, including cancelled bookings", async () => {
  const db = suite.db;
  const first = await seedPerson(db, { displayName: "First creator" });
  const second = await seedPerson(db, { displayName: "Second creator" });
  const colleague = await seedPerson(db, { displayName: "Colleague" });
  const reservation = { bookingDate: "2026-10-08", bookingTime: "19:15", partySize: 2 };
  await withTransaction(db, async (tx) => {
    await tx.insert(bookings).values([
      {
        ...reservation,
        id: "a-late",
        contactName: "Guest Two",
        notes: "Corner seat",
        createdBy: first,
        createdAt: laterAt,
      },
      {
        ...reservation,
        id: "z-cancelled",
        contactName: "Guest One",
        contactPhone: "12345",
        notes: "Window seat",
        createdBy: first,
        createdAt: firstAt,
      },
      {
        ...reservation,
        id: "other",
        contactName: "Guest Three",
        notes: "Birthday",
        createdBy: second,
        createdAt: firstAt,
      },
    ]);
    await cancelBooking(tx, "z-cancelled");
  });

  const file = "bookings-created.json";
  expect(await download(first)).toEqual([
    jsonFile(file, {
      entries: [
        { bookingId: "z-cancelled", at: firstAt },
        { bookingId: "a-late", at: laterAt },
      ],
    }),
  ]);
  expect(await download(second)).toEqual([
    jsonFile(file, { entries: [{ bookingId: "other", at: firstAt }] }),
  ]);
  expect(await download(colleague)).toEqual([]);
});
