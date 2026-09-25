import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, stampDeployment, readBreakGlassVerifier } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mintBreakGlassSecret, verifyBreakGlass } from "./break-glass.js";

// The core set only: mint and verify touch nothing else. The per-test reset leaves the third case
// a node with no verifier.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(async () => {
  // A role write is refused on an unstamped database, and the per-test reset removes the stamp.
  await stampDeployment(suite.db, "preproduction");
});

describe("break-glass mint + verify", () => {
  it("mints a secret, stores only a verifier, and verifies it", async () => {
    const secret = await mintBreakGlassSecret(suite.db, NODE);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const stored = await readBreakGlassVerifier(suite.db, NODE);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(secret);
    expect(stored!.startsWith("scrypt$")).toBe(true);
    expect(await verifyBreakGlass(suite.db, NODE, secret)).toBe(true);
    expect(await verifyBreakGlass(suite.db, NODE, "wrong")).toBe(false);
  });

  it("re-minting invalidates the previous secret", async () => {
    const first = await mintBreakGlassSecret(suite.db, NODE);
    const second = await mintBreakGlassSecret(suite.db, NODE);
    expect(await verifyBreakGlass(suite.db, NODE, first)).toBe(false);
    expect(await verifyBreakGlass(suite.db, NODE, second)).toBe(true);
  });

  it("verify returns false when no verifier is set", async () => {
    expect(await verifyBreakGlass(suite.db, NODE, "anything")).toBe(false);
  });
});
