import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { tableExists } from "./table-exists.js";
import { useVenueDb } from "./testing/venue-db.js";

describe("venue.db after core's migrations", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("holds no box's role or mirror link: both live in that box's node.db", async () => {
    expect(await tableExists(suite.db, "deployment")).toBe(true);
    expect(await tableExists(suite.db, "node_roles")).toBe(false);
    expect(await tableExists(suite.db, "mirror_config")).toBe(false);
  });
});
