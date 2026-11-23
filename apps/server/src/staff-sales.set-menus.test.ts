import { expect, it } from "vitest";
import { computeAdjustmentReport } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { currentBusinessDay, resolveVenueClock } from "@waitron/reporting";
import { setSetMenuCount } from "./set-menu-count.js";
import { ensureOperator } from "./testing/cancel-line.js";
import { inTx } from "./testing/party-venue.js";
import {
  setupSetMenuSpecVenue,
  specBill,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
  },
});

const MIA = "cccccccc-0000-4000-8000-0000000000a1";

it("staff sales credit counts set menus to whoever added them", async () => {
  const { venue } = spec;
  const bill = await specBill(spec);
  await inTx(venue, (tx) => ensureOperator(tx, MIA));
  // A third Daily menu, added by Mia.
  await inTx(venue, (tx) => setSetMenuCount(tx, venue.cfg, bill.tabId, spec.daily.menuId, 3, MIA));

  const report = await inTx(venue, async (tx) => {
    const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
    const day = currentBusinessDay(clock);
    return computeAdjustmentReport(tx, { ...clock, fromBusinessDay: day, toBusinessDay: day });
  });

  const sales = (personId: string) => report.people.find((row) => row.personId === personId)?.sales;
  expect(sales(venue.operator.personId)).toBe("73.00");
  expect(sales(MIA)).toBe("14.00");
  expect(report.overall.sales).toBe("87.00");
});
