import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, stampDeployment, readBreakGlassVerifier } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mintBreakGlassSecret, verifyBreakGlass } from "./break-glass.js";

// One migrated venue directory, the CORE set only: `deployment` is core's, and mint/verify touch
// nothing else. There is no owner-vs-app split to model any more — `openVenueDatabase` hands out ONE
// handle per file and the two functions take the same `Database` — so the pair that used to need a
// real PostgreSQL clone with two role connections is now a single-handle test. `useVenueDb` empties
// the data after every test, which is what the third case needs: a venue whose verifier is unset.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

beforeEach(async () => {
  // Create the id=1 singleton row `setBreakGlassVerifierTx`'s UPDATE has to hit; the per-test reset
  // removes it again.
  await stampDeployment(suite.db, "preproduction");
});

describe("break-glass mint + verify", () => {
  it("mints a secret, stores only a verifier, and verifies it", async () => {
    const secret = await mintBreakGlassSecret(suite.db);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url, high-entropy
    const stored = await readBreakGlassVerifier(suite.db);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(secret); // the raw secret is NEVER stored
    expect(stored!.startsWith("scrypt$")).toBe(true);
    expect(await verifyBreakGlass(suite.db, secret)).toBe(true);
    expect(await verifyBreakGlass(suite.db, "wrong")).toBe(false);
  });

  it("re-minting invalidates the previous secret", async () => {
    const first = await mintBreakGlassSecret(suite.db);
    const second = await mintBreakGlassSecret(suite.db);
    expect(await verifyBreakGlass(suite.db, first)).toBe(false);
    expect(await verifyBreakGlass(suite.db, second)).toBe(true);
  });

  it("verify returns false when no verifier is set", async () => {
    expect(await verifyBreakGlass(suite.db, "anything")).toBe(false);
  });
});
