/**
 * The join-request verbs — mint, cap, sweep, challenge, accept, deny, self-enrol — on the engine
 * the box now runs.
 *
 * ## What went with PostgreSQL, and is replaced by nothing
 *
 * 1. **The ROLE is gone.** The old header argued this file needed real PostgreSQL rather than
 *    PGlite because every verb runs as `app_user` and the `join_requests` grants (SELECT, INSERT,
 *    DELETE and deliberately no UPDATE) were part of what each case asserted. SQLite has no roles
 *    and no grants: one process opens one file and `asAppUser` is an empty function body
 *    (`packages/db/src/testing/roles.ts:25`). **Nothing now checks that the deployment role cannot
 *    UPDATE a join request** — the refusal the two back-dating fixture steps below used to have to
 *    step outside an `asAppUser` transaction to get around.
 *
 * 2. **FOUR cases staged an interleave on two PostgreSQL backends, and none of them can any
 *    longer.** They are the two in `createJoinRequest — per-tenant serialization…` and the two
 *    `two concurrent accepts…` cases. Each called `suite.pg.connect()` twice; there is one handle
 *    now, and `withTransaction` runs its body inside `db.withWriteLock`, which issues
 *    `begin immediate` and does not let the next caller's `begin` run until the first `commit` has
 *    returned (`packages/store/src/write-queue.ts`). The two allocation cases went further and
 *    forced the interleave deterministically — a waiter holding its transaction open until the
 *    other creator's injected `numbers()` callback fired a signal from INSIDE its own reads. That
 *    machinery is deleted rather than translated: the signal can never fire while the first
 *    transaction is open, so leaving it would be scaffolding that proves nothing.
 *
 *    **LOST: the proof that overlapping creators are serialised at all**, in either direction.
 *    Each of the four cases keeps its assertions unchanged and they still hold — the cap is never
 *    exceeded, the loser is refused by name (`device.join_full`, `join_request.not_found`), no two
 *    reals collide, and no orphan register is left behind — but the reading is now of a queue that
 *    admits one writer, not of a guard inside `createJoinRequest`. There is no longer a clause to
 *    delete as a control either: `createJoinRequest`'s own transaction-scoped advisory lock went in
 *    `cd2838e4a`, whose SUBJECT is about the dev stack but whose body names this among its four
 *    conversions; `apps/server/src/join-requests.ts:66-72` states what replaced it.
 *
 *    The KEY-SCOPE half — that the allocation guard must be database-wide rather than
 *    per-location — went with `join-requests.pg.test.ts`, deleted in `c6b5496c0`, and is covered
 *    by nothing.
 *
 * ## One correction to this file's own previous header
 *
 * It said THREE cases raced on two connections. There are four:
 * `git show c6b5496c0:apps/server/src/join-requests.test.ts | grep -n 'const a = await
 * suite.pg.connect()'` prints four lines — 287, 356, 701 and 751 — one per `it` body. Run
 * 2026-09-22.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  JOIN_TTL_MS,
  PENDING_CAP,
  acceptDeviceJoinRequest,
  acceptPrintAgentJoinRequest,
  challengeFor,
  createJoinRequest,
  denyJoinRequest,
  listPendingJoinRequests,
  readAgentJoinStatus,
  readJoinStatus,
  selfEnrolNodeAgent,
  type AcceptResult,
} from "./join-requests.js";
// `useVenueDb` is NOT on the `@waitron/db` barrel — the exports map is enumerated (CLAUDE.md §3),
// so it comes from its own subpath below.
import {
  deviceProfiles,
  devices,
  joinRequests,
  printAgents,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { verifySecret } from "@waitron/identity";
import { authenticateAgent } from "@waitron/printing";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TillConfig } from "./till-config.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// A device_profiles row of the given form factor, seeded directly rather than through a verb — this
// table is fixture, not subject. Copied from device-api.test.ts:177-188 rather than shared, the
// same call this file's sibling suites make (module state — the counter — resets per file).
let profileCounter = 0;
async function seedProfile(
  formFactor: "till" | "kds" | "phone-portrait" | "tablet-landscape",
): Promise<string> {
  profileCounter += 1;
  // Through the table definition, as `apps/server/src/testing/fiscal-fixtures.ts` is:
  // `device_profiles.id`, `created_at` and `updated_at` are `$defaultFn` generators a raw insert
  // never reaches, and it is also what encodes `capabilities` — the `::jsonb` cast is a syntax
  // error to this parser (`unrecognized token: ":"`).
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${profileCounter}`, formFactor, capabilities: [] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

// One `withTransaction` per call — the shape every verb here is exercised through. `asAppUser` is an
// empty body on this engine (`packages/db/src/testing/roles.ts:25`); the call is kept because the
// production callers make it and the file should not diverge from them.
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return fn(tx);
  });
}

// The `code` of the AppError `fn` throws, or undefined if it does not throw — lets a test assert the
// domain code without a try/catch inside every case.
async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe("createJoinRequest", () => {
  it("mints a two-digit number, an id and a token, and leaves one pending row", async () => {
    const venue = await setupVenue(suite.db);
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
      });
    });
    expect(made.verificationNumber).toMatch(/^\d{2}$/);
    expect(made.token.length).toBeGreaterThan(20);
    expect(made.joinId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never mints a number another pending request already holds, in EITHER kind", async () => {
    const venue = await setupVenue(suite.db);
    // Force the generator to want 47 every time; the first request takes it, the second must not.
    const always47 = () => 47;
    const first = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, {
        kind: "print_agent",
        label: "Kitchen box",
        numbers: always47,
      });
    });
    expect(first.verificationNumber).toBe("47");
    // The first request's two DECOYS are random and are ALSO spoken for, so the second generator's
    // fallback has to be a value they did not take: a generator that only ever yields one blocked
    // number starves the pick loop into `device.join_full`, which is exactly the path the
    // "real avoids issued decoys" test below demonstrates on purpose. Read them back and choose a
    // free fallback, keeping this test about the REAL-number rule it is named for. Through the table
    // definition rather than `unnest`: this column is a JSON array in a text column, so drizzle's
    // decoding is what turns it into two values (`unnest` is a PostgreSQL set-returning function
    // with no counterpart here).
    const taken = (
      await suite.db.select({ decoys: joinRequests.decoyNumbers }).from(joinRequests)
    ).flatMap((r) => r.decoys);
    expect(taken).toHaveLength(2);
    for (const n of taken) expect(n).toMatch(/^\d{2}$/);
    const spokenFor = new Set(["47", ...taken]);
    const fallback = ["13", "14", "15", "16"].find((n) => !spokenFor.has(n))!;
    const second = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
        numbers: (() => {
          let n = 0;
          return () => (n++ === 0 ? 47 : Number(fallback));
        })(),
      });
    });
    expect(second.verificationNumber).toBe(fallback);
  });

  it("refuses a real number that is already someone else's DECOY (rule: real avoids issued decoys)", async () => {
    const venue = await setupVenue(suite.db);
    // Seeded directly, bypassing createJoinRequest entirely — decoys
    // are deliberately non-injectable (production always draws them from randomInt), so this is the
    // only way to pin one to a known value. The seeded row's own REAL number is 77, unrelated to 13:
    // if it were 13 too, a broken "real avoids existing reals" rule would make this pass for the
    // wrong reason.
    // Through the table definition: `join_requests.id` and `created_at` are `$defaultFn`
    // generators, `kind` is a plain text column with a CHECK rather than a PostgreSQL enum TYPE (so
    // the `::join_request_kind` cast has nothing to name), and `decoy_numbers` is a JSON array in a
    // text column, not a `text[]`.
    await suite.db.insert(joinRequests).values({
      locationId: venue.cfg.locationId,
      kind: "device",
      label: "seeded",
      tokenHash: "x",
      verificationNumber: "77",
      decoyNumbers: ["13", "86"],
    });
    await withTransaction(suite.db, async (tx) => {
      await expect(
        createJoinRequest(tx, venue.cfg, { kind: "device", label: "wants 13", numbers: () => 13 }),
      ).rejects.toMatchObject({ code: "device.join_full" });
    });
  });

  it("refuses to mint the second DECOY once every other value is already someone's real number (rule: decoys avoid existing reals)", async () => {
    const venue = await setupVenue(suite.db);
    // 98 of the 100 two-digit values are already reals, seeded under a DIFFERENT kind so the
    // per-KIND cap (10) never trips on them — pendingNumbers reads across BOTH kinds
    // (design §1.2 rule 3), so they still count toward this request's forbidden set. "00" and "01"
    // are the only two values left free.
    // The rows are built in JavaScript and inserted through the table definition. `generate_series`
    // is a PostgreSQL set-returning function with no counterpart guaranteed here, `lpad` likewise,
    // and the column notes on the seed above apply unchanged.
    await suite.db.insert(joinRequests).values(
      Array.from({ length: 98 }, (_, i) => i + 2).map((n) => ({
        locationId: venue.cfg.locationId,
        kind: "print_agent" as const,
        label: `seed ${n}`,
        tokenHash: "x",
        verificationNumber: String(n).padStart(2, "0"),
        decoyNumbers: [],
      })),
    );
    await withTransaction(suite.db, async (tx) => {
      // Force the real pick onto "00", the first free value — "01" is then the ONLY value left for
      // the two decoys, which is not enough: the second decoy can never be found.
      await expect(
        createJoinRequest(tx, venue.cfg, { kind: "device", label: "wants 00", numbers: () => 0 }),
      ).rejects.toMatchObject({ code: "device.join_full" });
    });
  });

  it("refuses past the cap, per kind", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      for (let i = 0; i < PENDING_CAP; i++) {
        await createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: `d${i}`,
        });
      }
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: "one too many",
        }),
      ).rejects.toMatchObject({ code: "device.join_full" });
      // The OTHER kind is unaffected — the cap is per KIND.
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "print_agent",
          label: "agent",
        }),
      ).resolves.toBeDefined();
    });
  });

  it("sweeps lapsed requests, so they do not occupy the cap or a number", async () => {
    const venue = await setupVenue(suite.db);
    const stale = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "stale" });
    });
    // A fixture back-date, written straight to the column: no verb ages a request, and there is no
    // `now()` to offset against — `created_at` is an ISO string column (`tsString`,
    // `packages/db/src/schema/join-requests.ts:58`).
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.db.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${stale.joinId}`,
    );
    await withTransaction(suite.db, async (tx) => {
      await createJoinRequest(tx, venue.cfg, { kind: "device", label: "fresh" });
      // Unscoped on purpose: `useVenueDb` empties the data tables after each test, so the only rows
      // here are this case's own — which is what makes `["fresh"]` an exact list rather than a
      // subset, and is the whole assertion (the lapsed row is GONE, not merely unreturned).
      const { rows } = await tx.execute<{ label: string }>(sql`select label from join_requests `);
      expect(rows.map((r) => r.label)).toEqual(["fresh"]);
    });
  });
});

describe("createJoinRequest — per-tenant serialization of number allocation and the cap", () => {
  // Both creators are started together on the one handle and the write queue decides the order:
  // `withTransaction` runs its body inside `db.withWriteLock`, which issues `begin immediate` and
  // does not let the next caller's `begin` run until the first `commit` has returned
  // (`packages/store/src/write-queue.ts`). So the SECOND creator always reads a snapshot that
  // already holds the first's committed row — which is what the two cases below assert about.
  //
  // What is NOT staged here, and is recorded in this file's header: the stale-snapshot interleave
  // the PostgreSQL version forced with a held-open transaction and a signal fired from the injected
  // `numbers()` callback. Nothing on this engine can put a second reader inside the first's
  // transaction, so neither case can any longer fail the way the advisory lock's absence made it
  // fail.

  it("two overlapping creations never mint the same real number, across BOTH kinds (rule 3)", async () => {
    const venue = await setupVenue(suite.db);
    // First creator: forced to 50.
    const first = withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "waiter",
        numbers: () => 50,
      });
    });
    // Second creator, of the OTHER kind: a walk starting at 50. Whichever of the two the queue runs
    // second reads 50-is-taken and walks on to the first free value — the cross-KIND half of rule 3.
    const second = withTransaction(suite.db, async (tx) => {
      let k = 50;
      return createJoinRequest(tx, venue.cfg, {
        kind: "print_agent",
        label: "signaller",
        numbers: () => {
          const v = k;
          k = (k + 1) % 100;
          return v;
        },
      });
    });
    await Promise.allSettled([first, second]);

    // Read back EVERY committed request and assert the cross-surface exclusion. Through the table
    // definition, so `decoy_numbers` arrives decoded. A raw read hands that column back as the JSON
    // TEXT it is stored as, and the decoy loop below then iterates CHARACTERS: measured 2026-09-22
    // with the raw read restored, this case still passes, because no single character is any
    // request's two-digit real number. The raw shape does not fail here, it goes vacuous.
    const rows = await suite.db
      .select({ real: joinRequests.verificationNumber, decoys: joinRequests.decoyNumbers })
      .from(joinRequests);
    const reals = rows.map((r) => r.real);
    // No two committed requests share a real number (the 50/50 collision the bug produces).
    expect(new Set(reals).size).toBe(reals.length);
    // No committed decoy equals any OTHER committed request's real number, either kind (rule 3).
    const realSet = new Set(reals);
    for (const r of rows) {
      for (const d of r.decoys) {
        if (d !== r.real) expect(realSet.has(d)).toBe(false);
      }
    }
  });

  it("nine pending plus two overlapping creations never exceed the cap; the loser gets device.join_full", async () => {
    const venue = await setupVenue(suite.db);
    // Seed nine pending `device` requests directly — one shy of the cap. Reals 01..09, empty decoys.
    await suite.db.insert(joinRequests).values(
      Array.from({ length: 9 }, (_, i) => i + 1).map((n) => ({
        locationId: venue.cfg.locationId,
        kind: "device" as const,
        label: `seed ${n}`,
        tokenHash: "x",
        verificationNumber: String(n).padStart(2, "0"),
        decoyNumbers: [],
      })),
    );
    // One creator takes the tenth slot (real 50); the other wants an eleventh.
    const tenth = withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "tenth",
        numbers: () => 50,
      });
    });
    const eleventh = withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "eleventh",
        numbers: () => 60,
      });
    });
    const outcomes = await Promise.allSettled([tenth, eleventh]);

    // No `::int` here or in the three sibling counts below: `count(*)` already comes back as a
    // JavaScript number, and the cast operator is a syntax error to this parser.
    const { rows } = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from join_requests
      where kind = 'device'
    `);
    expect(rows[0]!.n).toBeLessThanOrEqual(PENDING_CAP);
    // Exactly one of the two overlapping creators is refused (which one is not asserted), and the
    // refusal is the clean domain code — never two silent inserts past the cap.
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "device.join_full",
    });
  });
});

describe("readJoinStatus", () => {
  it("is pending for a live request with the right token", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, made.token);
      expect(status).toBe("pending");
    });
  });

  it("is not_approved for a wrong token on a live request", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, "wrong-token");
      expect(status).toBe("not_approved");
    });
  });

  it("is not_approved for an id that never existed", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const status = await readJoinStatus(
        tx,
        venue.cfg,
        "00000000-0000-4000-8000-000000000000",
        "irrelevant-token",
      );
      expect(status).toBe("not_approved");
    });
  });

  it("is not_approved once the request has lapsed", async () => {
    const venue = await setupVenue(suite.db);
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
    });
    // A fixture back-date, written straight to the column, for the reason the sweep case above
    // states.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.db.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${made.joinId}`,
    );
    await withTransaction(suite.db, async (tx) => {
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, made.token);
      expect(status).toBe("not_approved");
    });
  });
  // The `approved` case needs an accepted device — see acceptDeviceJoinRequest's own first test below,
  // which asserts it via this same function.
});

describe("listPendingJoinRequests", () => {
  it("returns pending rows of the asked-for kind and NEVER the number", async () => {
    const venue = await setupVenue(suite.db);
    const rows = await withTransaction(suite.db, async (tx) => {
      await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      await createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "Box" });
      return listPendingJoinRequests(tx, venue.cfg, "device");
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("Bar till");
    // The whole point of the numeric match: the list cannot show the answer beside the question. The
    // key set is what expresses that — a "no two digits anywhere" assertion would trip on the row's
    // own UUID and ISO timestamp and could never pass.
    expect(Object.keys(rows[0]!).sort()).toEqual(["createdAt", "id", "kind", "label"]);
  });
});

describe("challengeFor", () => {
  it("returns three choices, one of which is the request's own number", async () => {
    const venue = await setupVenue(suite.db);
    const { made, choices } = await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      return { made, choices: (await challengeFor(tx, venue.cfg, made.joinId)).choices };
    });
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).toContain(made.verificationNumber);
    for (const c of choices) expect(c).toMatch(/^\d{2}$/);
  });

  it("returns the SAME three numbers on every call — a second call must teach nothing", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      const first = await challengeFor(tx, venue.cfg, made.joinId);
      const second = await challengeFor(tx, venue.cfg, made.joinId);
      // Sets, not arrays: the order is shuffled per call, the MEMBERSHIP is fixed. Two re-rolled sets
      // would intersect in exactly one value — the real one — handing the answer to any client with a
      // management session.
      expect(new Set(second.choices)).toEqual(new Set(first.choices));
    });
  });

  it("never offers a decoy that is another pending request's real number, in EITHER kind", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      // The agent request's REAL number is spoken for the moment it exists — createJoinRequest's own
      // forbidden set (reals ∪ decoys, both kinds) is what keeps the device request's pick and decoys
      // off it; challengeFor has no number source to rig, so this is proven by construction, not by
      // forcing a collision attempt.
      const agent = await createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "a" });
      const device = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      const { choices } = await challengeFor(tx, venue.cfg, device.joinId);
      expect(choices).toContain(device.verificationNumber);
      expect(choices).not.toContain(agent.verificationNumber);
    });
  });

  it("shuffles the choice order — the real number is not always at the same index", async () => {
    const venue = await setupVenue(suite.db);
    // One pending request at a time, denied before the next is made, to stay under PENDING_CAP while
    // sampling enough shuffles that a fixed position (a broken Fisher-Yates) would show up reliably.
    const positions = new Set<number>();
    await withTransaction(suite.db, async (tx) => {
      for (let i = 0; i < 30; i++) {
        const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: `d${i}` });
        const { choices } = await challengeFor(tx, venue.cfg, made.joinId);
        positions.add(choices.indexOf(made.verificationNumber));
        await denyJoinRequest(tx, venue.cfg, made.joinId);
      }
    });
    expect(positions.size).toBeGreaterThan(1);
  });

  it("throws join_request.not_found for an unknown id", async () => {
    const venueA = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await expect(
        challengeFor(tx, venueA.cfg, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
  });
});

describe("acceptDeviceJoinRequest", () => {
  it("creates the device with the request's OWN id, so the joiner's cookie survives", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const { made, accepted, status } = await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const accepted = await acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
        choice: made.verificationNumber,
        profileId,
      });
      return {
        made,
        accepted,
        status: await readJoinStatus(tx, venue.cfg, made.joinId, made.token),
      };
    });
    expect(accepted).toMatchObject({ ok: true, deviceId: made.joinId, formFactor: "till" });
    expect(status).toBe("approved");
  });

  it("auto-creates the register for a till form factor, in the SAME transaction as the device", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const label = "Bar till";
    const accepted = await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label });
      return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
        choice: made.verificationNumber,
        profileId,
      });
    });
    if (!accepted.ok) throw new Error("expected accept to succeed");
    const { rows } = await suite.db.execute<{ id: string; till_id: string | null }>(sql`
      select t.id, d.till_id from tills t
      join devices d on d.till_id = t.id
      where t.name = ${label} and d.id = ${accepted.deviceId}
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.till_id).toBe(rows[0]!.id);
  });

  it("rolls the register back when the device insert fails", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Blocked till" });
    });
    // Plant a devices row under the request's OWN id first: acceptDeviceJoinRequest reuses that id, so
    // its device INSERT collides on the primary key AFTER resolveDeviceBinding has already
    // auto-created the till-form-factor register — the write order the "one transaction" comment
    // depends on. `device_binding_rule` demands a till_id for this profile's form factor, so the
    // blocker borrows the venue's own provisioned register — any live till satisfies the trigger.
    // Through the table definition: `devices.enrolled_at` and `created_at` are NOT NULL columns
    // whose values come from `$defaultFn` generators (`packages/db/src/schema/devices.ts:77-78`),
    // which a raw statement never reaches.
    await suite.db.insert(devices).values({
      id: made.joinId,
      locationId: venue.cfg.locationId,
      tillId: venue.cfg.tillId,
      deviceProfileId: profileId,
      label: "blocker",
      tokenHash: "x",
      active: true,
    });
    await expect(
      withTransaction(suite.db, async (tx) => {
        return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        });
      }),
    ).rejects.toThrow();
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from tills where name = 'Blocked till'`,
    );
    expect(rows).toHaveLength(0);
    // The consuming delete rides the SAME transaction as the register and device inserts (accept's
    // header comment) — a genuine retry must still find the request PENDING, not gone, once the
    // blocker device row (a fixture artefact, not a real collision) is cleared.
    await suite.db.execute(sql`delete from devices where id = ${made.joinId}`);
    await withTransaction(suite.db, async (tx) => {
      expect(await readJoinStatus(tx, venue.cfg, made.joinId, made.token)).toBe("pending");
    });
  });

  it("DENIES on a wrong choice, and the deny SURVIVES THE TRANSACTION", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    // Two SEPARATE withTransaction blocks on purpose. A single block that catches the rejection inside
    // itself never commits or rolls anything back, so it would pass against code that throws from
    // inside the transaction and loses the DELETE — the defect this test exists to catch.
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    const wrong = made.verificationNumber === "00" ? "01" : "00";
    const refused = await withTransaction(suite.db, async (tx) => {
      return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { choice: wrong, profileId });
    });
    expect(refused).toEqual({ ok: false, reason: "mismatch" });
    // Gone AFTER the transaction committed — this is what makes one-in-three an acceptable guess rate.
    await withTransaction(suite.db, async (tx) => {
      await expect(
        acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
      expect(await readJoinStatus(tx, venue.cfg, made.joinId, made.token)).toBe("not_approved");
    });
  });

  it("refuses a print_agent request — a device accept cannot turn an agent's ask into a device", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, {
        kind: "print_agent",
        label: "Kitchen box",
      });
      await expect(
        acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
  });

  it("two concurrent accepts of ONE request: exactly one wins, the loser gets join_request.not_found — never a raw devices_pkey 23505", async () => {
    const venue = await setupVenue(suite.db);
    // A `kds` profile bound to an EXISTING station: resolveDeviceBinding only reads
    // (requireLiveStation, a SELECT) rather than writing a named resource — a `till` profile's
    // auto-created register would collide on ITS OWN name first (tills_tenant_location_name_key) and
    // mask the race this test targets, since both racers would derive the same register name from
    // the request's one label. This isolates the collision to the one write both racers actually
    // contend for: the `devices` INSERT that reuses the request's id.
    const profileId = await seedProfile("kds");
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Racer" });
    });

    // Two accepts of the same request started together on the one handle. The write queue runs them
    // one after the other (`packages/store/src/write-queue.ts`), so the second begins only once the
    // first has committed its consuming delete — it reads the request GONE rather than reading it
    // alongside the first, which is the difference recorded in this file's header.
    const attempt = (db: Database): Promise<AcceptResult> =>
      withTransaction(db, async (tx) => {
        return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
          stationId: venue.defaultStationId,
        });
      });

    const outcomes = await Promise.allSettled([attempt(suite.db), attempt(suite.db)]);
    const winner = outcomes.find(
      (o): o is PromiseFulfilledResult<AcceptResult> => o.status === "fulfilled",
    );
    const loser = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(winner!.value).toMatchObject({ ok: true });
    // The Critical this test exists to catch: the loser must see the clean domain code, never a raw
    // primary-key violation on `devices`.
    expect(loser!.reason).toMatchObject({ code: "join_request.not_found" });

    const { rows } = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from devices
      where id = ${made.joinId}
    `);
    expect(rows[0]!.n).toBe(1);
  });

  it("two concurrent accepts of a TILL profile: exactly one wins, the loser never reaches register creation", async () => {
    const venue = await setupVenue(suite.db);
    // A `till` profile: resolveDeviceBinding WRITES here (createRegister auto-creates a `tills` row
    // named after the device before the device INSERT), the different failure mode from the `kds`
    // race above — under the old plain-SELECT shape, the loser reached `createRegister` too, deriving
    // the SAME name from the one request's label, and failed on `device.register_name_taken` (a
    // clean-looking but WRONG code that masks the real defect) rather than ever reaching the
    // `devices` INSERT. Delete-first must stop the loser before it writes anything at all.
    const profileId = await seedProfile("till");
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Till racer" });
    });

    const attempt = (db: Database): Promise<AcceptResult> =>
      withTransaction(db, async (tx) => {
        return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        });
      });

    const outcomes = await Promise.allSettled([attempt(suite.db), attempt(suite.db)]);
    const winner = outcomes.find(
      (o): o is PromiseFulfilledResult<AcceptResult> => o.status === "fulfilled",
    );
    const loser = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(winner!.value).toMatchObject({ ok: true });
    // The point: under delete-first the loser is refused BEFORE it ever calls createRegister, so
    // it sees the same join_request.not_found every other losing race does — never
    // device.register_name_taken, which would mean it got as far as writing a second register.
    expect(loser!.reason).toMatchObject({ code: "join_request.not_found" });

    const { rows: deviceRows } = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from devices
      where id = ${made.joinId}
    `);
    expect(deviceRows[0]!.n).toBe(1);
    // No orphan register from the loser: exactly the one the winner's accept created.
    const { rows: tillRows } = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from tills
      where name = 'Till racer'
    `);
    expect(tillRows[0]!.n).toBe(1);
  });
});

describe("denyJoinRequest", () => {
  it("deletes the request, and the joiner reads not_approved", async () => {
    const venue = await setupVenue(suite.db);
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    await withTransaction(suite.db, async (tx) => {
      await denyJoinRequest(tx, venue.cfg, made.joinId);
    });
    await withTransaction(suite.db, async (tx) => {
      expect(await readJoinStatus(tx, venue.cfg, made.joinId, made.token)).toBe("not_approved");
    });
  });

  it("throws join_request.not_found for an unknown id", async () => {
    const venueA = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await expect(
        denyJoinRequest(tx, venueA.cfg, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
  });

  it("returns the kind it deleted, so the shared route can authorize against it", async () => {
    const venue = await setupVenue(suite.db);
    const madeDevice = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    const madeAgent = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "a" });
    });
    await withTransaction(suite.db, async (tx) => {
      expect(await denyJoinRequest(tx, venue.cfg, madeDevice.joinId)).toBe("device");
      expect(await denyJoinRequest(tx, venue.cfg, madeAgent.joinId)).toBe("print_agent");
    });
  });
});

describe("acceptPrintAgentJoinRequest", () => {
  it("a right choice inserts a print_agents row (id = joinId, name = label, token carried) and deletes the request", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const made = await asApp(cfg, (tx) =>
      createJoinRequest(tx, cfg, { kind: "print_agent", label: "kitchen-pi" }),
    );
    const result = await asApp(cfg, (tx) =>
      acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
    );
    expect(result).toEqual({ ok: true, agentId: made.joinId, name: "kitchen-pi" });

    const [agent] = await asApp(cfg, (tx) =>
      tx.select().from(printAgents).where(eq(printAgents.id, made.joinId)),
    );
    expect(agent).toMatchObject({ id: made.joinId, name: "kitchen-pi", active: true });
    // At the VERB layer `token` IS the bare secret (createJoinRequest returns it un-composed);
    // print_agents.token_hash was copied from the request, so verifySecret(secret, hash) holds. The
    // route composes `${joinId}.${secret}` — that composition is Task 6's concern, not this one.
    expect(verifySecret(made.token, agent!.tokenHash)).toBe(true);

    const gone = await asApp(cfg, (tx) =>
      tx.select().from(joinRequests).where(eq(joinRequests.id, made.joinId)),
    );
    expect(gone).toHaveLength(0);
  });

  it("a wrong choice returns mismatch, consumes the request (single-use), inserts no agent", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const made = await asApp(cfg, (tx) =>
      createJoinRequest(tx, cfg, { kind: "print_agent", label: "x" }),
    );
    const wrong = String((Number(made.verificationNumber) + 1) % 100).padStart(2, "0");
    // A SEPARATE transaction from the retry below: a wrong choice must COMMIT the consuming delete
    // (an AppError would roll it back into an unlimited retry — accept's header), so the single-use
    // property is only observable across transaction boundaries.
    expect(
      await asApp(cfg, (tx) =>
        acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: wrong }),
      ),
    ).toEqual({ ok: false, reason: "mismatch" });
    const agents = await asApp(cfg, (tx) =>
      tx.select().from(printAgents).where(eq(printAgents.id, made.joinId)),
    );
    expect(agents).toHaveLength(0);
    // consumed: a retry with the RIGHT choice is now not_found.
    expect(
      await codeOf(() =>
        asApp(cfg, (tx) =>
          acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
        ),
      ),
    ).toBe("join_request.not_found");
  });

  it("refuses a device request 404 (kind predicate rides the delete)", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const made = await asApp(cfg, (tx) =>
      createJoinRequest(tx, cfg, { kind: "device", label: "d" }),
    );
    expect(
      await codeOf(() =>
        asApp(cfg, (tx) => acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: "00" })),
      ),
    ).toBe("join_request.not_found");
  });
});

describe("readAgentJoinStatus", () => {
  it("pending before accept, approved after, and not_approved for a wrong token or unknown id", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    // `token` is the bare secret at the verb layer (see acceptPrintAgentJoinRequest's test); the route
    // splits the Bearer and hands readAgentJoinStatus the secret, so pass `token` directly here.
    const made = await asApp(cfg, (tx) =>
      createJoinRequest(tx, cfg, { kind: "print_agent", label: "a" }),
    );
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, made.joinId, made.token))).toBe(
      "pending",
    );
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, made.joinId, "wrong"))).toBe(
      "not_approved",
    );
    await asApp(cfg, (tx) =>
      acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
    );
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, made.joinId, made.token))).toBe(
      "approved",
    );
    expect(await asApp(cfg, (tx) => readAgentJoinStatus(tx, cfg, randomUUID(), made.token))).toBe(
      "not_approved",
    );
  });
});

describe("selfEnrolNodeAgent", () => {
  it("mints one agent per node whose token authenticates", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const nodeId = randomUUID();
    const { agentId, token } = await asApp(cfg, (tx) =>
      selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }),
    );
    // The token is the accept-shape `${id}.${secret}` and authenticates as this agent.
    const auth = await asApp(cfg, (tx) => authenticateAgent(tx, token));
    expect(auth.agentId).toBe(agentId);
  });

  it("is idempotent per node: a second call refreshes the token, keeps one row and the same id", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const nodeId = randomUUID();
    const first = await asApp(cfg, (tx) => selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }));
    const second = await asApp(cfg, (tx) =>
      selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box again" }),
    );
    expect(second.agentId).toBe(first.agentId); // stable id → printer bindings survive
    expect(second.token).not.toBe(first.token); // fresh secret

    const rows = await asApp(cfg, (tx) =>
      tx.select().from(printAgents).where(eq(printAgents.nodeId, nodeId)),
    );
    expect(rows).toHaveLength(1);

    // The old token no longer authenticates; the new one does, as the same agent.
    await expect(asApp(cfg, (tx) => authenticateAgent(tx, first.token))).rejects.toThrow(
      /unauthorized/,
    );
    expect((await asApp(cfg, (tx) => authenticateAgent(tx, second.token))).agentId).toBe(
      first.agentId,
    );
  });

  it("refuses a revoked node's re-enrol with device.join_revoked and does NOT reactivate it", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const nodeId = randomUUID();
    const { agentId } = await asApp(cfg, (tx) =>
      selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }),
    );
    // Revoke it (active := false), the deliberate revoke self-enrol must not silently undo.
    await suite.db.execute(sql`update print_agents set active = false where id = ${agentId}`);

    expect(
      await codeOf(() => asApp(cfg, (tx) => selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }))),
    ).toBe("device.join_revoked");

    // Through the table definition: a raw read skips drizzle's decoding and hands this boolean
    // column back as SQLite's 0/1, which no `toBe(false)` could ever match.
    const [{ active }] = await suite.db
      .select({ active: printAgents.active })
      .from(printAgents)
      .where(eq(printAgents.id, agentId));
    expect(active).toBe(false);
  });
});
