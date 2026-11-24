import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { deviceProfiles } from "../schema/device-profiles.js";
import { withTransaction } from "../tenancy.js";
import { setPrinterListsForTest } from "./printers.js";
import { seedDeviceProfiles } from "./seed.js";
import { useVenueDb } from "./venue-db.js";

describe("setPrinterListsForTest", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("replaces only the named roles of one profile's printer lists, keeping its other roles and other profiles", async () => {
    const kept = { ids: ["drawer-1"], defaultId: "drawer-1" };
    // The other profile is seeded first, so a read that ignores the profile id finds it first.
    const [other, profile] = await seedDeviceProfiles(suite.db, [
      { name: "Terrace", formFactor: "till", printerLists: { receipt: kept } },
      {
        name: "Bar",
        formFactor: "till",
        printerLists: { receipt: { ids: ["old"], defaultId: "old" }, cash_drawer: kept },
      },
    ]);
    // A default off its own list is a state the profile writer refuses; the fixture stores it.
    const receipt = { ids: ["new-1", "new-2"], defaultId: "elsewhere" };
    const invoice = { ids: [], defaultId: null };
    await withTransaction(suite.db, (tx) =>
      setPrinterListsForTest(tx, profile!.id, { receipt, invoice }),
    );
    const lists = await suite.db
      .select({ id: deviceProfiles.id, printerLists: deviceProfiles.printerLists })
      .from(deviceProfiles);
    expect(new Map(lists.map(({ id, printerLists }) => [id, printerLists]))).toEqual(
      new Map([
        [profile!.id, { receipt, cash_drawer: kept, invoice }],
        [other!.id, { receipt: kept }],
      ]),
    );
  });
});
