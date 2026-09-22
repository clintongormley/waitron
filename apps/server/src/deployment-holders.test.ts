import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, setDeploymentMode, setSingletonRole, stampDeployment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createDeploymentHolders, refreshDeploymentHolders } from "./deployment-holders.js";

// One SQLite venue file with the core set applied, opened the way the product opens it.
//
// This header used to justify picking PGlite over real PostgreSQL, and then defer the
// owner-vs-app WRITE distinction on `deployment` to a real-PG booted e2e. Both halves described
// choices that no longer exist: there is one engine to pick, and it has no roles, so no suite
// anywhere can exercise a write-privilege split on this table. What is under test is unchanged —
// the refresh READS both axes back into the holder.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("refreshDeploymentHolders", () => {
  it("re-reads both axes from the database into the holder", async () => {
    await stampDeployment(db, "preproduction"); // inserts the (primary, primary) singleton row
    await setDeploymentMode(db, "primary");
    await setSingletonRole(db, "secondary"); // a local secondary: (primary, secondary)

    // A holder built from a STALE snapshot...
    const holders = createDeploymentHolders("mirror", "primary");
    expect(holders.mode.current).toBe("mirror");
    expect(holders.singletonRole.current).toBe("primary");

    await refreshDeploymentHolders(db, holders);
    expect(holders.mode.current).toBe("primary");
    expect(holders.singletonRole.current).toBe("secondary");

    // ...and it tracks a subsequent write.
    await setSingletonRole(db, "primary");
    await refreshDeploymentHolders(db, holders);
    expect(holders.singletonRole.current).toBe("primary");
  });
});
