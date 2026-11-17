const faults = vi.hoisted(() => ({
  /** Folders a rename between which fails as it does between two filesystems. */
  separateFilesystems: null as readonly string[] | null,
  /** Runs after each saved `secrets.env`, before the placement carries on. */
  afterRingSaved: null as (() => Promise<void>) | null,
  /** How many placed-copy checks have begun. */
  checksBegun: 0,
}));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  const { resolve, sep } = await import("node:path");
  const filesystemOf = (path: string) =>
    faults.separateFilesystems?.findIndex((root) => resolve(path).startsWith(`${root}${sep}`));
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (filesystemOf(from) !== filesystemOf(to))
        throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${from}'`), {
          code: "EXDEV",
        });
      return real.rename(from, to);
    },
  };
});
vi.mock("./emergency-copy-check.js", async (original) => {
  const real = await original<typeof import("./emergency-copy-check.js")>();
  return {
    ...real,
    checkPlacedEmergencyCopy: (...args: Parameters<typeof real.checkPlacedEmergencyCopy>) => {
      faults.checksBegun++;
      return real.checkPlacedEmergencyCopy(...args);
    },
  };
});
vi.mock("./box-secrets.js", async (original) => {
  const real = await original<typeof import("./box-secrets.js")>();
  return {
    ...real,
    writeCredentialsRing: async (...args: Parameters<typeof real.writeCredentialsRing>) => {
      await real.writeCredentialsRing(...args);
      await faults.afterRingSaved?.();
    },
  };
});

import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEY_RING_VARIABLES,
  loadKeyRing,
  nodeSigningPublicKey,
  openNodeSigningKeyRow,
  readNodeSigningKey,
} from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  openVenueDatabase,
  withNodeTransaction,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  box,
  NODE_MIGRATIONS,
  nodeHandoverEvents,
  readNodeMode,
  setNodeModeTx,
} from "@waitron/node-db";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import { generateKeyRing } from "@waitron/provisioning";
import { INCOMING_SUFFIX, NODE_FILE, VENUE_FILE } from "@waitron/store";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import { writeCredentialsRing } from "./box-secrets.js";
import { PLACED, readImmutableNodeDb, readPlacedEmergencyCopy } from "./emergency-copy-check.js";
import { placeEmergencyCopy, refuseUnactivatedEmergencyCopy } from "./emergency-copy-placement.js";
import { parseEnvFile } from "./env-file.js";
import { writeTradingEnv } from "./trading-config.js";
import {
  bindingFor,
  copyId,
  seedEmergencyCopySource,
  source,
  sourceId,
} from "./testing/emergency-copy-source.js";
import { sha } from "./testing/place-copy-box.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
let root: string;
let venueDir: string;
let stateDir: string;
let venuePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emergency-copy-placement-"));
  venueDir = join(root, "venue");
  stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  venuePath = join(venueDir, "venue.db");
  await seedEmergencyCopySource(suite.db);
});
afterEach(async () => {
  faults.separateFilesystems = null;
  faults.afterRingSaved = null;
  faults.checksBegun = 0;
  await rm(root, { recursive: true, force: true });
});

async function placedBinding(): Promise<EmergencyCopyBinding> {
  await suite.db.archiveTo(venuePath);
  return bindingFor(sha(venuePath));
}

/** Immutable, so the probe sees only what reached node.db itself, never a `-wal` beside it. */
const readPlacedNode = <T>(read: (node: NodeDatabase) => Promise<T>) =>
  readImmutableNodeDb(join(venueDir, NODE_FILE), read);

const listing = async (dir: string) => (await readdir(dir)).sort();

/** Every file in both folders, by name and bytes, and what the scratch folder holds (null: none). */
async function bothFolders() {
  const read = async (dir: string) =>
    Object.fromEntries(
      await Promise.all(
        (await listing(dir))
          .filter((name) => name !== "scratch")
          .map(async (name) => [name, await readFile(join(dir, name))] as const),
      ),
    );
  const scratch = join(stateDir, "scratch");
  return {
    venue: await read(venueDir),
    state: await read(stateDir),
    scratch: existsSync(scratch) ? await listing(scratch) : null,
  };
}

