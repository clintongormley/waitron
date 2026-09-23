import { mkdir, mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { locations, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  PENDING_ADOPTION_FILE,
  readPendingAdoption,
  runFinishAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";
import { MIRROR_VIEWER_PERSON_ID } from "./mirror-session.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-adopt-"));
  dirs.push(dir);
  return dir;
}

const STANDBY_NODE_ID = "33333333-3333-4333-8333-333333333333";
const PENDING: PendingAdoption = {
  locationId: "55555555-5555-4555-8555-555555555555",
  standby: { nodeId: STANDBY_NODE_ID, publicKey: "pub", privateKey: "priv" },
  nodeName: "standby",
  filingModule: "fiscal-verifactu",
  taxModule: null,
  reserved: { modules: {}, series: [], endorsement: {} as never },
  originNodeId: "77777777-7777-4777-8777-777777777777",
};

const dummyDb = {} as Database;
const dummyRing = {} as KeyRing;
const noop = (): void => {};

describe("writePendingAdoption / readPendingAdoption", () => {
  it("round-trips the pending record and writes it 0600", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    expect(await readPendingAdoption(dir)).toEqual(PENDING);
    const mode = (await stat(join(dir, PENDING_ADOPTION_FILE))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null when no pending file exists", async () => {
    const dir = await tempDir();
    expect(await readPendingAdoption(dir)).toBeNull();
  });
});

describe("runFinishAdoption", () => {
  it("establishes the reserved identity, ensures the viewer, and unlinks the file", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    let established: unknown;
    let viewerCalls = 0;
    await runFinishAdoption({
      ownerDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      modules: [],
      establish: (args) => {
        established = args;
        return Promise.resolve();
      },
      ensureViewer: () => {
        viewerCalls += 1;
        return Promise.resolve();
      },
      log: noop as never,
    });
    expect(established).toMatchObject({ standby: PENDING.standby });
    expect(viewerCalls).toBe(1);
    expect(await readPendingAdoption(dir)).toBeNull(); // file unlinked
  });

  it("returns immediately when there is no pending file (nothing to finish)", async () => {
    const dir = await tempDir();
    let establishCalls = 0;
    await runFinishAdoption({
      ownerDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      modules: [],
      establish: () => {
        establishCalls += 1;
        return Promise.resolve();
      },
      ensureViewer: () => Promise.resolve(),
      log: noop as never,
    });
    expect(establishCalls).toBe(0);
  });

  it("logs establish_failed and KEEPS the file when establish throws, so the next boot retries", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    let viewerCalls = 0;
    const events: string[] = [];
    await runFinishAdoption({
      ownerDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      modules: [],
      establish: () => Promise.reject(new Error("no tenant row yet")),
      ensureViewer: () => {
        viewerCalls += 1;
        return Promise.resolve();
      },
      log: ((_l: string, event: string) => events.push(event)) as never,
    });
    expect(events).toContain("adoption.establish_failed");
    // The viewer never ran (establish comes first) and the latch survives.
    expect(viewerCalls).toBe(0);
    expect(await readFile(join(dir, PENDING_ADOPTION_FILE), "utf8")).not.toBe("");
  });

  it("KEEPS the file when the viewer step throws after a successful establish", async () => {
    // The order matters: establish, then the viewer, then the unlink. A viewer failure must leave the
    // latch in place — deleting the unlink's position and clearing the file first would fail this.
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    const events: string[] = [];
    await runFinishAdoption({
      ownerDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      modules: [],
      establish: () => Promise.resolve(),
      ensureViewer: () => Promise.reject(new Error("persons insert failed")),
      log: ((_l: string, event: string) => events.push(event)) as never,
    });
    expect(events).toContain("adoption.establish_failed");
    expect(await readFile(join(dir, PENDING_ADOPTION_FILE), "utf8")).not.toBe("");
  });
});

describe("readPendingAdoption — unreadable record", () => {
  it("rejects with the read error when the record's path is not a readable file", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, PENDING_ADOPTION_FILE));
    await expect(readPendingAdoption(dir)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("runFinishAdoption — default steps on a migrated venue", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  const ring: KeyRing = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });

  it("establishes the standby's node and the mirror viewer, then clears the record", async () => {
    await seedTenant(suite.db);
    const [location] = await suite.db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const dir = await tempDir();
    await writePendingAdoption(dir, {
      ...PENDING,
      locationId: location!.id,
      filingModule: null,
      reserved: {
        modules: {},
        series: [],
        endorsement: { nodeId: STANDBY_NODE_ID, publicKey: "pub", endorsedBy: "e", signature: "s" },
      },
    });
    const logged: unknown[] = [];

    await runFinishAdoption({
      ownerDb: suite.db,
      ring,
      stateDir: dir,
      modules: [],
      log: ((level: string, event: string, fields: unknown) =>
        logged.push({ level, event, fields })) as never,
    });

    expect(logged).toEqual([
      { level: "info", event: "adoption.established", fields: { nodeId: STANDBY_NODE_ID } },
    ]);
    const node = await suite.db.execute<{ name: string }>(
      sql`select name from nodes where id = ${STANDBY_NODE_ID}`,
    );
    expect(node.rows).toEqual([{ name: "standby" }]);
    const viewer = await suite.db.execute<{ role: string }>(
      sql`select role from persons where id = ${MIRROR_VIEWER_PERSON_ID}`,
    );
    expect(viewer.rows).toEqual([{ role: "admin" }]);
    expect(await readPendingAdoption(dir)).toBeNull();
  });
});
