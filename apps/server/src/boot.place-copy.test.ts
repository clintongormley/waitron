import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lockVenueDatabase,
  readTenant,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  envelopeDigest,
  sha256Hex,
  signEnvelope,
  signIndicator,
  type HandoverBinding,
  type NodeLocalItem,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { appendHandoverEventTx, setNodeMode, writeMirrorLink } from "@waitron/node-db";
import type { StartedServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { FINAL_STATE_EVENT } from "./handover-capture.js";
import { COPY_PLACED_EVENT } from "./handover-place-copy.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { assertNotAhead, runEntry } from "./node-entry.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
const { beforeServerStarts, startServer } = ephemeralServerFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const MAIN_BOX = { nodeId: "00000000-0000-4000-8000-0000000000bb", ...generateNodeKeyPair() };
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHORISER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
/** The accepted copy and the old mirror database tell apart by this, in the file's own header. */
const ACCEPTED_VERSION = 777;
const OLD_VERSION = 111;
const PLACED_LINE = "handover.place_copy.placed";
const SEEN_AFTER_PLACING = "written_after_placing";

const suite = useVenueDb({ migrations });
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const scratchRoots: string[] = [];
let oldBox: Server | undefined;
const logged: string[] = [];
const realWrite = process.stdout.write.bind(process.stdout);

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => {
    oldBox?.closeAllConnections();
    if (oldBox === undefined) resolve();
    else oldBox.close(() => resolve());
  });
  oldBox = undefined;
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Every line boot's logger writes, which is where this file reads what a start did. */
function watchLog(): void {
  logged.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    logged.push(String(chunk));
    return realWrite(chunk);
  }) as typeof process.stdout.write);
}
const loggedLines = (word: string) => logged.filter((line) => line.includes(word)).length;

function userVersion(path: string): number {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return (raw.prepare("pragma user_version").get() as { user_version: number }).user_version;
  } finally {
    raw.close();
  }
}

function databaseWithVersion(target: string, version: number, makeFrom: string): void {
  suite.db.run(sql`vacuum into ${makeFrom}`);
  const raw = new DatabaseSync(makeFrom);
  raw.exec(`pragma user_version = ${version}; vacuum into '${target}'`);
  raw.close();
  rmSync(makeFrom);
}

/** Real frames in `-wal`, as a killed process leaves them: a clean close would checkpoint them. */
function leaveCommittedRowInWal(live: string): void {
  const writer = new DatabaseSync(live);
  writer.exec(
    "pragma journal_mode = wal; pragma wal_autocheckpoint = 0; create table old_mirror_row_in_wal(a); insert into old_mirror_row_in_wal values (1);",
  );
  const kept = mkdtempSync(join(tmpdir(), "waitron-boot-place-wal-"));
  for (const suffix of ["", "-wal", "-shm"]) copyFileSync(live + suffix, join(kept, `x${suffix}`));
  writer.close();
  for (const suffix of ["", "-wal", "-shm"]) copyFileSync(join(kept, `x${suffix}`), live + suffix);
  rmSync(kept, { recursive: true });
}