/** `before`, plus the venue lock a first placement takes before it checks anything. */
const withLockTaken = (before: Awaited<ReturnType<typeof bothFolders>>) => ({
  ...before,
  venue: { ...before.venue, "venue.lock": expect.any(Buffer) },
});

/** `node.db` beside the venue file, the env files in the state folder, and no scratch left over. */
async function expectPlacedLayout() {
  expect(await listing(venueDir)).toEqual(["node.db", "venue.db", "venue.lock"]);
  expect(await listing(stateDir)).toEqual(["scratch", "secrets.env", "trading.env"]);
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
  expect(statSync(join(venueDir, NODE_FILE)).mode & 0o777).toBe(0o600);
}

const writtenRing = () =>
  loadKeyRing(parseEnvFile(readFileSync(join(stateDir, "secrets.env"), "utf8")));

const placedKey = () => readPlacedNode((node) => readNodeSigningKey(node, writtenRing(), copyId));

const keptTrading = (lines: string) => `WAITRON_NODE_ID=${copyId}\n${lines}`;

const beforeExpiry = () => new Date("2026-11-17T10:10:00.000Z");

function place(
  binding: EmergencyCopyBinding,
  processEnv: NodeJS.ProcessEnv = {},
  extra: Partial<Parameters<typeof placeEmergencyCopy>[0]> = {},
) {
  return placeEmergencyCopy({
    binding,
    venueDir,
    stateDir,
    environment: "preproduction",
    processEnv,
    migrationsRoot: null,
    modules: [],
    now: beforeExpiry,
    ...extra,
  });
}

it("a placed copy has its own key and the venue file is byte for byte the one Cloud chose", async () => {
  const binding = await placedBinding();
  await place(binding);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
  expect(await placedKey()).toEqual(expect.any(String));
  await expectPlacedLayout();
});

it("seals the key so it opens only under the copy's id and on the copy's own ring", async () => {
  await place(await placedBinding());
  const ring = writtenRing();
  const [row] = await readPlacedNode((node) =>
    node
      .select({
        ciphertext: box.signingKeyCiphertext,
        iv: box.signingKeyIv,
        authTag: box.signingKeyAuthTag,
        keyVersion: box.signingKeyVersion,
      })
      .from(box)
      .where(eq(box.nodeId, copyId)),
  );
  const sealed = {
    ciphertext: row!.ciphertext!,
    iv: row!.iv!,
    authTag: row!.authTag!,
    keyVersion: row!.keyVersion!,
  };
  const key = openNodeSigningKeyRow(sealed, ring, copyId);
  expect(nodeSigningPublicKey(key)).not.toBe(source.publicKey);
  expect(() => openNodeSigningKeyRow(sealed, ring, sourceId)).toThrow(
    expect.objectContaining({ code: "credentials.decrypt_failed" }),
  );
  const otherRing = generateKeyRing();
  expect(() =>
    openNodeSigningKeyRow(
      sealed,
      loadKeyRing({
        WAITRON_CREDENTIALS_KEY: otherRing.key,
        WAITRON_CREDENTIALS_KEY_VERSION: String(otherRing.version),
      }),
      copyId,
    ),
  ).toThrow(expect.objectContaining({ code: "credentials.decrypt_failed" }));
});

it("holds no row for the source box", async () => {
  await place(await placedBinding());
  const boxes = await readPlacedNode((node) => node.select({ nodeId: box.nodeId }).from(box));
  const events = await readPlacedNode((node) =>
    node.select({ nodeId: nodeHandoverEvents.nodeId }).from(nodeHandoverEvents),
  );
  expect(boxes).toEqual([{ nodeId: copyId }]);
  expect(events.every((event) => event.nodeId === copyId)).toBe(true);
});

it("records the copy as a mirror, so no reader sees a box that sells", async () => {
  await place(await placedBinding());
  expect(await readPlacedNode((node) => readNodeMode(node, copyId))).toEqual({
    mode: "mirror",
    singletonRole: "secondary",
  });
});

