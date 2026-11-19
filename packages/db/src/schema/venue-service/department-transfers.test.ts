import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { restrictRefused } from "../../constraint-target.js";
import { CORE_MIGRATIONS } from "../../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../../sql-state.js";
import { withTransaction } from "../../tenancy.js";
import { captureError } from "../../testing/errors.js";
import { seedPerson, seedVenue, seedWorkingOrder } from "../../testing/seed.js";
import { useVenueDb } from "../../testing/venue-db.js";
import { isRefusal } from "../../unique-violation.js";
import { persons } from "../identity/persons.js";
import { departmentTransferRequests } from "./department-transfers.js";
import { departments } from "./service.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it.each(["senderId", "resolvedBy"] as const)(
  "requires a person for department transfer %s and restricts deleting them",
  async (column) => {
    const { db } = suite;
    await seedVenue(db, { name: "Dining room", invoiceLocales: ["en"] });
    await db.insert(departments).values([
      { id: "source", name: "Source", tradingName: "Source" },
      { id: "destination", name: "Destination", tradingName: "Destination" },
    ]);
    const bill = await seedWorkingOrder(db, { source: "dashboard" });
    const senderId = await seedPerson(db, { displayName: "Sender" });
    const resolution =
      column === "resolvedBy"
        ? ({ status: "accepted", resolvedAt: "2026-11-18T12:00:00.000Z" } as const)
        : ({ status: "pending", resolvedBy: null } as const);
    const insert = (personId: string) =>
      withTransaction(db, (tx) =>
        tx.insert(departmentTransferRequests).values({
          tabId: bill.id,
          sourceDepartmentId: "source",
          destinationDepartmentId: "destination",
          senderId,
          ...resolution,
          [column]: personId,
        }),
      );

    const error = await captureError(() => insert("missing-person"));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);

    const personId = await seedPerson(db);
    await insert(personId);
    const deletion = await captureError(() =>
      withTransaction(db, (tx) => tx.delete(persons).where(eq(persons.id, personId))),
    );
    expect(restrictRefused(deletion)).toBe(true);
  },
);