/** A signed relinquishment for whatever acceptance it is posted: the old box, reduced to that. */
async function startOldBox(self: () => string): Promise<{ url: string; posts: string[] }> {
  const posts: string[] = [];
  oldBox = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const acceptance = JSON.parse(raw) as SignedHandoverEnvelope<{
        binding: CanonicalValue;
        indicatorDigest: string;
      }>;
      posts.push(raw);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          signEnvelope(
            "relinquishment",
            {
              binding: acceptance.body.binding,
              indicatorDigest: acceptance.body.indicatorDigest,
              acceptanceDigest: envelopeDigest(acceptance),
              filingAssignedTo: self(),
              authorisedBy: AUTHORISER,
            },
            MAIN_BOX,
          ),
        ),
      );
    });
  });
  await new Promise<void>((resolve) => oldBox!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(oldBox.address() as AddressInfo).port}`, posts };
}

interface BoxOptions {
  mode?: "mirror" | "primary";
  /** `copy_accepted` leaves the relinquishment still to come, from `contactUrl`'s old box. */
  state?: "filing_assumed" | "copy_accepted";
}

async function buildBox(options: BoxOptions = {}) {
  const { mode = "mirror", state = "filing_assumed" } = options;
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  const nodeId = venue.cfg.nodeId;
  const ring = loadKeyRing(KEY_ENV);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const own = await readNodeIdentityKey(suite.node, ring, nodeId);
  await pinMainBoxKey(suite.node, nodeId, MAIN_BOX);
  const old =
    state === "copy_accepted"
      ? await startOldBox(() => nodeId)
      : { url: "http://127.0.0.1:1", posts: [] };
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: MAIN_BOX.nodeId, contactUrl: old.url, standing: "serving-primary" },
      { nodeId, contactUrl: "https://spare.example", standing: "serving-secondary" },
    ],
  };
  const held = {
    body,
    signerNodeId: MAIN_BOX.nodeId,
    signature: signDocumentBody(body, MAIN_BOX.privateKey),
    endorsements: [
      endorseKey(nodeId, nodeSigningPublicKey(own), MAIN_BOX.nodeId, MAIN_BOX.privateKey),
    ],
  };
  await writeNodeMembership(suite.db, held);
  await stampDeployment(suite.db, "preproduction");
  const tenant = (await readTenant(suite.db))!;
  const binding: HandoverBinding = {
    operationId: OP,
    scenario: "controlled",
    venue: { country: tenant.country, taxId: tenant.taxId, environment: "preproduction" },
    sourceNodeId: MAIN_BOX.nodeId,
    destinationNodeId: nodeId,
    membership: { term: 3, digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)) },
  };
  const store = { node: suite.node, nodeId };
  await beginHandover(store, binding, "destination");
  await setNodeMode({ venue: suite.db, node: suite.node }, nodeId, mode);
  await writeMirrorLink(suite.node, nodeId, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "box.local",
    boxCaPem: mintSelfSignedServerCert({
      hostnames: ["box.local"],
      ipAddresses: [],
      now: new Date(),
    }).caCertPem,
    originNodeId: MAIN_BOX.nodeId,
  });

  const root = mkdtempSync(join(tmpdir(), "waitron-boot-place-"));
  scratchRoots.push(root);
  const venueDir = join(root, "venue");
  const stateDir = join(root, "state");
  mkdirSync(venueDir);
  mkdirSync(stateDir);
  const accepted = acceptedCopyPath(stateDir, OP);
  mkdirSync(join(stateDir, "handover", OP), { recursive: true });
  databaseWithVersion(accepted, ACCEPTED_VERSION, `${accepted}.raw`);

  const nodeLocal: NodeLocalItem[] = [
    { item: "backup.env", where: "state", class: "transferred", treatment: "x", sha256: null },
    { item: "modules.json", where: "state", class: "transferred", treatment: "x", sha256: null },
    {
      item: "secrets.env",
      where: "state",
      class: "transferred",
      treatment: "x",
      ringVersions: [1],
    },
    {
      item: "module-preparation-state.json",
      where: "state",
      class: "transferred",
      treatment: "merged",
      revisions: [],
    },
  ];
  const envelope = signIndicator(
    {
      binding,
      snapshot: { sha256: sha(accepted), bytes: statSync(accepted).size, schema: [], modules: [] },
      nodeLocal,
      modulesSummary: {},
      capturedAtMs: 1,
    },
    { nodeId: MAIN_BOX.nodeId, privateKey: MAIN_BOX.privateKey },
  );
  await withNodeTransaction(suite.node, async (tx) => {
    await appendHandoverEventTx(tx, {
      nodeId,
      operationId: OP,
      kind: FINAL_STATE_EVENT,
      detail: {},
      envelope: JSON.stringify(envelope),
    });
    await appendHandoverEventTx(tx, {
      nodeId,
      operationId: OP,
      kind: "offer",
      detail: {},
      envelope: canonicalize({ body: { authorisedBy: AUTHORISER } }),
    });
  });
  const acceptance = signEnvelope(
    "acceptance",
    {
      binding: binding as unknown as CanonicalValue,
      indicatorDigest: "d".repeat(64),
      acceptedAtMs: 1,
    },
    { nodeId, privateKey: own },
  );
  await advanceHandover(store, OP, "copy_accepted", {}, acceptance);
  if (state === "filing_assumed") await advanceHandover(store, OP, "filing_assumed", {});

  const live = join(venueDir, "venue.db");
  databaseWithVersion(live, OLD_VERSION, `${live}.raw`);
  leaveCommittedRowInWal(live);
  mkdirSync(join(venueDir, ".venue.db-litestream"));
  writeFileSync(join(venueDir, ".venue.db-litestream", "generation"), "old");
  suite.node.run(sql`vacuum into ${join(venueDir, "node.db")}`);
  const note = join(stateDir, "backup-room-note.json");
  writeFileSync(note, "{}");
  // The lock file exists before anything happens, as on a box that has run.
  (await lockVenueDatabase(venueDir)).release();

  const migrationsRoot = join(root, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    cpSync(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  writeFileSync(
    join(stateDir, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const env: Record<string, string> = {
    ...KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_MAX_TICK_MS: "600000",
    WAITRON_MIN_TICK_MS: "200",
    WAITRON_LOG_DIR: join(stateDir, "logs"),
  };
  return { root, venueDir, stateDir, accepted, live, note, env, nodeId, migrationsRoot, old };
}

type Box = Awaited<ReturnType<typeof buildBox>>;

const startSeams = (restart: () => void = () => {}) => ({
  // Beside a real chart whose other box is not running.
  peerCheck: async () => ({ result: "proceed" as const, successorNodeId: null }),
  stepdown: { mount: () => {}, restart },
});

const KILL_CHILD = fileURLToPath(new URL("./testing/place-copy-kill-child.ts", import.meta.url));

function killedPlacing(b: Box, at: string): Promise<NodeJS.Signals | null> {
  const child = spawn(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), KILL_CHILD, b.venueDir, b.stateDir, b.nodeId, at],
    { stdio: "ignore" },
  );
  return new Promise((resolve) => child.once("close", (_code, signal) => resolve(signal)));
}

interface StartResult {
  started?: StartedServer;
  page?: string;
  thrown?: { code?: string; message?: string };
}

/** Production's real entry, every check on: only the listener and the process's own exit are not. */
async function entryStart(
  b: Box,
  overrides: {
    env?: Record<string, string>;
    restart?: () => void;
    assertNotAhead?: typeof assertNotAhead;
  } = {},
): Promise<StartResult> {
  const result: StartResult = {};
  try {
    await runEntry({
      args: [],
      baseEnv: overrides.env ?? b.env,
      stateDir: b.stateDir,
      venueDir: b.venueDir,
      logDir: join(b.stateDir, "logs"),
      migrationsRoot: b.migrationsRoot,
      loadBoxEnv,
      readRecoveryState,
      writeRecoveryState,
      startServer: async (env, base) => {
        result.started = await startServer(env, base, startSeams(overrides.restart));
        return result.started;
      },
      assertNotAhead: overrides.assertNotAhead,
      serveRecovery: async (app) => {
        result.page = await (await app.request("/")).text();
      },
      installShutdownHandlers: () => {},
      scheduleStayedUp: () => {},
      log: () => {},
      exit: () => {},
      spareBytes: 0,
    });
  } catch (error) {
    result.thrown = error as { code?: string; message?: string };
  }
  return result;
}

function withoutNodeId(b: Box): Record<string, string> {
  return Object.fromEntries(Object.entries(b.env).filter(([key]) => key !== "WAITRON_NODE_ID"));
}

function copyPlacedEvents(b: Box): number {
  const raw = new DatabaseSync(join(b.venueDir, "node.db"), { readOnly: true });
  try {
    return (
      raw
        .prepare("select count(*) as n from node_handover_events where kind = ?")
        .get(COPY_PLACED_EVENT) as { n: number }
    ).n;
  } finally {
    raw.close();
  }
}

function writeToPlacedDatabase(b: Box): void {
  const raw = new DatabaseSync(b.live);
  raw.exec(`create table ${SEEN_AFTER_PLACING}(a)`);
  raw.close();
}

function hasTable(path: string, name: string): boolean {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return raw.prepare("select 1 from sqlite_master where name = ?").get(name) !== undefined;
  } finally {
    raw.close();
  }
}

describe("a spare's real start at filing_assumed", () => {
  it("places the copy once, records one event and removes accepted.db; the next start places nothing", async () => {
    const b = await buildBox();
    watchLog();
    const lockFile = statSync(join(b.venueDir, "venue.lock")).ino;

    const first = await entryStart(b);
    expect(first.thrown).toBeUndefined();
    await first.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(1);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(hasTable(b.live, "old_mirror_row_in_wal")).toBe(false);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
    expect(existsSync(b.note)).toBe(false);
    expect(existsSync(join(b.venueDir, ".venue.db-litestream"))).toBe(false);
    expect(existsSync(`${b.live}.incoming`)).toBe(false);
    expect(statSync(join(b.venueDir, "venue.lock")).ino).toBe(lockFile);

    writeToPlacedDatabase(b);
    logged.length = 0;
    const second = await entryStart(b);
    expect(second.thrown).toBeUndefined();
    await second.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(0);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(hasTable(b.live, SEEN_AFTER_PLACING)).toBe(true);
    expect(statSync(join(b.venueDir, "venue.lock")).ino).toBe(lockFile);
  }, 120_000);

  // After a kill the only start is production's entry, which clears set-aside folders and opens the
  // database before the server: a `startServer` test cannot show what those do to a half-done swap.
  it.each([
    "copy",
    "chmod",
    "flush-incoming",
    "litestream",
    "wal",
    "shm",
    "flush-before-rename",
    "rename",
    "flush-after-rename",
    "answered",
  ])(
    "killed at %s, a real entry start finishes the placing with one event",
    async (at) => {
      const b = await buildBox();
      const acceptedBytes = sha(b.accepted);

      expect(await killedPlacing(b, at)).toBe("SIGKILL");
      expect(existsSync(b.live)).toBe(true);
      expect(sha(b.accepted)).toBe(acceptedBytes);
      expect(copyPlacedEvents(b)).toBe(0);

      const start = await entryStart(b);
      expect(start.page).toBeUndefined();
      expect(start.thrown).toBeUndefined();
      await start.started!.close();

      expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
      expect(hasTable(b.live, "old_mirror_row_in_wal")).toBe(false);
      expect(copyPlacedEvents(b)).toBe(1);
      expect(existsSync(b.accepted)).toBe(false);
      expect(existsSync(`${b.live}.incoming`)).toBe(false);
    },
    120_000,
  );

  it("swapped with no open in between: not placed again, and the event is recorded", async () => {
    const b = await buildBox();
    expect(await killedPlacing(b, "answered")).toBe("SIGKILL");
    const placedBytes = sha(b.accepted);
    expect(sha(b.live)).toBe(placedBytes);
    watchLog();

    const server = await startServer(b.env, b.env, startSeams());
    await server.close();

    expect(loggedLines(PLACED_LINE)).toBe(0);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
  }, 120_000);

  it("swapped, then opened by entry's ahead check: placed again from the kept file, one event", async () => {
    const b = await buildBox();
    expect(await killedPlacing(b, "answered")).toBe("SIGKILL");
    watchLog();

    const start = await entryStart(b);
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(1);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
  }, 120_000);

  it("the event recorded and accepted.db still there: not placed again", async () => {
    const b = await buildBox();
    const first = await entryStart(b);
    await first.started!.close();
    writeToPlacedDatabase(b);
    writeFileSync(b.accepted, "a leftover nothing reads");
    watchLog();

    const second = await entryStart(b);
    expect(second.thrown).toBeUndefined();
    await second.started!.close();

    expect(loggedLines(PLACED_LINE)).toBe(0);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(hasTable(b.live, SEEN_AFTER_PLACING)).toBe(true);
  }, 120_000);

  it("the ahead check runs on the old file, and its close drains the old -wal, before placing", async () => {
    const b = await buildBox();
    const oldBytes = sha(b.live);
    const seen: { before?: string; walAfter?: boolean; drained?: boolean } = {};

    const start = await entryStart(b, {
      assertNotAhead: async (venueDir, migrationsRoot) => {
        seen.before = sha(b.live);
        await assertNotAhead(venueDir, migrationsRoot);
        seen.walAfter = existsSync(`${b.live}-wal`);
        seen.drained = hasTable(b.live, "old_mirror_row_in_wal");
      },
    });
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    // Placing ahead of the check prints the accepted copy's digest here.
    expect(seen.before).toBe(oldBytes);
    expect(seen.walAfter).toBe(false);
    expect(seen.drained).toBe(true);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
  }, 120_000);

  it("a box that is not a mirror is left alone: its database is not replaced", async () => {
    const b = await buildBox({ mode: "primary" });
    watchLog();

    const start = await entryStart(b);
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    expect(userVersion(b.live)).toBe(OLD_VERSION);
    expect(existsSync(b.accepted)).toBe(true);
    expect(copyPlacedEvents(b)).toBe(0);
    expect(loggedLines("handover.place_copy.left_alone")).toBe(1);
    // The duty did not start: this is the one line a box off mirror logs instead.
    expect(loggedLines("handover-destination.not_a_mirror")).toBe(1);
    expect(loggedLines("handover-destination.")).toBe(1);
  }, 120_000);

  it("the box's identity held only in its trading file still places", async () => {
    const b = await buildBox();
    writeFileSync(join(b.stateDir, "trading.env"), `WAITRON_NODE_ID=${b.nodeId}\n`);
    const env = withoutNodeId(b);

    const start = await entryStart(b, { env });
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
  }, 120_000);

  it("a box with no identity at all reads no operation: it starts and nothing is replaced", async () => {
    const b = await buildBox();
    const env = withoutNodeId(b);

    const start = await entryStart(b, { env });
    expect(start.thrown).toBeUndefined();
    await start.started!.close();

    expect(userVersion(b.live)).toBe(OLD_VERSION);
    expect(existsSync(b.accepted)).toBe(true);
    expect(copyPlacedEvents(b)).toBe(0);
  }, 120_000);

  it("a copy that cannot be put in place refuses the start with its own page, keeps the copy, and places on a later start", async () => {
    const b = await buildBox();
    const acceptedBytes = sha(b.accepted);
    // A folder at the incoming name: `copyFile` itself fails, on the real path a start takes.
    mkdirSync(`${b.live}.incoming`);

    let start: StartResult = {};
    for (let attempt = 0; attempt < 5 && start.page === undefined; attempt += 1) {
      start = await entryStart(b);
      if (start.page === undefined) {
        expect(start.thrown?.code).toBe("handover.placement_failed");
      }
      expect((await readRecoveryState(b.stateDir)).lastErrorCode).toBe("handover.placement_failed");
    }
    expect(start.page).toContain(
      "This box could not put the copy of the venue it accepted in place.",
    );
    expect(existsSync(b.live)).toBe(true);
    expect(sha(b.accepted)).toBe(acceptedBytes);
    expect(copyPlacedEvents(b)).toBe(0);

    rmSync(`${b.live}.incoming`, { recursive: true });
    await writeRecoveryState(b.stateDir, {
      ...(await readRecoveryState(b.stateDir)),
      level: "normal",
      failures: 0,
    });
    const later = await entryStart(b);
    expect(later.thrown).toBeUndefined();
    await later.started!.close();
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
  }, 240_000);
});

describe("a spare that takes over filing", () => {
  it("restarts once, after filing_assumed is stored, and the real start after it places the copy", async () => {
    const b = await buildBox({ state: "copy_accepted" });
    const nodeState = () => {
      const raw = new DatabaseSync(join(b.venueDir, "node.db"), { readOnly: true });
      try {
        return (
          raw.prepare("select state from node_handover_operations").get() as { state: string }
        ).state;
      } finally {
        raw.close();
      }
    };
    const restarts: string[] = [];

    const first = await entryStart(b, { restart: () => restarts.push(nodeState()) });
    expect(first.thrown).toBeUndefined();
    await vi.waitFor(() => expect(restarts).toEqual(["filing_assumed"]), { timeout: 20_000 });
    expect(b.old.posts).toHaveLength(1);
    expect(userVersion(b.live)).not.toBe(ACCEPTED_VERSION);
    await first.started!.close();

    const second = await entryStart(b, { restart: () => restarts.push("a second restart") });
    expect(second.thrown).toBeUndefined();
    // Long enough for the duty's first pass, which must find no work at filing_assumed.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await second.started!.close();

    expect(restarts).toEqual(["filing_assumed"]);
    expect(userVersion(b.live)).toBe(ACCEPTED_VERSION);
    expect(copyPlacedEvents(b)).toBe(1);
    expect(existsSync(b.accepted)).toBe(false);
  }, 180_000);
});