it("names the copy in trading.env", async () => {
  const binding = await placedBinding();
  await place(binding);
  expect(parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"))).toMatchObject({
    WAITRON_NODE_ID: copyId,
    WAITRON_ENV: "preproduction",
  });
});

it("reads back the binding it recorded, with no operation id", async () => {
  const binding = await placedBinding();
  await place(binding);
  expect(await readPlacedNode((node) => readPlacedEmergencyCopy(node))).toEqual(binding);
  const [placed] = await readPlacedNode((node) =>
    node
      .select({ operationId: nodeHandoverEvents.operationId })
      .from(nodeHandoverEvents)
      .where(eq(nodeHandoverEvents.kind, PLACED)),
  );
  expect(placed).toEqual({ operationId: null });
});

it("reads null from a node.db holding no placed copy", async () => {
  expect(await readPlacedEmergencyCopy(suite.node)).toBeNull();
});

it("leaves nothing beside the venue file when the check refuses it", async () => {
  const binding = await placedBinding();
  const before = await bothFolders();
  await expect(place(bindingFor("0".repeat(64)))).rejects.toMatchObject({
    code: "emergency_copy.hash_mismatch",
  });
  expect(await bothFolders()).toEqual(withLockTaken(before));
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

it("leaves no node.db beside the venue file when a write before the move fails", async () => {
  const binding = await placedBinding();
  await mkdir(join(stateDir, "secrets.env", "in-the-way"), { recursive: true });
  await expect(place(binding)).rejects.toThrow();
  expect(existsSync(join(venueDir, NODE_FILE))).toBe(false);
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

it.each<{ name: string; content: string; code: string; params?: object }>([
  {
    name: "naming another node",
    content: "WAITRON_NODE_ID=e7000000-0000-4000-8000-0000000000ff\n",
    code: "emergency_copy.trading_node_differs",
  },
  ...["WAITRON_ENV=production\n", "WAITRON_ENV=staging\n"].map((line) => ({
    name: `naming another environment (${JSON.stringify(line)})`,
    content: keptTrading(line),
    code: "emergency_copy.trading_environment_differs",
  })),
  ...[
    ...KEY_RING_VARIABLES.map((variable) => [variable, `${variable}=1\n`] as const),
    ["WAITRON_CREDENTIALS_KEY", "WAITRON_CREDENTIALS_KEY=\n"] as const,
  ].map(([variable, line]) => ({
    name: `setting ${variable}, which the next start reads after secrets.env (${JSON.stringify(line)})`,
    content: keptTrading(line),
    code: "emergency_copy.vault_key_in_trading_env",
    params: { variables: [variable] },
  })),
])("refuses a trading.env $name, writing nothing", async ({ content, code, params }) => {
  const binding = await placedBinding();
  await writeFile(join(stateDir, "trading.env"), content);
  const before = await bothFolders();
  await expect(place(binding)).rejects.toMatchObject(params ? { code, params } : { code });
  expect(await bothFolders()).toEqual(withLockTaken(before));
});

it("keeps a trading.env that already names the copy as it is", async () => {
  const binding = await placedBinding();
  const own = keptTrading("WAITRON_ACCOUNT_KEY=kept\n");
  await writeFile(join(stateDir, "trading.env"), own);
  await place(binding);
  expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(own);
  expect(existsSync(join(venueDir, NODE_FILE))).toBe(true);
});

it.each(["WAITRON_ENV=preproduction\n", "WAITRON_ENV=\n", "WAITRON_ENV=dev\n"])(
  "keeps a trading.env whose environment (%j) is the binding's",
  async (line) => {
    const binding = await placedBinding();
    await writeFile(join(stateDir, "trading.env"), keptTrading(line));
    await place(binding);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe(keptTrading(line));
    await expectPlacedLayout();
  },
);

it("reads a kept trading.env with no WAITRON_ENV as preproduction, so a production binding refuses it", async () => {
  const binding = { ...(await placedBinding()), environment: "production" as const };
  await writeFile(join(stateDir, "trading.env"), keptTrading(""));
  await expect(place(binding, {}, { environment: "production" })).rejects.toMatchObject({
    code: "emergency_copy.trading_environment_differs",
  });
  // Control: naming production, the same trading.env passes, and the check refuses the
  // preproduction venue file instead.
  await writeFile(join(stateDir, "trading.env"), keptTrading("WAITRON_ENV=production\n"));
  await expect(place(binding, {}, { environment: "production" })).rejects.toMatchObject({
    code: "emergency_copy.environment_mismatch",
  });
});

it("refuses when this process's environment sets the vault key, which would win over the copy's ring", async () => {
  const binding = await placedBinding();
  const before = await bothFolders();
  await expect(
    place(binding, { WAITRON_CREDENTIALS_KEY: generateKeyRing().key, WAITRON_ACCOUNT_KEY: "a" }),
  ).rejects.toMatchObject({
    code: "emergency_copy.vault_key_in_environment",
    params: { variables: ["WAITRON_CREDENTIALS_KEY"] },
  });
  expect(await bothFolders()).toEqual(withLockTaken(before));
});

it("a repeat with the same binding makes no new key and rewrites nothing", async () => {
  const binding = await placedBinding();
  await place(binding);
  const before = await bothFolders();
  const publicKey = async () => {
    const key = await placedKey();
    expect(key).toEqual(expect.any(String));
    return nodeSigningPublicKey(key!);
  };
  const keyBefore = await publicKey();
  await expect(place(binding)).resolves.toBeUndefined();
  expect(await bothFolders()).toEqual(before);
  expect(await publicKey()).toBe(keyBefore);
  await expectPlacedLayout();
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
});

const anotherRing = () => {
  const ring = generateKeyRing();
  return `WAITRON_CREDENTIALS_KEY=${ring.key}\nWAITRON_CREDENTIALS_KEY_VERSION=${ring.version}\n`;
};

it.each([
  {
    change: "secrets.env holds another ring",
    apply: () => writeFile(join(stateDir, "secrets.env"), anotherRing()),
    code: "emergency_copy.placed_key_unopenable",
  },
  {
    change: "secrets.env is gone",
    apply: () => rm(join(stateDir, "secrets.env")),
    code: "emergency_copy.placed_key_unopenable",
  },
  {
    change: "trading.env is gone",
    apply: () => rm(join(stateDir, "trading.env")),
    code: "emergency_copy.trading_env_missing",
  },
  {
    change: "trading.env names another environment",
    apply: () => writeFile(join(stateDir, "trading.env"), keptTrading("WAITRON_ENV=production\n")),
    code: "emergency_copy.trading_environment_differs",
  },
  {
    change: "trading.env sets the vault key",
    apply: () => writeFile(join(stateDir, "trading.env"), keptTrading(anotherRing())),
    code: "emergency_copy.vault_key_in_trading_env",
  },
])("refuses a repeat once $change, writing nothing", async ({ apply, code }) => {
  const binding = await placedBinding();
  await place(binding);
  await apply();
  const before = await bothFolders();
  await expect(place(binding)).rejects.toMatchObject({ code });
  expect(await bothFolders()).toEqual(before);
});

it("a retry after a stop between writing the env files and the move places the copy", async () => {
  const binding = await placedBinding();
  // As the stopped placement left them: its ring and trading.env saved, its node.db half made.
  const stoppedRing = generateKeyRing();
  await writeCredentialsRing(stateDir, { key: stoppedRing.key, version: stoppedRing.version });
  await writeTradingEnv(stateDir, { nodeId: copyId, environment: "preproduction" });
  const stale = join(stateDir, "scratch", "emergency-copy-stale");
  await mkdir(stale, { recursive: true });
  await writeFile(join(stale, NODE_FILE), "half made");
  const trading = await readFile(join(stateDir, "trading.env"));

  await place(binding);

  expect(await placedKey()).toEqual(expect.any(String));
  expect(await readFile(join(stateDir, "trading.env"))).toEqual(trading);
  expect(await listing(venueDir)).toEqual(["node.db", "venue.db", "venue.lock"]);
  expect(await listing(join(stateDir, "scratch"))).toEqual(["emergency-copy-stale"]);
  expect(sha(venuePath)).toBe(binding.selectedStream.databaseSha256);
  await expect(place(binding)).resolves.toBeUndefined();
});

it("refuses another binding once a copy is placed, writing nothing", async () => {
  const binding = await placedBinding();
  await place(binding);
  const before = await bothFolders();
  await expect(
    place({ ...binding, copyOperationId: "e7000000-0000-4000-8000-0000000000ee" }),
  ).rejects.toMatchObject({ code: "emergency_copy.other_binding_placed" });
  expect(await bothFolders()).toEqual(before);
});

/** A clock that reads `at` once the copy's chain check, the check's last step, has run. */
function clockMovedByTheCheck(at: string) {
  let time = beforeExpiry();
  const module = {
    ...fakeSetlessModule("test-chain", "core"),
    handover: {
      summarise: async () => null,
      checkCopy: async () => {
        time = new Date(at);
        return "ok" as const;
      },
    },
  };
  return { modules: [module], now: () => time };
}

it("refuses a binding that expires while the checks run, writing nothing", async () => {
  const binding = await placedBinding();
  const before = await bothFolders();
  await expect(place(binding, {}, clockMovedByTheCheck(binding.expiresAt))).rejects.toMatchObject({
    code: "emergency_copy.binding_expired",
    params: { expiresAt: binding.expiresAt },
  });
  expect(await bothFolders()).toEqual(withLockTaken(before));
});

it("places a binding the checks finish a moment before it expires", async () => {
  const binding = await placedBinding();
  await place(binding, {}, clockMovedByTheCheck("2026-11-17T10:29:59.999Z"));
  expect(existsSync(join(venueDir, NODE_FILE))).toBe(true);
});

it("places node.db when the state folder and the venue folder are on different filesystems", async () => {
  const binding = await placedBinding();
  faults.separateFilesystems = [stateDir, venueDir];
  await place(binding);
  expect(await placedKey()).toEqual(expect.any(String));
  await expectPlacedLayout();
});

it("replaces a half-copied node.db a stopped placement left in the venue folder", async () => {
  const binding = await placedBinding();
  await writeFile(join(venueDir, `${NODE_FILE}${INCOMING_SUFFIX}`), "half copied");
  await place(binding);
  expect(await placedKey()).toEqual(expect.any(String));
  await expectPlacedLayout();
});

it("copies node.db in past a link left at its incoming name, leaving the venue file alone", async () => {
  const binding = await placedBinding();
  const venueBytes = await readFile(join(venueDir, VENUE_FILE));
  await symlink(join(venueDir, VENUE_FILE), join(venueDir, `${NODE_FILE}${INCOMING_SUFFIX}`));
  await place(binding);
  expect(await readFile(join(venueDir, VENUE_FILE))).toEqual(venueBytes);
  expect(lstatSync(join(venueDir, NODE_FILE)).isFile()).toBe(true);
  expect(await placedKey()).toEqual(expect.any(String));
  await expectPlacedLayout();
});

it("writes nothing when the signal aborts as the checks finish", async () => {
  const binding = await placedBinding();
  const before = await bothFolders();
  const controller = new AbortController();
  const stopped = new Error("stopped");
  const now = () => {
    controller.abort(stopped);
    return beforeExpiry();
  };
  await expect(place(binding, {}, { signal: controller.signal, now })).rejects.toBe(stopped);
  expect(await bothFolders()).toEqual(withLockTaken(before));
});

it("throws rather than place when this machine's clock is not a time, writing nothing", async () => {
  const binding = await placedBinding();
  const before = await bothFolders();
  await expect(place(binding, {}, { now: () => new Date(Number.NaN) })).rejects.toThrow(TypeError);
  expect(await bothFolders()).toEqual(withLockTaken(before));
});

/**
 * Starts a placement of `second` once a placement of `first` has saved its ring and is held before
 * it moves its node.db, then lets the first carry on. `checksBeforeRelease` counts the placed-copy
 * checks begun by the time the first is released: only the first's own when the second waits its
 * turn.
 */
async function overlapping(first: EmergencyCopyBinding, second: EmergencyCopyBinding) {
  let firstSaved!: () => void;
  let releaseFirst!: () => void;
  const saved = new Promise<void>((resolve) => (firstSaved = resolve));
  const released = new Promise<void>((resolve) => (releaseFirst = resolve));
  let rings = 0;
  faults.afterRingSaved = async () => {
    if (++rings !== 1) return;
    firstSaved();
    await released;
  };
  const placing = place(first);
  try {
    await Promise.race([saved, placing]);
    const later = place(second);
    await Promise.race([later.catch(() => {}), delay(1000)]);
    const checksBeforeRelease = faults.checksBegun;
    releaseFirst();
    return { checksBeforeRelease, outcomes: await Promise.allSettled([placing, later]) };
  } finally {
    releaseFirst();
    await placing.catch(() => {});
  }
}

it("two overlapping placements of the same binding leave a key the saved ring opens", async () => {
  const binding = await placedBinding();
  const { checksBeforeRelease, outcomes } = await overlapping(binding, binding);
  expect(checksBeforeRelease).toBe(1);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
  expect(await placedKey()).toEqual(expect.any(String));
  await expectPlacedLayout();
  await expect(place(binding)).resolves.toBeUndefined();
});

it("of two overlapping placements of different bindings, the second is refused and the first's key opens", async () => {
  const binding = await placedBinding();
  const other = { ...binding, copyOperationId: "e7000000-0000-4000-8000-0000000000ee" };
  const {
    checksBeforeRelease,
    outcomes: [first, second],
  } = await overlapping(binding, other);
  expect(checksBeforeRelease).toBe(1);
  expect(first!.status).toBe("fulfilled");
  expect(second).toMatchObject({
    status: "rejected",
    reason: { code: "emergency_copy.other_binding_placed" },
  });
  expect(await readPlacedNode((node) => readPlacedEmergencyCopy(node))).toEqual(binding);
  expect(await placedKey()).toEqual(expect.any(String));
  await expectPlacedLayout();
});

describe("an unactivated placed copy", () => {
  const UNACTIVATED = { code: "node.emergency_copy_unactivated" };
  const refusal = (nodeId: string | undefined) =>
    readPlacedNode((node) => refuseUnactivatedEmergencyCopy(node, nodeId));

  async function activate(): Promise<void> {
    const store = await openVenueDatabase(venueDir);
    try {
      await withNodeTransaction(store.node, (tx) =>
        setNodeModeTx(tx, copyId, "primary", "emergency_copy"),
      );
    } finally {
      await store.close();
    }
  }

  it("passes a node.db that records no placed copy", async () => {
    await expect(refuseUnactivatedEmergencyCopy(suite.node, sourceId)).resolves.toBeUndefined();
  });

  it("passes a node.db that has no handover events table yet, as a new box's has before migrations", async () => {
    const raw = new DatabaseSync(join(venueDir, NODE_FILE));
    raw.exec("create table unrelated (a)");
    raw.close();
    await expect(refusal(sourceId)).resolves.toBeUndefined();
  });

  it.each([
    ["the source's", sourceId],
    ["the copy's own", copyId],
    ["no", undefined],
  ])("refuses a copy still a mirror under %s id", async (_name, nodeId) => {
    await place(await placedBinding());
    await expect(refusal(nodeId)).rejects.toMatchObject(UNACTIVATED);
  });

  it.each([
    ["the source's", sourceId],
    ["no", undefined],
  ])("refuses an activated copy started under %s id", async (_name, nodeId) => {
    await place(await placedBinding());
    await activate();
    await expect(refusal(nodeId)).rejects.toMatchObject(UNACTIVATED);
  });

  it("passes an activated copy started under its own id", async () => {
    await place(await placedBinding());
    await activate();
    await expect(refusal(copyId)).resolves.toBeUndefined();
  });
});
