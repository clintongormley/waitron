import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openVenueDatabase, type VenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { makeMasterKey } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SCRATCH_DIR } from "@waitron/store";
import { createPasswordThrottle } from "./password-throttle.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { packArchive } from "./backup-archive.js";
import { backupArchiveKey } from "./backup-keys.js";
import { buildManifest } from "./backup-manifest.js";
import { createHostPlaces } from "./box-host-api.js";
import type { BoxHostRequests } from "./box-host-client.js";
import { resolveDriveFile } from "./drive-backup-files.js";
import { stageBackupAsCopy } from "./handover-copy-from-backup.js";
import { readStagedCopy } from "./handover-copy-selection.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { heldBackupKey } from "./testing/backup-key.js";
import { masterKeyArchiveBytes } from "./testing/master-key-archive.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import {
  ADMIN,
  ADMIN_EMAIL,
  PASSWORD,
  fiscalModules,
  standby,
  ring,
  placedSpareFixture,
} from "./testing/handover-placed-copy.js";

vi.mock("./drive-backup-files.js", { spy: true });
vi.mock("./handover-copy-from-backup.js", { spy: true });

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations });
const spareBefore = useVenueDb({ migrations });
let root: string;
let placed: VenueDatabase;
const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});
const fixture = placedSpareFixture({ mainBox, spareBefore, dirs });
const sockets: TLSSocket[] = [];
const ORIGIN = "https://spare.example";
const SIGN_IN = { email: ADMIN_EMAIL, password: PASSWORD };
const DRIVES = [{ drive: "sda1", fileSystem: "exfat", readable: true }] as const;
const masterKey = makeMasterKey();
const held = heldBackupKey(masterKey);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emergency-drives-"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  await fixture.setupBoxes();
  mainBox.db.run(sql`vacuum into ${join(dirs().spareVenue, "venue.db")}`);
  spareBefore.node.run(sql`vacuum into ${join(dirs().spareVenue, "node.db")}`);
  placed = await openVenueDatabase(dirs().spareVenue);
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await placed?.close();
  vi.useRealTimers();
  vi.mocked(resolveDriveFile).mockClear();
  vi.mocked(stageBackupAsCopy).mockClear();
  await rm(root, { recursive: true, force: true });
});

/** A backup file of the main box on a drive folder under `root`. */
async function backupOnDrive(): Promise<{ drivesRoot: string; path: string; name: string }> {
  await seedWorkingOrder(mainBox.db, { openedAt: "2026-10-16T10:30:00Z" });
  const archive = join(root, "archive.db");
  await mainBox.db.archiveTo(archive);
  const manifest = await buildManifest({
    db: mainBox.db,
    node: mainBox.node,
    modules: fiscalModules,
    environment: "preproduction",
    now: new Date(),
  });
  const bytes = masterKeyArchiveBytes(
    packArchive([
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: await readFile(archive) },
      await nodeDumpEntry(mainBox.node, root),
    ]),
    masterKey,
  );
  const drivesRoot = join(root, "drives");
  const name = backupArchiveKey(new Date("2026-10-16T11:00:00Z"), { nodeId: standby.nodeId });
  await mkdir(join(drivesRoot, "sda1", "backups"), { recursive: true });
  const path = join(drivesRoot, "sda1", "backups", name);
  await writeFile(path, bytes);
  return { drivesRoot, path, name };
}

