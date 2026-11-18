import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedCashSale, seedPerson, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { invoiceDeliveries } from "./invoice-deliveries.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("refuses an invoice delivery for a person who does not exist", async () => {
  const db = suite.db;
  await seedVenue(db);
  const { saleId } = await seedCashSale(db);
  const personId = await seedPerson(db);
  const insert = (generation: number, operator: string | null) =>
    db
      .insert(invoiceDeliveries)
      .values({
        saleId,
        generation,
        requestKey: `receipt-${generation}`,
        medium: "receipt",
        designation: "original",
        status: "sent",
        personId: operator,
      })
      .returning({ personId: invoiceDeliveries.personId });

  await expect(insert(1, "absent-operator")).rejects.toThrow("FOREIGN KEY constraint failed");
  expect(await insert(1, personId)).toEqual([{ personId }]);
  expect(await insert(2, null)).toEqual([{ personId: null }]);
});
