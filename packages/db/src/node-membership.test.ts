import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import { createPgliteDb } from "./client.js";
import { readNodeMembership, writeNodeMembership } from "./node-membership.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { captureError } from "./testing/errors.js";
import { usePgliteDb } from "./testing/lifecycle.js";

// PGlite, not real Postgres: the accessor round-trip is pure SQL logic (upsert/read of a singleton),
// with no privilege or RLS behaviour to observe. The grant read-back PGlite cannot show
// authoritatively lives in node-membership.rls.test.ts.

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

describe("node_membership accessors", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  it("reads null before any write (a node that has never adopted a document)", async () => {
    expect(await readNodeMembership(pg.db)).toBeNull();
  });

  it("reads null when the table itself is absent (a pre-migration handle)", async () => {
    // A bare, unmigrated PGlite: node_membership does not exist yet, so the `to_regclass` probe must
    // answer "absent" rather than throw — the exact state of a node that never ran 0096.
    const bare = await createPgliteDb();
    expect(await readNodeMembership(bare)).toBeNull();
    await bare.close();
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
      sql`select count(*)::int as n from node_membership`,
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
    const error = await captureError(() =>
      pg.db.execute(sql`insert into node_membership (id, term, document) values (2, 1, '{}')`),
    );
    expect(error).toBeDefined();
  });
});
