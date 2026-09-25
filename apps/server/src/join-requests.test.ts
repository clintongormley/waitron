/**
 * The join-request verbs — mint, cap, sweep, challenge, accept, deny, self-enrol.
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
  joinRequestKind,
  listPendingJoinRequests,
  readAgentJoinStatus,
  readJoinStatus,
  selfEnrolNodeAgent,
  type AcceptResult,
} from "./join-requests.js";
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
import { nodeId as brandNodeId } from "@waitron/shared";
import { setupVenue } from "./testing/venue-fixtures.js";
import type { TillConfig } from "./till-config.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let profileCounter = 0;
async function seedProfile(
  formFactor: "till" | "kds" | "phone-portrait" | "tablet-landscape",
): Promise<string> {
  profileCounter += 1;
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${profileCounter}`, formFactor, capabilities: [] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, async (tx) => {
    return fn(tx);
  });
}

async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe("pending joins belong to the node that received them", () => {
  it("does not list or challenge another node's pending request", async () => {
    const venue = await setupVenue(suite.db);
    const otherNode: TillConfig = { ...venue.cfg, nodeId: brandNodeId(randomUUID()) };
    const made = await withTransaction(suite.db, (tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" }),
    );

    const here = await withTransaction(suite.db, (tx) =>
      listPendingJoinRequests(tx, venue.cfg, "device"),
    );
    const there = await withTransaction(suite.db, (tx) =>
      listPendingJoinRequests(tx, otherNode, "device"),
    );
    expect(here.map((r) => r.id)).toContain(made.joinId);
    expect(there.map((r) => r.id)).not.toContain(made.joinId);
    expect(
      await codeOf(() =>
        withTransaction(suite.db, (tx) => challengeFor(tx, otherNode, made.joinId)),
      ),
    ).toBe("join_request.not_found");
  });

  it("tells another node's poller not_approved, and reads no kind for it", async () => {
    const venue = await setupVenue(suite.db);
    const otherNode: TillConfig = { ...venue.cfg, nodeId: brandNodeId(randomUUID()) };
    const device = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" }),
    );
    const agent = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "kitchen-pi" }),
    );

    expect(await asApp((tx) => readJoinStatus(tx, venue.cfg, device.joinId, device.token))).toBe(
      "pending",
    );
    expect(await asApp((tx) => readJoinStatus(tx, otherNode, device.joinId, device.token))).toBe(
      "not_approved",
    );
    expect(await asApp((tx) => readAgentJoinStatus(tx, venue.cfg, agent.joinId, agent.token))).toBe(
      "pending",
    );
    expect(await asApp((tx) => readAgentJoinStatus(tx, otherNode, agent.joinId, agent.token))).toBe(
      "not_approved",
    );
    expect(await asApp((tx) => joinRequestKind(tx, venue.cfg, device.joinId))).toBe("device");
    expect(await asApp((tx) => joinRequestKind(tx, otherNode, device.joinId))).toBeUndefined();
  });

  it("does not let another node accept a pending request, of either kind", async () => {
    const venue = await setupVenue(suite.db);
    const otherNode: TillConfig = { ...venue.cfg, nodeId: brandNodeId(randomUUID()) };
    const profileId = await seedProfile("till");
    const device = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" }),
    );
    const agent = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "kitchen-pi" }),
    );

    expect(
      await codeOf(() =>
        asApp((tx) =>
          acceptDeviceJoinRequest(tx, otherNode, device.joinId, {
            choice: device.verificationNumber,
            profileId,
          }),
        ),
      ),
    ).toBe("join_request.not_found");
    expect(
      await codeOf(() =>
        asApp((tx) =>
          acceptPrintAgentJoinRequest(tx, otherNode, agent.joinId, {
            choice: agent.verificationNumber,
          }),
        ),
      ),
    ).toBe("join_request.not_found");
    // Both requests are still pending for the node that received them.
    const still = await asApp((tx) => tx.select({ id: joinRequests.id }).from(joinRequests));
    expect(still.map((r) => r.id).sort()).toEqual([device.joinId, agent.joinId].sort());
  });

  it("counts neither the cap nor the spoken-for numbers across nodes", async () => {
    const venue = await setupVenue(suite.db);
    const otherNode: TillConfig = { ...venue.cfg, nodeId: brandNodeId(randomUUID()) };
    const always47 = () => 47;
    await asApp(async (tx) => {
      await createJoinRequest(tx, otherNode, { kind: "device", label: "d0", numbers: always47 });
      for (let i = 1; i < PENDING_CAP; i++) {
        await createJoinRequest(tx, otherNode, { kind: "device", label: `d${i}` });
      }
    });

    // The other node is at the cap and holds 47, and neither is this node's concern.
    const mine = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "mine", numbers: always47 }),
    );
    expect(mine.verificationNumber).toBe("47");
  });

  it("leaves another node's lapsed request for that node to sweep", async () => {
    const venue = await setupVenue(suite.db);
    const otherNode: TillConfig = { ...venue.cfg, nodeId: brandNodeId(randomUUID()) };
    const theirs = await asApp((tx) =>
      createJoinRequest(tx, otherNode, { kind: "device", label: "theirs" }),
    );
    // A fixture back-date, for the reason the sweep case under `createJoinRequest` states.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.db.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${theirs.joinId}`,
    );

    await asApp((tx) => listPendingJoinRequests(tx, venue.cfg, "device"));
    const rows = await asApp((tx) =>
      tx
        .select({ id: joinRequests.id })
        .from(joinRequests)
        .where(eq(joinRequests.id, theirs.joinId)),
    );
    expect(rows).toHaveLength(1);
  });
});

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
    // The first request's two DECOYS are random and ALSO spoken for, so the fallback must avoid
    // them: a generator yielding only blocked numbers starves the pick loop into `device.join_full`.
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
    // Seeded directly: decoys are not injectable, so this is the only way to pin one. The seeded
    // row's own REAL number is 77, not 13, or a broken "real avoids existing reals" rule would make
    // this pass for the wrong reason.
    await suite.db.insert(joinRequests).values({
      nodeId: venue.cfg.nodeId,
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
    // per-KIND cap never trips on them while they still count toward this request's forbidden set.
    // "00" and "01" are the only two values left free.
    await suite.db.insert(joinRequests).values(
      Array.from({ length: 98 }, (_, i) => i + 2).map((n) => ({
        nodeId: venue.cfg.nodeId,
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
    // A fixture back-date, written straight to the column: no verb ages a request.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.db.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${stale.joinId}`,
    );
    await withTransaction(suite.db, async (tx) => {
      await createJoinRequest(tx, venue.cfg, { kind: "device", label: "fresh" });
      // Unscoped on purpose: `useVenueDb` empties the data tables after each test, so `["fresh"]` is
      // an exact list and the lapsed row is GONE, not merely unreturned.
      const { rows } = await tx.execute<{ label: string }>(sql`select label from join_requests `);
      expect(rows.map((r) => r.label)).toEqual(["fresh"]);
    });
  });
});

describe("createJoinRequest — serialization of number allocation and the cap on the file", () => {
  // Both creators start together on the one handle; `withTransaction` runs each inside
  // `db.withWriteLock` (`packages/db/src/tenancy.ts`), so the second always reads the first's
  // committed row. These cases pin the outcome under that queue, not a guard inside
  // `createJoinRequest`.

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

    // Through the table definition, so `decoy_numbers` arrives decoded: a raw read returns the JSON
    // text, and the decoy loop below would pass vacuously over its characters.
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
        nodeId: venue.cfg.nodeId,
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
    // A fixture back-date, for the reason the sweep case above states.
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
    // auto-created the till-form-factor register. The binding trigger demands a till_id for this
    // profile's form factor, so the blocker borrows the venue's own provisioned register.
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
    // A `kds` profile bound to an EXISTING station, so resolveDeviceBinding writes nothing and the
    // one write both racers contend for is the `devices` INSERT that reuses the request's id.
    const profileId = await seedProfile("kds");
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Racer" });
    });

    // The write queue runs the two one after the other, so the second reads the request GONE.
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
    // The loser must see the clean domain code, never a raw primary-key violation on `devices`.
    expect(loser!.reason).toMatchObject({ code: "join_request.not_found" });

    const { rows } = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from devices
      where id = ${made.joinId}
    `);
    expect(rows[0]!.n).toBe(1);
  });

  it("two concurrent accepts of a TILL profile: exactly one wins, the loser never reaches register creation", async () => {
    const venue = await setupVenue(suite.db);
    // A `till` profile: resolveDeviceBinding WRITES a `tills` row named after the device before the
    // device INSERT. A loser that reached it would fail on `device.register_name_taken`, the wrong
    // code; delete-first must stop the loser before it writes anything at all.
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
    const made = await asApp((tx) =>
      createJoinRequest(tx, cfg, { kind: "print_agent", label: "kitchen-pi" }),
    );
    const result = await asApp((tx) =>
      acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
    );
    expect(result).toEqual({ ok: true, agentId: made.joinId, name: "kitchen-pi" });

    const [agent] = await asApp((tx) =>
      tx.select().from(printAgents).where(eq(printAgents.id, made.joinId)),
    );
    expect(agent).toMatchObject({ id: made.joinId, name: "kitchen-pi", active: true });
    // At the VERB layer `token` IS the bare secret; the route composes `${joinId}.${secret}`.
    expect(verifySecret(made.token, agent!.tokenHash)).toBe(true);

    const gone = await asApp((tx) =>
      tx.select().from(joinRequests).where(eq(joinRequests.id, made.joinId)),
    );
    expect(gone).toHaveLength(0);
  });

  it("a wrong choice returns mismatch, consumes the request (single-use), inserts no agent", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const made = await asApp((tx) =>
      createJoinRequest(tx, cfg, { kind: "print_agent", label: "x" }),
    );
    const wrong = String((Number(made.verificationNumber) + 1) % 100).padStart(2, "0");
    // A SEPARATE transaction from the retry below: a wrong choice must COMMIT the consuming delete
    // (an AppError would roll it back into an unlimited retry — accept's header), so the single-use
    // property is only observable across transaction boundaries.
    expect(
      await asApp((tx) => acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: wrong })),
    ).toEqual({ ok: false, reason: "mismatch" });
    const agents = await asApp((tx) =>
      tx.select().from(printAgents).where(eq(printAgents.id, made.joinId)),
    );
    expect(agents).toHaveLength(0);
    // consumed: a retry with the RIGHT choice is now not_found.
    expect(
      await codeOf(() =>
        asApp((tx) =>
          acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
        ),
      ),
    ).toBe("join_request.not_found");
  });

  it("refuses a device request 404 (kind predicate rides the delete)", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const made = await asApp((tx) => createJoinRequest(tx, cfg, { kind: "device", label: "d" }));
    expect(
      await codeOf(() =>
        asApp((tx) => acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: "00" })),
      ),
    ).toBe("join_request.not_found");
  });
});

describe("readAgentJoinStatus", () => {
  it("pending before accept, approved after, and not_approved for a wrong token or unknown id", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    // `token` is the bare secret at the verb layer (see acceptPrintAgentJoinRequest's test); the route
    // splits the Bearer and hands readAgentJoinStatus the secret, so pass `token` directly here.
    const made = await asApp((tx) =>
      createJoinRequest(tx, cfg, { kind: "print_agent", label: "a" }),
    );
    expect(await asApp((tx) => readAgentJoinStatus(tx, cfg, made.joinId, made.token))).toBe(
      "pending",
    );
    expect(await asApp((tx) => readAgentJoinStatus(tx, cfg, made.joinId, "wrong"))).toBe(
      "not_approved",
    );
    await asApp((tx) =>
      acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
    );
    expect(await asApp((tx) => readAgentJoinStatus(tx, cfg, made.joinId, made.token))).toBe(
      "approved",
    );
    expect(await asApp((tx) => readAgentJoinStatus(tx, cfg, randomUUID(), made.token))).toBe(
      "not_approved",
    );
  });
});

describe("selfEnrolNodeAgent", () => {
  it("mints one agent per node whose token authenticates", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const nodeId = randomUUID();
    const { agentId, token } = await asApp((tx) =>
      selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }),
    );
    // The token is the accept-shape `${id}.${secret}` and authenticates as this agent.
    const auth = await asApp((tx) => authenticateAgent(tx, token));
    expect(auth.agentId).toBe(agentId);
  });

  it("is idempotent per node: a second call refreshes the token, keeps one row and the same id", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const nodeId = randomUUID();
    const first = await asApp((tx) => selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }));
    const second = await asApp((tx) => selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box again" }));
    expect(second.agentId).toBe(first.agentId); // stable id → printer bindings survive
    expect(second.token).not.toBe(first.token); // fresh secret

    const rows = await asApp((tx) =>
      tx.select().from(printAgents).where(eq(printAgents.nodeId, nodeId)),
    );
    expect(rows).toHaveLength(1);

    // The old token no longer authenticates; the new one does, as the same agent.
    await expect(asApp((tx) => authenticateAgent(tx, first.token))).rejects.toThrow(/unauthorized/);
    expect((await asApp((tx) => authenticateAgent(tx, second.token))).agentId).toBe(first.agentId);
  });

  it("refuses a revoked node's re-enrol with device.join_revoked and does NOT reactivate it", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const nodeId = randomUUID();
    const { agentId } = await asApp((tx) => selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }));
    // Revoke it (active := false), the deliberate revoke self-enrol must not silently undo.
    await suite.db.execute(sql`update print_agents set active = false where id = ${agentId}`);

    expect(
      await codeOf(() => asApp((tx) => selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" }))),
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
