import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { kitchenStations } from "./kitchen-stations.js";
import { orderGroupHoldStations } from "./order-group-hold-stations.js";
import { orderGroups } from "./order-groups.js";
import { parties } from "./parties.js";
import { venueLocationId } from "../venue.js";

let LOCATION: string;
const STATION = "aaaaaaaa-0000-4000-8000-000000000004";
const PARTY = "aaaaaaaa-0000-4000-8000-000000000006";
const GROUP = "aaaaaaaa-0000-4000-8000-000000000007";
const OPERATOR = "aaaaaaaa-0000-4000-8000-000000000008";
const GHOST = "aaaaaaaa-0000-4000-8000-000000000099";

describe("order group hold stations schema", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seedVenue(suite.db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    LOCATION = await venueLocationId(suite.db);
    await suite.db
      .insert(kitchenStations)
      .values({ id: STATION, locationId: LOCATION, name: "Kitchen A" });
    await suite.db.insert(parties).values({ id: PARTY, openedBy: OPERATOR });
    await suite.db
      .insert(orderGroups)
      .values({ id: GROUP, partyId: PARTY, position: 1, state: "held", submittedBy: OPERATOR });
  });

  it("stores a held group's HOLD station once", async () => {
    await suite.db.insert(orderGroupHoldStations).values({ groupId: GROUP, stationId: STATION });
    expect(
      await suite.db
        .select()
        .from(orderGroupHoldStations)
        .where(eq(orderGroupHoldStations.groupId, GROUP)),
    ).toEqual([{ groupId: GROUP, stationId: STATION }]);
    const duplicate = await captureError(() =>
      suite.db.insert(orderGroupHoldStations).values({ groupId: GROUP, stationId: STATION }),
    );
    expect(isRefusal(duplicate, UNIQUE_VIOLATION)).toBe(true);
  });

  it("refuses a group or station that does not exist", async () => {
    for (const [groupId, stationId] of [
      [GHOST, STATION],
      [GROUP, GHOST],
    ]) {
      const error = await captureError(() =>
        suite.db
          .insert(orderGroupHoldStations)
          .values({ groupId: groupId!, stationId: stationId! }),
      );
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    }
  });
});
