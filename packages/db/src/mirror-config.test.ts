import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./client.js";
import { readMirrorConfig, writeMirrorConfig } from "./mirror-config.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { usePgliteDb } from "./testing/lifecycle.js";

// PGlite, not real Postgres: the accessor round-trip is pure SQL logic (upsert/read of a
// singleton), with no privilege or RLS behaviour to observe — every PGlite connection is a
// superuser, so it is the right, lighter target here. The grant read-back that PGlite cannot show
// authoritatively lives in mirror-config.rls.test.ts.

const SAMPLE: Parameters<typeof writeMirrorConfig>[1] = {
  relayUrl: "https://relay.test:9000/",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n",
};

describe("mirror_config accessors", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  it("reads null before any write (a primary/unstamped database)", async () => {
    expect(await readMirrorConfig(pg.db)).toBeNull();
  });

  it("reads null when the table itself is absent (a pre-migration handle)", async () => {
    // A bare, unmigrated PGlite: mirror_config does not exist yet, so the `to_regclass` probe must
    // answer "absent" rather than throw — the exact state of a primary that never ran 0071.
    const bare = await createPgliteDb();
    expect(await readMirrorConfig(bare)).toBeNull();
    await bare.close();
  });

  it("upserts the singleton and reads it back", async () => {
    await writeMirrorConfig(pg.db, SAMPLE);
    expect(await readMirrorConfig(pg.db)).toEqual(SAMPLE);
  });

  it("is a singleton — a second write updates the row in place, never inserts a second", async () => {
    await writeMirrorConfig(pg.db, {
      relayUrl: "https://relay-one.test:9000/",
      boxHostname: "a",
      boxCaPem: "a",
    });
    await writeMirrorConfig(pg.db, {
      relayUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
    });
    const count = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int as n from mirror_config`,
    );
    expect(count.rows[0]?.n).toBe(1);
    expect(await readMirrorConfig(pg.db)).toEqual({
      relayUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
    });
  });
});
