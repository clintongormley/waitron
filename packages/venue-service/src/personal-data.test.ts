import { CORE_MIGRATIONS, departmentTransferRequests, withTransaction } from "@waitron/db";
import { seedPerson, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { preparePersonalData } from "@waitron/module";
import { expect, it } from "vitest";
import { createDepartment, VENUE_SERVICE_PERSONAL_DATA } from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const AT = "2026-11-21T19:00:00.000Z";

async function download(personId: string) {
  const parts = [{ owner: "venue-service", part: VENUE_SERVICE_PERSONAL_DATA }];
  const build = await suite.db.withWriteLock(() =>
    preparePersonalData(suite.db, parts, {
      personId,
      language: "en",
      at: new Date(AT),
      timeZone: "UTC",
    }),
  );
  return build();
}

it("exports transfers the subject resolved, including their own withdrawal", async () => {
  const { sourceDepartmentId, destinationDepartmentId } = await withTransaction(
    suite.db,
    async (tx) => {
      await seedVenue(tx);
      await seedPerson(tx, { id: "ana", displayName: "Ana" });
      await seedPerson(tx, { id: "bea", displayName: "Bea" });
      await seedPerson(tx, { id: "clara", displayName: "Clara" });
      const source = await createDepartment(tx, { name: "Private source", orderStart: "table" });
      const destination = await createDepartment(tx, {
        name: "Private destination",
        orderStart: "table",
      });
      const order = await seedWorkingOrder(tx, { orderNumber: 51, label: "Guest Canary" });
      const pair = {
        tabId: order.id,
        sourceDepartmentId: source.id,
        destinationDepartmentId: destination.id,
      };
      await tx.insert(departmentTransferRequests).values([
        {
          ...pair,
          id: "a",
          status: "accepted",
          senderId: "bea",
          resolvedBy: "ana",
          resolvedAt: AT,
        },
        {
          ...pair,
          id: "b",
          status: "withdrawn",
          senderId: "ana",
          resolvedBy: "ana",
          resolvedAt: AT,
        },
        {
          ...pair,
          id: "c",
          status: "declined",
          senderId: "ana",
          resolvedBy: "bea",
          resolvedAt: AT,
          reason: "Private reason",
        },
        { ...pair, id: "d", status: "pending", senderId: "ana" },
      ]);
      return pair;
    },
  );

  const files = await download("ana");
  expect(files.map(({ name }) => name)).toEqual(["department-transfers.json"]);
  const common = { order: 51, sourceDepartmentId, destinationDepartmentId, resolvedAt: AT };
  expect(JSON.parse(files[0]!.content as string)).toEqual([
    { ...common, status: "accepted" },
    { ...common, status: "withdrawn" },
  ]);
  expect(await download("clara")).toEqual([]);
});
