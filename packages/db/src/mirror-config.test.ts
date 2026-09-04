import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "./client.js";
import { readMirrorConfig, writeMirrorConfig } from "./mirror-config.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { captureError } from "./testing/errors.js";
import { usePgliteDb } from "./testing/lifecycle.js";

// PGlite, not real Postgres: the accessor round-trip is pure SQL logic (upsert/read of a
// singleton), with no privilege or RLS behaviour to observe — every PGlite connection is a
// superuser, so it is the right, lighter target here. The grant read-back that PGlite cannot show
// authoritatively lives in mirror-config.rls.test.ts.

// A fixed v4 UUID standing in for the primary's nodeId (the mirror's sync origin).
const PRIMARY_NODE = "11111111-1111-4111-8111-111111111111";

const SAMPLE: Parameters<typeof writeMirrorConfig>[1] = {
  relayUrl: "https://relay.test:9000/",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n",
  originNodeId: PRIMARY_NODE,
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

  it("round-trips originNodeId (the mirror's sync origin) through write/read", async () => {
    await writeMirrorConfig(pg.db, SAMPLE);
    const back = await readMirrorConfig(pg.db);
    expect(back?.originNodeId).toBe(PRIMARY_NODE);
  });

  it("is a singleton — a second write updates the row in place, never inserts a second", async () => {
    await writeMirrorConfig(pg.db, {
      relayUrl: "https://relay-one.test:9000/",
      boxHostname: "a",
      boxCaPem: "a",
      originNodeId: PRIMARY_NODE,
    });
    await writeMirrorConfig(pg.db, {
      relayUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
      originNodeId: PRIMARY_NODE,
    });
    const count = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int as n from mirror_config`,
    );
    expect(count.rows[0]?.n).toBe(1);
    expect(await readMirrorConfig(pg.db)).toEqual({
      relayUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
      originNodeId: PRIMARY_NODE,
    });
  });

  it("permits at most one row — the singleton CHECK rejects any id but 1", async () => {
    // mirror_config_singleton_ck pins id = 1, so a second row can never exist and "what is this
    // mirror's config" can never have two answers. Mirrors deployment.test.ts's own singleton test.
    const error = await captureError(() =>
      pg.db.execute(
        sql`insert into mirror_config (id, relay_url, box_hostname, box_ca_pem, origin_node_id) values (2, 'x', 'x', 'x', ${PRIMARY_NODE})`,
      ),
    );
    expect(error).toBeDefined();
  });
});
