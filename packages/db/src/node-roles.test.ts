import { describe, expect, it } from "vitest";
import {
  readDeploymentEnvironment,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
} from "./deployment.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "./testing/venue-db.js";

// Two nodes sharing one venue database: what a rebuilt or promoted node holds once it has another
// node's copy. Each must read its own row or none, never the other's.
const NODE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NODE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("per-node rows in one venue database", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("keeps the environment one per database, whichever node's role is written", async () => {
    await stampDeployment(suite.db, "production");
    await setDeploymentMode(suite.db, NODE_A, "mirror");
    await setSingletonRole(suite.db, NODE_B, "secondary");
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
  });
});