function service(options: {
  drivesRoot?: string;
  storageList?: BoxHostRequests["storageList"];
  storageRelease?: BoxHostRequests["storageRelease"];
  restart?: () => void;
}) {
  const app = new Hono();
  const log = vi.fn();
  const host = {
    storageList: vi.fn(
      options.storageList ?? (async () => ({ available: true as const, drives: DRIVES })),
    ),
    storageRelease: vi.fn(
      options.storageRelease ?? (async () => ({ available: true as const, released: 1 })),
    ),
  };
  const places = createHostPlaces();
  mountHandoverEmergencyApi(
    app,
    {
      db: placed.venue,
      node: placed.node,
      nodeId: standby.nodeId,
      ring,
      stateDir: dirs().spareState,
      venueDir: dirs().spareVenue,
      modules: fiscalModules,
      origin: ORIGIN,
      rpId: "spare.example",
      credentialKeyRing: TOTP_KEY_RING,
      passwordThrottle: createPasswordThrottle(),
      fetch: async () => {
        throw Object.assign(new Error("synthetic transport fault"), { code: "ECONNREFUSED" });
      },
      backup: {
        readBackupKey: async () => held,
        environment: "preproduction",
        migrationsRoot: null,
        restart: options.restart ?? vi.fn(),
        uploadLimit: 1,
      },
      drives: {
        requests: host,
        places,
        ...(options.drivesRoot === undefined ? {} : { root: options.drivesRoot }),
      },
    },
    log,
  );
  const post = async (step: string, body: unknown, https = true) => {
    const socket = new TLSSocket(new Socket());
    sockets.push(socket);
    const response = await app.request(
      `${ORIGIN}/api/node/handover/emergency/${step}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      https ? { incoming: { socket } } : {},
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  return { post, host, places, log };
}

it("the switch's drive list needs a node.manage sign-in, checked before the host is asked", async () => {
  const { drivesRoot, name } = await backupOnDrive();
  const s = service({ drivesRoot });
  expect((await s.post("drives", { signIn: SIGN_IN }, false)).body).toEqual({
    error: { code: "node.operation_page_required", params: {} },
  });
  expect((await s.post("drives", {})).body).toMatchObject({
    error: { code: "password.invalid" },
  });
  expect(
    (await s.post("drives", { signIn: { ...SIGN_IN, password: "wrong-password" } })).body,
  ).toMatchObject({ error: { code: "password.invalid" } });
  await setBuiltInRoleForTest(placed.venue, ADMIN, "staff");
  expect((await s.post("drives", { signIn: SIGN_IN })).body).toMatchObject({
    error: { code: "authorization.not_permitted" },
  });
  expect(s.host.storageList).not.toHaveBeenCalled();

  await setBuiltInRoleForTest(placed.venue, ADMIN, "admin");
  const listed = await s.post("drives", { signIn: SIGN_IN });
  expect([listed.status, listed.cache]).toEqual([200, "no-store"]);
  expect(listed.body).toEqual({
    drives: DRIVES,
    files: [
      {
        drive: "sda1",
        path: `backups/${name}`,
        size: expect.any(Number),
        takenAt: "2026-10-16T11:00:00.000Z",
      },
    ],
  });
  expect(s.host.storageList).toHaveBeenCalledExactlyOnceWith({ source: "server" });
  expect(s.log).toHaveBeenCalledWith("info", "handover.drives_listed", {
    personId: ADMIN,
    files: 1,
  });
});

it("a wrong sign-in on the backup route resolves no drive path", async () => {
  const { drivesRoot, name } = await backupOnDrive();
  const s = service({ drivesRoot });
  const file = { drive: "sda1", path: `backups/${name}` };
  const refused = await s.post("backup", {
    signIn: { ...SIGN_IN, password: "wrong-password" },
    file,
  });
  expect(refused.body).toMatchObject({ error: { code: "password.invalid" } });
  const unsigned = await s.post("backup", { file });
  expect(unsigned.body).toMatchObject({ error: { code: "password.invalid" } });
  expect(resolveDriveFile).not.toHaveBeenCalled();
  expect(stageBackupAsCopy).not.toHaveBeenCalled();
  expect(s.host.storageRelease).not.toHaveBeenCalled();
});

it.each([
  ["a key the route does not take", { signIn: SIGN_IN, file: {}, extra: 1 }],
  ["a body over its limit", `"${"x".repeat(1024 * 1024)}"`],
])("the backup route refuses a JSON body with %s", async (_label, body) => {
  const { drivesRoot } = await backupOnDrive();
  const s = service({ drivesRoot });
  expect((await s.post("backup", body)).body).toEqual({
    error: { code: "handover.request_invalid", params: { field: "body" } },
  });
  expect(resolveDriveFile).not.toHaveBeenCalled();
});

it("a drive path outside the drive is refused after the sign-in", async () => {
  const { drivesRoot } = await backupOnDrive();
  const s = service({ drivesRoot });
  const answer = await s.post("backup", {
    signIn: SIGN_IN,
    file: { drive: "sda1", path: "../../spare-state/x" },
  });
  expect(answer.body).toEqual({
    error: { code: "handover.request_invalid", params: { field: "file" } },
  });
  expect(stageBackupAsCopy).not.toHaveBeenCalled();
  expect(s.host.storageRelease).not.toHaveBeenCalled();
});

it("a stick pulled after the file is checked answers restore.drive_file_unreadable", async () => {
  const { drivesRoot, name } = await backupOnDrive();
  const actual =
    await vi.importActual<typeof import("./drive-backup-files.js")>("./drive-backup-files.js");
  vi.mocked(resolveDriveFile).mockImplementationOnce(async (...args) => {
    const resolved = await actual.resolveDriveFile(...args);
    await rm(resolved.path);
    return resolved;
  });
  const restart = vi.fn();
  const s = service({ drivesRoot, restart });
  const answer = await s.post("backup", {
    signIn: SIGN_IN,
    file: { drive: "sda1", path: `backups/${name}` },
  });
  expect(answer.body).toEqual({ error: { code: "restore.drive_file_unreadable", params: {} } });
  expect(vi.mocked(stageBackupAsCopy).mock.calls).toHaveLength(1);
  expect(s.host.storageRelease).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
});

it("the emergency switch reads the file in place and releases the drive after staging, before the restart", async () => {
  const { drivesRoot, path, name } = await backupOnDrive();
  const restart = vi.fn();
  const seen: { staged: boolean; restarted: boolean; scratch: string[] }[] = [];
  const s = service({
    drivesRoot,
    restart,
    storageRelease: async () => {
      seen.push({
        staged: (await readStagedCopy(dirs().spareState)) !== null,
        restarted: restart.mock.calls.length > 0,
        scratch: await readdir(join(dirs().spareState, SCRATCH_DIR)).catch(() => []),
      });
      return { available: true, released: 1 };
    },
  });
  const before = await readFile(path);
  expect(before.byteLength).toBeGreaterThan(1);
  const answer = await s.post("backup", {
    signIn: SIGN_IN,
    file: { drive: "sda1", path: `backups/${name}` },
  });
  expect([answer.status, answer.body]).toEqual([200, { restarting: true }]);
  expect(vi.mocked(stageBackupAsCopy).mock.calls).toHaveLength(1);
  expect(vi.mocked(stageBackupAsCopy).mock.calls[0]![0].artifactPath).toBe(path);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.staged).toBe(true);
  expect(seen[0]!.restarted).toBe(false);
  expect(seen[0]!.scratch.filter((entry) => entry.startsWith("handover-upload-"))).toEqual([]);
  expect(s.host.storageRelease).toHaveBeenCalledExactlyOnceWith({ source: "server" });
  await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  expect(await readFile(path)).toEqual(before);
  expect(s.log).toHaveBeenCalledWith("info", "handover.backup_from_drive", { personId: ADMIN });
});

it("the drive list answers box_host.busy while both host places are taken", async () => {
  const { drivesRoot } = await backupOnDrive();
  const s = service({ drivesRoot });
  s.places.taken = 2;
  const answer = await s.post("drives", { signIn: SIGN_IN });
  expect([answer.status, answer.body]).toEqual([
    409,
    { error: { code: "box_host.busy", params: {} } },
  ]);
  expect(s.host.storageList).not.toHaveBeenCalled();
});

it("the drive list answers the host's absence and failures by their codes", async () => {
  for (const [answer, status, error] of [
    [
      { available: false, reason: "missing", detail: "ENOENT" },
      409,
      { code: "box_host.unavailable", params: { reason: "missing", detail: "ENOENT" } },
    ],
    [
      { available: false, reason: "timeout" },
      502,
      { code: "box_host.failed", params: { reason: "timeout" } },
    ],
  ] as const) {
    const s = service({ storageList: async () => answer });
    const listed = await s.post("drives", { signIn: SIGN_IN });
    expect([listed.status, listed.body]).toEqual([status, { error }]);
  }
});
