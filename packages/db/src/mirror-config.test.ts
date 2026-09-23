import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readMirrorConfig, writeMirrorConfig } from "./mirror-config.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { UNIQUE_VIOLATION } from "./sql-state.js";
import { isRefusal } from "./unique-violation.js";
import { captureError } from "./testing/errors.js";
import { useVenueDb } from "./testing/venue-db.js";

// The accessors are pure SQL logic — upsert and read of one node's row.

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// A fixed v4 UUID standing in for the primary's nodeId (the mirror's sync origin).
const PRIMARY_NODE = "11111111-1111-4111-8111-111111111111";

const SAMPLE: Parameters<typeof writeMirrorConfig>[2] = {
  relayUrl: "https://relay.test:9000/",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n",
  originNodeId: PRIMARY_NODE,
};

// A database with NO migration set applied, so `mirror_config` does not exist — the state of a
// primary that has never been adopted as a mirror. Its own `useVenueDb` rather than the migrated
// one the accessors' round-trip uses: the helper applies its sets in `beforeAll`, so one handle
// cannot be both migrated and unmigrated.
describe("before any migration set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("reads null when the table itself is absent", async () => {
    expect(await readMirrorConfig(bare.db, NODE)).toBeNull();
  });
});

describe("mirror_config accessors", () => {
  const pg = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("reads null before any write (a primary/unstamped database)", async () => {
    expect(await readMirrorConfig(pg.db, NODE)).toBeNull();
  });

  it("upserts this node's row and reads it back", async () => {
    await writeMirrorConfig(pg.db, NODE, SAMPLE);
    expect(await readMirrorConfig(pg.db, NODE)).toEqual(SAMPLE);
  });

  it("round-trips originNodeId (the mirror's sync origin) through write/read", async () => {
    await writeMirrorConfig(pg.db, NODE, SAMPLE);
    const back = await readMirrorConfig(pg.db, NODE);
    expect(back?.originNodeId).toBe(PRIMARY_NODE);
  });

  it("a second write for the same node updates its row in place", async () => {
    await writeMirrorConfig(pg.db, NODE, {
      relayUrl: "https://relay-one.test:9000/",
      boxHostname: "a",
      boxCaPem: "a",
      originNodeId: PRIMARY_NODE,
    });
    await writeMirrorConfig(pg.db, NODE, {
      relayUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
      originNodeId: PRIMARY_NODE,
    });
    const count = await pg.db.execute<{ n: number }>(sql`select count(*) as n from mirror_config`);
    expect(count.rows[0]?.n).toBe(1);
    expect(await readMirrorConfig(pg.db, NODE)).toEqual({
      relayUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
      originNodeId: PRIMARY_NODE,
    });
  });

  it("permits at most one row per node — the primary key refuses a second", async () => {
    // `node_id` is the primary key, so "what is this node's mirror config" can never have two
    // answers. `adopted_at` is stated because it is a `$defaultFn` column Drizzle fills
    // CLIENT-side: a raw insert would otherwise be refused NOT NULL rather than by the key.
    await writeMirrorConfig(pg.db, NODE, SAMPLE);
    const error = await captureError(() =>
      Promise.resolve(
        pg.db.run(
          sql`insert into mirror_config (node_id, relay_url, box_hostname, box_ca_pem, origin_node_id, adopted_at) values (${NODE}, 'x', 'x', 'x', ${PRIMARY_NODE}, ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
  });
});
