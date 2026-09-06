import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  createPgliteDb,
  runMigrations,
  stampDeployment,
  setSingletonRole,
  setDeploymentMode,
} from "@waitron/db";
import { createDeploymentHolders, refreshDeploymentHolders } from "./deployment-holders.js";

// PGlite is sufficient here (CLAUDE.md §4): the refresh READS deployment (app_user holds SELECT —
// no role behaviour under test), and there is no concurrency. The owner-vs-app WRITE distinction
// is exercised by the real-PG booted e2e (Task 4), where it actually matters.
describe("refreshDeploymentHolders", () => {
  it("re-reads both axes from the database into the holder", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
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

    await db.close();
  });
});
