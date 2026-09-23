import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import {
  persistNodeMembershipIfNewer,
  persistNodeMembershipIfNewerTx,
  readNodeMembership,
  writeNodeMembership,
  writeNodeMembershipTx,
} from "./node-membership.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { captureError } from "./testing/errors.js";
import { useVenueDb } from "./testing/venue-db.js";

// The accessors are pure SQL logic — upsert and read of a singleton.
//
// LOSS, from the storage swap: the last block in this file used to run on a real PostgreSQL
// container, because the only thing PGlite could not answer was how the REAL `pg` driver decoded
// the `document` jsonb column, and the two drivers had diverged before (CLAUDE.md §4's `name[]`
// OID 1003 case). There is one driver now and one storage engine, so there is no second decoding
// to compare against; the rich-document round-trip that block carried is kept below, against the
// one engine there is.

function doc(term: number): SignedMembershipDocument {
  return {
    body: {
      term,
      nodes: [{ nodeId: "server-1", contactUrl: "https://s1", standing: "serving-primary" }],
    },
    signerNodeId: "server-1",
    signature: `sig-${term}`,
    endorsements: [],
  };
}

// A database with NO migration set applied, so `node_membership` does not exist — the state of a
// node before the set that creates the table has run. Its own `useVenueDb` rather than the migrated
// one the accessors' round-trip uses: the helper applies its sets in `beforeAll`, so one handle
// cannot be both migrated and unmigrated.
describe("before any migration set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("reads null when the table itself is absent", async () => {
    expect(await readNodeMembership(bare.db)).toBeNull();
  });
});

describe("node_membership accessors", () => {
  const pg = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("reads null before any write (a node that has never adopted a document)", async () => {
    expect(await readNodeMembership(pg.db)).toBeNull();
  });

  it("upserts the singleton and reads back the whole document", async () => {
    const d = doc(3);
    await writeNodeMembership(pg.db, d);
    expect(await readNodeMembership(pg.db)).toEqual(d);
  });

  it("denormalises term from document.body.term into the bigint column", async () => {
    await writeNodeMembership(pg.db, doc(7));
    const r = await pg.db.execute<{ term: string }>(
      sql`select term from node_membership where id = 1`,
    );
    expect(Number(r.rows[0]?.term)).toBe(7);
  });

  it("is a singleton — a second write updates the row in place, never inserts a second", async () => {
    await writeNodeMembership(pg.db, doc(1));
    await writeNodeMembership(pg.db, doc(2));
    const count = await pg.db.execute<{ n: number }>(
      sql`select count(*) as n from node_membership`,
    );
    expect(count.rows[0]?.n).toBe(1);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(2);
  });

  it("is a plain setter — it does NOT enforce monotonicity (that is acceptMembershipDocument's job)", async () => {
    // Storage is dumb (design §3 / owner decision): the authentic-and-strictly-newer fence lives in
    // @waitron/membership's acceptMembershipDocument, called by the Slice-3 adoption path BEFORE it
    // persists. A lower term written directly here simply overwrites — proving the fence is not here.
    await writeNodeMembership(pg.db, doc(5));
    await writeNodeMembership(pg.db, doc(2));
    expect((await readNodeMembership(pg.db))?.body.term).toBe(2);
  });

  it("permits at most one row — the singleton CHECK rejects any id but 1", async () => {
    const error = await captureError(async () => {
      pg.db.run(sql`insert into node_membership (id, term, document) values (2, 1, '{}')`);
    });
    expect(error).toBeDefined();
  });

  it("writeNodeMembershipTx writes inside a caller transaction", async () => {
    // The tx-taking form (Task 4 commits a singleton-role flip and this write in ONE transaction):
    // run it on a caller-provided tx and confirm the write persists after that transaction commits.
    const d = doc(3);
    await pg.db.transaction(async (tx) => {
      await writeNodeMembershipTx(tx, d);
    });
    expect((await readNodeMembership(pg.db))?.body.term).toBe(3);
  });
});

describe("persistNodeMembershipIfNewer (the term-guarded runtime-adoption write)", () => {
  // A separate `useVenueDb` database (not the suite above's) so this describe's beforeEach reset is
  // independent of the other describe's ordering — moved from apps/server/src/membership-adopt.test.ts,
  // where it exercised the same accessor before it lived here.
  const pg = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  // Order-independent (CLAUDE.md §4): clear the singleton before each case rather than relying on
  // execution order.
  beforeEach(async () => {
    await pg.db.execute(sql`delete from node_membership`);
  });

  it("upserts when there is no held document", async () => {
    expect(await persistNodeMembershipIfNewer(pg.db, doc(3))).toBe(true);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(3);
  });

  it("is monotonic — a lower term is a no-op, a higher term overwrites", async () => {
    await persistNodeMembershipIfNewer(pg.db, doc(5));
    // The atomic WHERE guard rejects the not-newer term: proven by deletion — removing `setWhere`
    // from persistNodeMembershipIfNewer makes this assertion fail (the term-3 write overwrites 5
    // instead of being rejected). Restored after confirming the failure.
    expect(await persistNodeMembershipIfNewer(pg.db, doc(3))).toBe(false);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(5);
    expect(await persistNodeMembershipIfNewer(pg.db, doc(7))).toBe(true);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(7);
  });

  it("persistNodeMembershipIfNewerTx accepts a strictly-newer doc on a caller tx", async () => {
    await writeNodeMembership(pg.db, doc(3));
    const accepted = await pg.db.transaction((tx) => persistNodeMembershipIfNewerTx(tx, doc(4)));
    expect(accepted).toBe(true);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(4);
  });

  it("persistNodeMembershipIfNewerTx rejects a non-newer doc (returns false, no write)", async () => {
    await writeNodeMembership(pg.db, doc(5));
    const accepted = await pg.db.transaction((tx) => persistNodeMembershipIfNewerTx(tx, doc(5)));
    expect(accepted).toBe(false);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(5);
  });

  it("a false return lets the caller roll back the whole transaction", async () => {
    await writeNodeMembership(pg.db, doc(7));
    await expect(
      pg.db.transaction(async (tx) => {
        const accepted = await persistNodeMembershipIfNewerTx(tx, doc(6));
        if (!accepted) throw new Error("superseded"); // caller's abort
      }),
    ).rejects.toThrow("superseded");
    expect((await readNodeMembership(pg.db))?.body.term).toBe(7); // untouched
  });
});

// The `document` column round-trip, with a document richer than `doc(term)` builds: two nodes, two
// standings and a populated `endorsements` list. It used to live in a real-PostgreSQL block whose
// reason was driver divergence (see this file's header); what it still shows is that the column's
// read mapping hands back a parsed object equal to what was written, nested arrays included, rather
// than the text the engine stores.
describe("node_membership document round-trip", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("round-trips the whole document through the document column", async () => {
    const document: SignedMembershipDocument = {
      body: {
        term: 4,
        nodes: [
          { nodeId: "server-1", contactUrl: "https://s1", standing: "sell-only" },
          { nodeId: "server-2", contactUrl: "https://s2", standing: "serving-primary" },
        ],
      },
      signerNodeId: "server-2",
      signature: "sig-4",
      endorsements: [
        { nodeId: "server-2", publicKey: "pk-2", endorsedBy: "server-1", signature: "esig" },
      ],
    };
    await writeNodeMembership(suite.db, document);
    expect(await readNodeMembership(suite.db)).toEqual(document);

    const term = await suite.db.execute<{ term: string }>(
      sql`select term from node_membership where id = 1`,
    );
    expect(Number(term.rows[0]?.term)).toBe(4);
  });
});
