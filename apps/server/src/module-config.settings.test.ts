import { CORE_MIGRATIONS, readSettings } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { parseModuleConfig } from "@waitron/module";
import { expect, it } from "vitest";
import { readModuleConfig, writeModuleConfig } from "./module-config.js";
import { ALL_MODULES, MODULES_SETTINGS } from "./modules.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("writes and reads module overrides in the venue settings row", async () => {
  await writeModuleConfig(
    suite.db,
    parseModuleConfig({ modules: { bookings: false } }, ALL_MODULES),
    null,
  );
  expect((await readSettings(suite.db, MODULES_SETTINGS)).doc).toEqual({
    modules: { bookings: false },
  });
  expect([...(await readModuleConfig(suite.db)).overrides]).toEqual([["bookings", false]]);
});
