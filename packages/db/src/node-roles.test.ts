import { describe, expect, it } from "vitest";
import {
  readBreakGlassVerifier,
  readDeploymentAxes,
  readDeploymentEnvironment,
  setBreakGlassVerifierTx,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
} from "./deployment.js";
import { readMirrorConfig, writeMirrorConfig } from "./mirror-config.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

// Two nodes sharing one venue database: what a rebuilt or promoted node holds once it has another
// node's copy. Each must read its own row or none, never the other's.
const NODE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NODE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const LINK = {
  relayUrl: "https://relay.test:9000/",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n",
  originNodeId: "11111111-1111-4111-8111-111111111111",
};

describe("per-node rows in one venue database", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("gives each node its own role, and a node with no row reads as a sole primary", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setDeploymentMode(suite.db, NODE_A, "mirror");
    expect(await readDeploymentAxes(suite.db, NODE_A)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    expect(await readDeploymentAxes(suite.db, NODE_B)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("keeps a singleton role written for one node out of the other's", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(suite.db, NODE_B, "secondary");
    expect((await readDeploymentAxes(suite.db, NODE_A)).singletonRole).toBe("primary");
    expect((await readDeploymentAxes(suite.db, NODE_B)).singletonRole).toBe("secondary");
  });

  it("keeps the environment one per database, whichever node's role is written", async () => {
    await stampDeployment(suite.db, "production");
    await setDeploymentMode(suite.db, NODE_A, "mirror");
    await setSingletonRole(suite.db, NODE_B, "secondary");
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
  });

  it("reads a break-glass verifier only for the node it was written for", async () => {
    await stampDeployment(suite.db, "preproduction");
    await withTransaction(suite.db, (tx) => setBreakGlassVerifierTx(tx, NODE_A, "scrypt$aa$bb"));
    expect(await readBreakGlassVerifier(suite.db, NODE_A)).toBe("scrypt$aa$bb");
    expect(await readBreakGlassVerifier(suite.db, NODE_B)).toBeNull();
  });

  it("reads a mirror link only for the node that was adopted", async () => {
    await writeMirrorConfig(suite.db, NODE_A, LINK);
    expect(await readMirrorConfig(suite.db, NODE_A)).toEqual(LINK);
    expect(await readMirrorConfig(suite.db, NODE_B)).toBeNull();
  });
});
