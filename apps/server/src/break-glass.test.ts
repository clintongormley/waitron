import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS, readRecoveryKeyVerifier } from "@waitron/node-db";
import { mintBreakGlassSecret, verifyBreakGlass } from "./break-glass.js";

// The core set and node.db's own: mint and verify touch nothing else.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, { ...NODE_MIGRATIONS, database: "node" }],
  timeoutMs: 60_000,
});
const handles = () => ({ venue: suite.db, node: suite.node });

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(async () => {
  // A role write is refused on an unstamped database, and the per-test reset removes the stamp.
  await stampDeployment(suite.db, "preproduction");
});

describe("break-glass mint + verify", () => {
  it("mints a secret, stores only a verifier, and verifies it", async () => {
    const secret = await mintBreakGlassSecret(handles(), NODE);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const stored = await readRecoveryKeyVerifier(suite.node, NODE);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(secret);
    expect(stored!.startsWith("scrypt$")).toBe(true);
    expect(await verifyBreakGlass(suite.node, NODE, secret)).toBe(true);
    expect(await verifyBreakGlass(suite.node, NODE, "wrong")).toBe(false);
  });

  it("re-minting invalidates the previous secret", async () => {
    const first = await mintBreakGlassSecret(handles(), NODE);
    const second = await mintBreakGlassSecret(handles(), NODE);
    expect(await verifyBreakGlass(suite.node, NODE, first)).toBe(false);
    expect(await verifyBreakGlass(suite.node, NODE, second)).toBe(true);
  });

  it("lets the event loop keep turning while it checks the secret", async () => {
    const secret = await mintBreakGlassSecret(handles(), NODE);
    let turns = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);
    try {
      expect(await verifyBreakGlass(suite.node, NODE, secret)).toBe(true);
    } finally {
      done = true;
    }
    expect(turns).toBeGreaterThan(1);
  });

  it("verify returns false when no verifier is set", async () => {
    expect(await verifyBreakGlass(suite.node, NODE, "anything")).toBe(false);
  });

  it("refuses an unstamped venue database and writes no key", async () => {
    await suite.db.execute(sql`delete from deployment`);
    await expect(mintBreakGlassSecret(handles(), NODE)).rejects.toMatchObject({
      code: "deployment.not_stamped",
    });
    expect(await readRecoveryKeyVerifier(suite.node, NODE)).toBeNull();
  });
});
