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
  checkDeviceJoinNumber,
  createJoinRequest,
  denyJoinRequest,
  findJoinRequest,
  listPendingJoinRequests,
  provenDisabledDevice,
  readAgentJoinStatus,
  readJoinStatus,
  returningDevicesOf,
  selfEnrolNodeAgent,
} from "./join-requests.js";
import { createPairingMode, type PairingMode } from "./pairing-mode.js";
import { parseDeviceCookie } from "./device-session.js";
import {
  deviceProfiles,
  devices,
  joinRequests,
  printAgents,
  printers,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { verifySecretAsync } from "@waitron/identity";
import { setProfilePrinterLists } from "@waitron/layouts";
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

/** On the next turn of the event loop, commit a write transaction and record "writer" once it has. */
function writeOnNextTurn(order: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      withTransaction(suite.db, (tx) => tx.execute(sql`select 1`))
        .then(() => {
          order.push("writer");
          resolve();
        })
        .catch(reject);
    });
  });
}

/** A window opened now. A device request made AFTER this call reads as pending; one made before it
 * is discarded by the next status read. */
function openWindow(now?: () => number): PairingMode {
  const window = createPairingMode(now === undefined ? {} : { now });
  window.open();
  return window;
}

type Accepted = Awaited<ReturnType<typeof acceptDeviceJoinRequest>>;

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
    const window = openWindow();
    const device = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" }),
    );
    const agent = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "kitchen-pi" }),
    );

    expect(await readJoinStatus(suite.db, venue.cfg, device.joinId, device.token, window)).toBe(
      "pending",
    );
    expect(await readJoinStatus(suite.db, otherNode, device.joinId, device.token, window)).toBe(
      "not_approved",
    );
    expect(await readAgentJoinStatus(suite.db, venue.cfg, agent.joinId, agent.token)).toBe(
      "pending",
    );
    expect(await readAgentJoinStatus(suite.db, otherNode, agent.joinId, agent.token)).toBe(
      "not_approved",
    );
    expect(await asApp((tx) => findJoinRequest(tx, venue.cfg, device.joinId))).toEqual({
      kind: "device",
      createdAt: device.createdAt,
    });
    expect(await asApp((tx) => findJoinRequest(tx, otherNode, device.joinId))).toBeUndefined();
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
          acceptDeviceJoinRequest(tx, otherNode, device.joinId, { label: "Bar till", profileId }),
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
    const window = openWindow();
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
    });
    const status = await readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, window);
    expect(status).toBe("pending");
  });

  it("is not_approved for a wrong token on a live request", async () => {
    const venue = await setupVenue(suite.db);
    const window = openWindow();
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
    });
    const status = await readJoinStatus(suite.db, venue.cfg, made.joinId, "wrong-token", window);
    expect(status).toBe("not_approved");
  });

  it("is not_approved for an id that never existed", async () => {
    const venue = await setupVenue(suite.db);
    const status = await readJoinStatus(
      suite.db,
      venue.cfg,
      "00000000-0000-4000-8000-000000000000",
      "irrelevant-token",
      openWindow(),
    );
    expect(status).toBe("not_approved");
  });

  it("is not_approved once the request has lapsed", async () => {
    const venue = await setupVenue(suite.db);
    // Opened before the back-dated request, so only the fifteen-minute limit can end it.
    const window = openWindow(() => Date.now() - JOIN_TTL_MS - 120_000);
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
    });
    // A fixture back-date, for the reason the sweep case above states.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.db.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${made.joinId}`,
    );
    const status = await readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, window);
    expect(status).toBe("not_approved");
  });
  it("lets another writer commit while it derives the key", async () => {
    const venue = await setupVenue(suite.db);
    const window = openWindow();
    const made = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" }),
    );
    const order: string[] = [];
    const read = readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, window).then(
      (status) => order.push(status),
    );
    await Promise.all([read, writeOnNextTurn(order)]);
    expect(order).toEqual(["writer", "pending"]);
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
    const { made, accepted } = await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const accepted = await acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
        label: "Barra 1",
        profileId,
      });
      return { made, accepted };
    });
    const status = await readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, openWindow());
    expect(accepted).toEqual({ deviceId: made.joinId, name: "Barra 1", formFactor: "till" });
    expect(status).toBe("approved");
  });

  it("starts the device on the first printer of each of its profile's lists", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const [p1, p2, p3] = await suite.db
      .insert(printers)
      .values(
        ["Bar", "Counter", "Portable"].map((name) => ({
          locationId: venue.cfg.locationId,
          name,
          transport: "network_tcp" as const,
          host: "10.0.0.5",
        })),
      )
      .returning({ id: printers.id });
    const accepted = await withTransaction(suite.db, async (tx) => {
      await setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [p2!.id, p1!.id],
        paymentSlipPrinterIds: [p3!.id],
      });
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { label: "Bar till", profileId });
    });
    const [row] = await suite.db
      .select({
        receiptPrinterId: devices.receiptPrinterId,
        paymentSlipPrinterId: devices.paymentSlipPrinterId,
      })
      .from(devices)
      .where(eq(devices.id, accepted.deviceId));
    expect(row).toEqual({ receiptPrinterId: p2!.id, paymentSlipPrinterId: p3!.id });
  });

  it("rolls the consumption back when the device insert fails", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const window = openWindow();
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Blocked till" });
    });
    // Plant a devices row under the request's OWN id first: acceptDeviceJoinRequest reuses that id, so
    // its device INSERT collides on the primary key after the request has been consumed.
    await suite.db.insert(devices).values({
      id: made.joinId,
      locationId: venue.cfg.locationId,
      deviceProfileId: profileId,
      label: "blocker",
      tokenHash: "x",
      active: true,
    });
    await expect(
      withTransaction(suite.db, async (tx) => {
        return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          label: "Blocked till",
          profileId,
        });
      }),
    ).rejects.toThrow();
    // The consuming delete rides the SAME transaction as the device insert (accept's header
    // comment) — a genuine retry must still find the request PENDING, not gone, once the blocker
    // device row (a fixture artefact, not a real collision) is cleared.
    await suite.db.execute(sql`delete from devices where id = ${made.joinId}`);
    expect(await readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, window)).toBe(
      "pending",
    );
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
        acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { label: "Kitchen box", profileId }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
  });

  it("two concurrent accepts of ONE request: exactly one wins, the loser gets join_request.not_found, and one devices row is written", async () => {
    const venue = await setupVenue(suite.db);
    // A `kds` profile bound to an EXISTING station, so resolveDeviceBinding writes nothing and the
    // one write both racers contend for is the `devices` INSERT that reuses the request's id.
    const profileId = await seedProfile("kds");
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Racer" });
    });

    // The write queue runs the two one after the other, so the second reads the request GONE.
    const attempt = (db: Database): Promise<Accepted> =>
      withTransaction(db, async (tx) => {
        return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          label: "Racer",
          profileId,
          stationId: venue.defaultStationId,
        });
      });

    const outcomes = await Promise.allSettled([attempt(suite.db), attempt(suite.db)]);
    const winner = outcomes.find(
      (o): o is PromiseFulfilledResult<Accepted> => o.status === "fulfilled",
    );
    const loser = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(winner!.value).toMatchObject({ deviceId: made.joinId });
    // The loser must see the clean domain code, never a raw primary-key violation on `devices`.
    expect(loser!.reason).toMatchObject({ code: "join_request.not_found" });

    const { rows } = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from devices
      where id = ${made.joinId}
    `);
    expect(rows[0]!.n).toBe(1);
  });

  it("two concurrent accepts of a TILL profile: exactly one wins, the loser never reaches the device insert", async () => {
    const venue = await setupVenue(suite.db);
    // A loser that reached the device INSERT would fail on the primary key or the device name, the
    // wrong code; delete-first must stop the loser before it writes anything at all.
    const profileId = await seedProfile("till");
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Till racer" });
    });

    const attempt = (db: Database): Promise<Accepted> =>
      withTransaction(db, async (tx) => {
        return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          label: "Till racer",
          profileId,
        });
      });

    const outcomes = await Promise.allSettled([attempt(suite.db), attempt(suite.db)]);
    const winner = outcomes.find(
      (o): o is PromiseFulfilledResult<Accepted> => o.status === "fulfilled",
    );
    const loser = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(winner!.value).toMatchObject({ deviceId: made.joinId });
    expect(loser!.reason).toMatchObject({ code: "join_request.not_found" });

    const { rows: deviceRows } = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from devices
      where id = ${made.joinId}
    `);
    expect(deviceRows[0]!.n).toBe(1);
  });
});

