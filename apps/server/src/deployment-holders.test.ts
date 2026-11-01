import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, stampDeployment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { NODE_MIGRATIONS, setNodeMode, setSingletonRole } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createDeploymentHolders, refreshDeploymentHolders } from "./deployment-holders.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
  timeoutMs: 60_000,
});

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("refreshDeploymentHolders", () => {
  it("re-reads both axes from the database into the holder", async () => {
    await stampDeployment(db, "preproduction");
    await setNodeMode({ venue: db, node: suite.node }, NODE, "primary");
    await setSingletonRole({ venue: db, node: suite.node }, NODE, "secondary"); // a local secondary: (primary, secondary)

    // A holder built from a STALE snapshot...
    const holders = createDeploymentHolders("mirror", "primary");
    expect(holders.mode.current).toBe("mirror");
    expect(holders.singletonRole.current).toBe("primary");

    await refreshDeploymentHolders(suite.node, NODE, holders);
    expect(holders.mode.current).toBe("primary");
    expect(holders.singletonRole.current).toBe("secondary");

    // ...and it tracks a subsequent write.
    await setSingletonRole({ venue: db, node: suite.node }, NODE, "primary");
    await refreshDeploymentHolders(suite.node, NODE, holders);
    expect(holders.singletonRole.current).toBe("primary");
  });
});
