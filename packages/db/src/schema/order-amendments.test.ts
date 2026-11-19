import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { appendOrderAmendment } from "../append-order-amendment.js";
import { restrictRefused } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { seedNode, seedPerson, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { persons } from "./identity/persons.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("requires a person as amendment actor and restricts deleting them", async () => {
  await seedVenue(suite.db, { name: "Dining room", invoiceLocales: ["en"] });
  const nodeId = await seedNode(suite.db);
  const bill = await seedWorkingOrder(suite.db, { source: "dashboard", nodeId });
  const append = (actorId: string) =>
    withTransaction(suite.db, (tx) =>
      appendOrderAmendment(tx, {
        workingOrderId: bill.id,
        kind: "order_placed",
        actorId,
        reason: null,
        origin: { source: "dashboard", deviceId: null },
        capturedByNodeId: nodeId,
        eventAt: new Date("2026-11-18T12:00:00.000Z"),
        eventOffsetMinutes: 0,
      }),
    );

  const error = await captureError(() => append("missing-person"));
  expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);

  const actorId = await seedPerson(suite.db);
  await append(actorId);
  const deletion = await captureError(() =>
    withTransaction(suite.db, (tx) => tx.delete(persons).where(eq(persons.id, actorId))),
  );
  expect(restrictRefused(deletion)).toBe(true);
});