describe("a returning disabled device", () => {
  /** A till enrolled through create and accept under `profileId`, then disabled. */
  async function disabledDevice(venue: { cfg: TillConfig }, profileId: string) {
    const made = await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      await acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { label: "Bar till", profileId });
      return made;
    });
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, made.joinId));
    return made.joinId;
  }

  async function pendingRows(): Promise<number> {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from join_requests`,
    );
    return rows[0]!.n;
  }

  /** As the knock route calls it: on the cookie as parsed. */
  const proven = (cookie: string | null) =>
    provenDisabledDevice(suite.db, parseDeviceCookie(cookie));

  async function storedHash(deviceId: string): Promise<string> {
    const [row] = await suite.db
      .select({ tokenHash: devices.tokenHash })
      .from(devices)
      .where(eq(devices.id, deviceId));
    return row!.tokenHash;
  }

  async function comeBack(
    venue: { cfg: TillConfig },
    deviceId: string,
    input: { label: string; profileId: string },
  ): Promise<Accepted> {
    const tokenHash = await storedHash(deviceId);
    return withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Tablet",
        returning: { deviceId, tokenHash },
      });
      expect(made.joinId).toBe(deviceId);
      return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, input);
    });
  }

  it("keeps the printers it held under the same profile, and takes the new profile's first under another", async () => {
    const venue = await setupVenue(suite.db);
    const [p1, p2, p3] = await suite.db
      .insert(printers)
      .values(
        ["Bar", "Counter", "Portable"].map((name) => ({
          locationId: venue.cfg.locationId,
          name,
          transport: "network_tcp" as const,
          host: "10.0.0.5",
        })),
      )
      .returning({ id: printers.id });
    const same = await seedProfile("till");
    const other = await seedProfile("till");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, same, { receiptPrinterIds: [p1!.id], paymentSlipPrinterIds: [] }),
    );
    const deviceId = await disabledDevice(venue, same);
    // The profile's first printer is no longer the one the device holds.
    await withTransaction(suite.db, async (tx) => {
      await setProfilePrinterLists(tx, same, {
        receiptPrinterIds: [p3!.id, p1!.id],
        paymentSlipPrinterIds: [],
      });
      await setProfilePrinterLists(tx, other, {
        receiptPrinterIds: [p2!.id],
        paymentSlipPrinterIds: [p3!.id],
      });
    });
    const printersOf = async () =>
      (
        await suite.db
          .select({
            receiptPrinterId: devices.receiptPrinterId,
            paymentSlipPrinterId: devices.paymentSlipPrinterId,
          })
          .from(devices)
          .where(eq(devices.id, deviceId))
      )[0];

    await comeBack(venue, deviceId, { label: "Bar till", profileId: same });
    expect(await printersOf()).toEqual({ receiptPrinterId: p1!.id, paymentSlipPrinterId: null });

    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    await comeBack(venue, deviceId, { label: "Bar till", profileId: other });
    expect(await printersOf()).toEqual({ receiptPrinterId: p2!.id, paymentSlipPrinterId: p3!.id });
  });

  it("binds the kitchen screen it comes back as to the station the accept names", async () => {
    const venue = await setupVenue(suite.db);
    const till = await seedProfile("till");
    const kds = await seedProfile("kds");
    const deviceId = await disabledDevice(venue, till);
    const accepted = await comeBack(venue, deviceId, { label: "Pase", profileId: kds }).catch(
      (e: unknown) => e,
    );
    expect(accepted).toMatchObject({ code: "device.station_required" });

    const tokenHash = await storedHash(deviceId);
    await withTransaction(suite.db, async (tx) => {
      await createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Pase",
        returning: { deviceId, tokenHash },
      });
      await acceptDeviceJoinRequest(tx, venue.cfg, deviceId, {
        label: "Pase",
        profileId: kds,
        stationId: venue.defaultStationId,
      });
    });
    const [row] = await suite.db
      .select({ active: devices.active, stationId: devices.stationId, label: devices.label })
      .from(devices)
      .where(eq(devices.id, deviceId));
    expect(row).toEqual({ active: true, stationId: venue.defaultStationId, label: "Pase" });
  });

  it("refuses device.join_stale when the hash it was proven against has changed since", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const deviceId = await disabledDevice(venue, profileId);
    const before = await storedHash(deviceId);
    const code = await codeOf(() =>
      withTransaction(suite.db, (tx) =>
        createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: "Tablet",
          returning: { deviceId, tokenHash: "a hash the row no longer holds" },
        }),
      ),
    );
    expect(code).toBe("device.join_stale");
    expect(await storedHash(deviceId)).toBe(before);
    expect(await pendingRows()).toBe(0);
  });

  it("refuses device.join_stale when the device has been enabled since", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const deviceId = await disabledDevice(venue, profileId);
    const tokenHash = await storedHash(deviceId);
    await suite.db.update(devices).set({ active: true }).where(eq(devices.id, deviceId));
    const code = await codeOf(() =>
      withTransaction(suite.db, (tx) =>
        createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: "Tablet",
          returning: { deviceId, tokenHash },
        }),
      ),
    );
    expect(code).toBe("device.join_stale");
    expect(await storedHash(deviceId)).toBe(tokenHash);
    expect(await pendingRows()).toBe(0);
  });

  it("takes the printers of a new profile at the device's own location, not the request's", async () => {
    const venue = await setupVenue(suite.db);
    const [printer] = await suite.db
      .insert(printers)
      .values({
        locationId: venue.cfg.locationId,
        name: "Bar",
        transport: "network_tcp" as const,
        host: "10.0.0.5",
      })
      .returning({ id: printers.id });
    const first = await seedProfile("till");
    const other = await seedProfile("till");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, other, {
        receiptPrinterIds: [printer!.id],
        paymentSlipPrinterIds: [],
      }),
    );
    const deviceId = await disabledDevice(venue, first);
    const tokenHash = await storedHash(deviceId);
    await withTransaction(suite.db, async (tx) => {
      await createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Tablet",
        returning: { deviceId, tokenHash },
      });
      // A request's location is the node's configured one; the device keeps the row's own.
      await tx
        .update(joinRequests)
        .set({ locationId: randomUUID() })
        .where(eq(joinRequests.id, deviceId));
      await acceptDeviceJoinRequest(tx, venue.cfg, deviceId, {
        label: "Bar till",
        profileId: other,
      });
    });
    const [row] = await suite.db
      .select({ receiptPrinterId: devices.receiptPrinterId, locationId: devices.locationId })
      .from(devices)
      .where(eq(devices.id, deviceId));
    expect(row).toEqual({ receiptPrinterId: printer!.id, locationId: venue.cfg.locationId });
  });

  it("does not mark a request returning when an ACTIVE device has its id", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const made = await withTransaction(suite.db, (tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" }),
    );
    await suite.db.insert(devices).values({
      id: made.joinId,
      locationId: venue.cfg.locationId,
      deviceProfileId: profileId,
      label: "Same id",
      tokenHash: "x",
      active: true,
    });
    const returning = await withTransaction(suite.db, (tx) =>
      returningDevicesOf(tx, [made.joinId]),
    );
    expect([...returning.keys()]).toEqual([]);
    // The other direction: the same row disabled is marked.
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, made.joinId));
    const disabled = await withTransaction(suite.db, (tx) => returningDevicesOf(tx, [made.joinId]));
    expect([...disabled.keys()]).toEqual([made.joinId]);
  });

  it("stores the new request's token on the disabled row, so the browser holding it is still proven after a deny", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const deviceId = await disabledDevice(venue, profileId);
    const made = await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Tablet",
        returning: { deviceId, tokenHash: await storedHash(deviceId) },
      });
      await denyJoinRequest(tx, venue.cfg, made.joinId);
      return made;
    });
    expect(await verifySecretAsync(made.token, await storedHash(deviceId))).toBe(true);
    expect(await proven(`${deviceId}.${made.token}`)).toEqual({
      deviceId,
      tokenHash: await storedHash(deviceId),
    });
  });

  it("enables the device with the request's token, whatever hash the row holds by then", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const deviceId = await disabledDevice(venue, profileId);
    const made = await withTransaction(suite.db, async (tx) =>
      createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Tablet",
        returning: { deviceId, tokenHash: await storedHash(deviceId) },
      }),
    );
    await suite.db.update(devices).set({ tokenHash: "x" }).where(eq(devices.id, deviceId));
    await withTransaction(suite.db, (tx) =>
      acceptDeviceJoinRequest(tx, venue.cfg, deviceId, { label: "Bar till", profileId }),
    );
    expect(await readJoinStatus(suite.db, venue.cfg, deviceId, made.token, openWindow())).toBe(
      "approved",
    );
  });

  it("proves a cookie only for a disabled device whose token it holds", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const made = await withTransaction(suite.db, async (tx) => {
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      await acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { label: "Bar till", profileId });
      return made;
    });
    const cookie = `${made.joinId}.${made.token}`;
    expect(await proven(cookie)).toBeNull();
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, made.joinId));
    expect(await proven(cookie)).toEqual({
      deviceId: made.joinId,
      tokenHash: await storedHash(made.joinId),
    });
    expect(await proven(`${made.joinId}.wrong`)).toBeNull();
    expect(await proven(`${randomUUID()}.${made.token}`)).toBeNull();
    expect(await proven(null)).toBeNull();
    expect(await proven("no-dot")).toBeNull();
    expect(await proven(`not-a-uuid.${made.token}`)).toBeNull();
  });
});

describe("checkDeviceJoinNumber", () => {
  it("DENIES on a wrong choice, and the deny SURVIVES THE TRANSACTION", async () => {
    const venue = await setupVenue(suite.db);
    const profileId = await seedProfile("till");
    const window = openWindow();
    // Two SEPARATE withTransaction blocks on purpose. A single block that catches the rejection inside
    // itself never commits or rolls anything back, so it would pass against code that throws from
    // inside the transaction and loses the DELETE — the defect this test exists to catch.
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    const wrong = made.verificationNumber === "00" ? "01" : "00";
    const refused = await withTransaction(suite.db, async (tx) => {
      return checkDeviceJoinNumber(
        tx,
        venue.cfg,
        { id: made.joinId, createdAt: made.createdAt },
        wrong,
      );
    });
    expect(refused).toEqual({ ok: false });
    // Gone AFTER the transaction committed — this is what makes one-in-three an acceptable guess rate.
    await withTransaction(suite.db, async (tx) => {
      await expect(
        checkDeviceJoinNumber(
          tx,
          venue.cfg,
          { id: made.joinId, createdAt: made.createdAt },
          made.verificationNumber,
        ),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
      await expect(
        acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { label: "d", profileId }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
    expect(await readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, window)).toBe(
      "not_approved",
    );
  });

  it("a right choice answers ok and leaves the request pending", async () => {
    const venue = await setupVenue(suite.db);
    const window = openWindow();
    const made = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" }),
    );
    expect(
      await asApp((tx) =>
        checkDeviceJoinNumber(
          tx,
          venue.cfg,
          { id: made.joinId, createdAt: made.createdAt },
          made.verificationNumber,
        ),
      ),
    ).toEqual({ ok: true });
    expect(await readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, window)).toBe(
      "pending",
    );
  });

  it("refuses a print agent's request, which survives a wrong choice", async () => {
    const venue = await setupVenue(suite.db);
    const made = await asApp((tx) =>
      createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "a" }),
    );
    const wrong = made.verificationNumber === "00" ? "01" : "00";
    expect(
      await codeOf(() =>
        asApp((tx) =>
          checkDeviceJoinNumber(
            tx,
            venue.cfg,
            { id: made.joinId, createdAt: made.createdAt },
            wrong,
          ),
        ),
      ),
    ).toBe("join_request.not_found");
    expect(await readAgentJoinStatus(suite.db, venue.cfg, made.joinId, made.token)).toBe("pending");
  });
});

describe("denyJoinRequest", () => {
  it("deletes the request, and the joiner reads not_approved", async () => {
    const venue = await setupVenue(suite.db);
    const window = openWindow();
    const made = await withTransaction(suite.db, async (tx) => {
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    await withTransaction(suite.db, async (tx) => {
      await denyJoinRequest(tx, venue.cfg, made.joinId);
    });
    expect(await readJoinStatus(suite.db, venue.cfg, made.joinId, made.token, window)).toBe(
      "not_approved",
    );
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
    expect(await verifySecretAsync(made.token, agent!.tokenHash)).toBe(true);

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
    expect(await readAgentJoinStatus(suite.db, cfg, made.joinId, made.token)).toBe("pending");
    expect(await readAgentJoinStatus(suite.db, cfg, made.joinId, "wrong")).toBe("not_approved");
    await asApp((tx) =>
      acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
    );
    expect(await readAgentJoinStatus(suite.db, cfg, made.joinId, made.token)).toBe("approved");
    expect(await readAgentJoinStatus(suite.db, cfg, randomUUID(), made.token)).toBe("not_approved");
  });
  it("lets another writer commit while it derives the key", async () => {
    const cfg = (await setupVenue(suite.db)).cfg;
    const made = await asApp((tx) =>
      createJoinRequest(tx, cfg, { kind: "print_agent", label: "a" }),
    );
    await asApp((tx) =>
      acceptPrintAgentJoinRequest(tx, cfg, made.joinId, { choice: made.verificationNumber }),
    );
    const order: string[] = [];
    const read = readAgentJoinStatus(suite.db, cfg, made.joinId, made.token).then((status) =>
      order.push(status),
    );
    await Promise.all([read, writeOnNextTurn(order)]);
    expect(order).toEqual(["writer", "approved"]);
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
    const auth = await authenticateAgent(suite.db, token);
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
    await expect(authenticateAgent(suite.db, first.token)).rejects.toThrow(/unauthorized/);
    expect((await authenticateAgent(suite.db, second.token)).agentId).toBe(first.agentId);
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
