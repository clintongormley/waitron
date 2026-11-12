import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { CORE_MIGRATIONS, devices, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  SIGHTING_INTERVAL_MS,
  deviceTokenMatches,
  hashDeviceToken,
  sightingDue,
  signInWithToken,
  staleBefore,
} from "./device-token.js";
import { hashSecret } from "./secret-hash.js";
import { seedSessionDevice } from "../test/fixtures.js";

const suite = useVenueDb({ resetPerTest: false, migrations: [CORE_MIGRATIONS] });

const TOKEN = "k3sN0tGuessable-but-a-test-token-of-43-chars";

describe("hashDeviceToken", () => {
  it("is the SHA-256 hex digest of the token's UTF-8 bytes", () => {
    // `echo -n abc | shasum -a 256`
    expect(hashDeviceToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("deviceTokenMatches", () => {
  it("accepts the token its stored hash was made from", () => {
    expect(deviceTokenMatches(TOKEN, hashDeviceToken(TOKEN))).toBe(true);
  });

  it("refuses another token of the same length", () => {
    const other = TOKEN.slice(0, -1) + "X";
    expect(deviceTokenMatches(other, hashDeviceToken(TOKEN))).toBe(false);
  });

  it("refuses, without throwing, an old scrypt value made from the same token", () => {
    expect(deviceTokenMatches(TOKEN, hashSecret(TOKEN))).toBe(false);
  });

  it("refuses, without throwing, the empty value a deleted device stores", () => {
    expect(deviceTokenMatches(TOKEN, "")).toBe(false);
  });

  it("refuses the stored hash presented as the token", () => {
    expect(deviceTokenMatches(hashDeviceToken(TOKEN), hashDeviceToken(TOKEN))).toBe(false);
  });
});

describe("staleBefore", () => {
  it("is the instant a minute before, in the toISOString spelling", () => {
    expect(staleBefore("2026-11-09T12:00:00.000Z")).toBe("2026-11-09T11:59:00.000Z");
  });
});

describe("sightingDue", () => {
  const seenAt = "2026-11-09T12:00:00.000Z";

  it("is due when nothing is stored", () => {
    expect(sightingDue(null, seenAt)).toBe(true);
  });

  it("is due once the stored sighting is more than a minute old", () => {
    expect(sightingDue("2026-11-09T11:58:59.999Z", seenAt)).toBe(true);
  });

  it("is not due for a sighting exactly a minute old or newer", () => {
    expect(sightingDue("2026-11-09T11:59:00.000Z", seenAt)).toBe(false);
    expect(sightingDue("2026-11-09T11:59:30.000Z", seenAt)).toBe(false);
  });

  it("uses a one-minute interval", () => {
    expect(SIGHTING_INTERVAL_MS).toBe(60_000);
  });
});

type Row = { tokenHash: string; lastSeenAt: string | null; deviceProfileId: string };

async function seed(lastSeenAt: string | null = null): Promise<string> {
  const deviceId = await seedSessionDevice(suite.db);
  await withTransaction(suite.db, (tx) =>
    tx
      .update(devices)
      .set({ tokenHash: hashDeviceToken(TOKEN), lastSeenAt })
      .where(eq(devices.id, deviceId)),
  );
  return deviceId;
}

const readDevice =
  (deviceId: string) =>
  async (on: Database | Transaction): Promise<Row | undefined> => {
    const [row] = await on
      .select({
        tokenHash: devices.tokenHash,
        lastSeenAt: devices.lastSeenAt,
        deviceProfileId: devices.deviceProfileId,
      })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.active, true)));
    return row;
  };

const stamp = (deviceId: string) => async (tx: Transaction, seenAt: string) => {
  await tx.update(devices).set({ lastSeenAt: seenAt }).where(eq(devices.id, deviceId));
};

const commit = (change: Partial<typeof devices.$inferInsert>, deviceId: string) =>
  withTransaction(suite.db, (tx) => tx.update(devices).set(change).where(eq(devices.id, deviceId)));

/** `readDevice`, committing `change` after the read numbered `afterCall` returns its row. */
function readThenCommit(
  deviceId: string,
  afterCall: number,
  change: Partial<typeof devices.$inferInsert>,
) {
  const read = readDevice(deviceId);
  let calls = 0;
  return vi.fn(async (on: Database | Transaction) => {
    calls += 1;
    if (calls === afterCall) {
      const row = await read(on);
      await commit(change, deviceId);
      return row;
    }
    return read(on);
  });
}

/** `readDevice`, committing `change` before the read numbered `onCall`. */
function commitThenRead(
  deviceId: string,
  onCall: number,
  change: Partial<typeof devices.$inferInsert>,
) {
  const read = readDevice(deviceId);
  let calls = 0;
  return async (on: Database | Transaction) => {
    calls += 1;
    if (calls === onCall) await commit(change, deviceId);
    return read(on);
  };
}

const lastSeen = async (deviceId: string) => (await readDevice(deviceId)(suite.db))?.lastSeenAt;

const diskFull = () => new AppError("storage.disk_full", {});

describe("signInWithToken", () => {
  it("signs in a matching token, returning the row and stamping a first sighting", async () => {
    const deviceId = await seed();
    const recordSighting = vi.fn(stamp(deviceId));

    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: readDevice(deviceId),
      recordSighting,
    });

    expect(row?.tokenHash).toBe(hashDeviceToken(TOKEN));
    expect(recordSighting).toHaveBeenCalledTimes(1);
    expect(await lastSeen(deviceId)).not.toBeNull();
  });

  it("refuses a wrong token and writes nothing", async () => {
    const deviceId = await seed();
    const recordSighting = vi.fn(stamp(deviceId));

    const row = await signInWithToken(suite.db, {
      token: TOKEN + "x",
      readRow: readDevice(deviceId),
      recordSighting,
    });

    expect(row).toBeNull();
    expect(recordSighting).not.toHaveBeenCalled();
  });

  it("refuses a missing row", async () => {
    const recordSighting = vi.fn(async () => {});
    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: async () => undefined,
      recordSighting,
    });
    expect(row).toBeNull();
    expect(recordSighting).not.toHaveBeenCalled();
  });

  it("refuses a row still holding an old scrypt value, and one holding the empty value", async () => {
    for (const tokenHash of [hashSecret(TOKEN), ""]) {
      const deviceId = await seed();
      await commit({ tokenHash }, deviceId);
      const row = await signInWithToken(suite.db, {
        token: TOKEN,
        readRow: readDevice(deviceId),
        recordSighting: stamp(deviceId),
      });
      expect(row).toBeNull();
    }
  });

  it("writes a sighting at most once a minute", async () => {
    const deviceId = await seed();
    const recordSighting = vi.fn(stamp(deviceId));
    const options = { token: TOKEN, readRow: readDevice(deviceId), recordSighting };

    expect(await signInWithToken(suite.db, options)).not.toBeNull();
    expect(await signInWithToken(suite.db, options)).not.toBeNull();

    expect(recordSighting).toHaveBeenCalledTimes(1);
  });

  it("writes a sighting when the stored one is over a minute old", async () => {
    const old = new Date(Date.now() - 2 * SIGHTING_INTERVAL_MS).toISOString();
    const deviceId = await seed(old);
    const recordSighting = vi.fn(stamp(deviceId));

    await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: readDevice(deviceId),
      recordSighting,
    });

    expect(recordSighting).toHaveBeenCalledTimes(1);
    expect((await lastSeen(deviceId))! > old).toBe(true);
  });

  it("writes no sighting on a passive read, even when one is due", async () => {
    const deviceId = await seed();
    const recordSighting = vi.fn(stamp(deviceId));

    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: readDevice(deviceId),
      recordSighting,
      passive: true,
    });

    expect(row).not.toBeNull();
    expect(recordSighting).not.toHaveBeenCalled();
    expect(await lastSeen(deviceId)).toBeNull();
  });

  it("refuses when a new token is committed between the read and the write lock", async () => {
    const deviceId = await seed();
    const recordSighting = vi.fn(stamp(deviceId));

    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: readThenCommit(deviceId, 1, { tokenHash: hashDeviceToken("re-keyed") }),
      recordSighting,
    });

    expect(row).toBeNull();
    expect(recordSighting).not.toHaveBeenCalled();
  });

  it("refuses when the device is revoked between the read and the write lock", async () => {
    const deviceId = await seed();
    const recordSighting = vi.fn(stamp(deviceId));

    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: readThenCommit(deviceId, 1, { active: false }),
      recordSighting,
    });

    expect(row).toBeNull();
    expect(recordSighting).not.toHaveBeenCalled();
  });

  it("returns the NEW row when another column changes between the read and the write lock", async () => {
    const deviceId = await seed();
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: `Moved ${deviceId}`,
      formFactor: "till",
      capabilities: [],
    });

    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: readThenCommit(deviceId, 1, { deviceProfileId: profile!.id }),
      recordSighting: stamp(deviceId),
    });

    expect(row?.deviceProfileId).toBe(profile!.id);
  });

  it("still signs in, unstamped, when the disk is full", async () => {
    const deviceId = await seed();

    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      readRow: readDevice(deviceId),
      recordSighting: async () => {
        throw diskFull();
      },
    });

    expect(row?.tokenHash).toBe(hashDeviceToken(TOKEN));
    expect(await lastSeen(deviceId)).toBeNull();
  });

  it("refuses on a full disk when a new token is committed before the unstamped re-check", async () => {
    const deviceId = await seed();

    const row = await signInWithToken(suite.db, {
      token: TOKEN,
      // Read 1 is the first check and read 2 the one under the write lock; the re-key lands just
      // before read 3, so only the re-check that follows the refused write can see it.
      readRow: commitThenRead(deviceId, 3, { tokenHash: hashDeviceToken("re-keyed") }),
      recordSighting: async () => {
        throw diskFull();
      },
    });

    expect(row).toBeNull();
  });

  it("passes on any failure of the sighting write that is not a full disk", async () => {
    const deviceId = await seed();
    const failure = new Error("boom");

    await expect(
      signInWithToken(suite.db, {
        token: TOKEN,
        readRow: readDevice(deviceId),
        recordSighting: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});
