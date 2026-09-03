import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { generateNodeKeyPair, type TrustSet } from "@waitron/membership";
import { CORE_MIGRATIONS, readNodeMembership, writeNodeMembership } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { adoptMembership } from "./membership-adopt.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

// A signed document at `term`, signed by node "A" with a generated identity key. The trust set maps
// "A" → that public key, so verifyMembershipDocument passes; an EMPTY trust set makes the same
// document untrusted_signer — the inert-seam production behaviour.
const kp = generateNodeKeyPair();
const doc = (term: number) => signedMembershipDoc(term, { keyPair: kp });
const TRUST: TrustSet = { A: kp.publicKey };
const EMPTY: TrustSet = {};

describe("membership adoption", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  // `usePgliteDb` shares ONE database across the suite (beforeAll/afterAll, no per-test reset), so
  // clear the singleton before each case — every test below asserts against a known starting term
  // (or an empty table), which makes them order-independent (CLAUDE.md §4).
  beforeEach(async () => {
    await pg.db.execute(sql`delete from node_membership`);
  });

  it("adoptMembership accepts an authentic, strictly-newer document and persists it", async () => {
    const outcome = await adoptMembership({ db: pg.db, trustSet: TRUST }, doc(2));
    expect(outcome.accepted).toBe(true);
    expect((await readNodeMembership(pg.db))?.body.term).toBe(2);
  });

  it("adoptMembership rejects an untrusted signer (the empty-trust-set production no-op)", async () => {
    const outcome = await adoptMembership({ db: pg.db, trustSet: EMPTY }, doc(9));
    expect(outcome).toEqual({ accepted: false, reason: "invalid", failure: "untrusted_signer" });
    expect(await readNodeMembership(pg.db)).toBeNull(); // nothing persisted
  });

  it("adoptMembership rejects a not-newer document and leaves the held one intact", async () => {
    await writeNodeMembership(pg.db, doc(5));
    const outcome = await adoptMembership({ db: pg.db, trustSet: TRUST }, doc(5));
    expect(outcome).toEqual({ accepted: false, reason: "not_newer" });
    expect((await readNodeMembership(pg.db))?.body.term).toBe(5);
  });

  it("adoptMembership treats a missing/malformed served value as nothing to adopt", async () => {
    expect((await adoptMembership({ db: pg.db, trustSet: TRUST }, undefined)).accepted).toBe(false);
    expect((await adoptMembership({ db: pg.db, trustSet: TRUST }, null)).accepted).toBe(false);
    expect((await adoptMembership({ db: pg.db, trustSet: TRUST }, { junk: 1 })).accepted).toBe(
      false,
    );
    expect(await readNodeMembership(pg.db)).toBeNull();
  });
});
