import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import * as provision from "./index.js";
import type { BackupRepairRecord } from "./first-setup-backup-workspace.js";

const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const HOLD = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("pragma busy_timeout = 0");
db.exec("begin immediate");
process.stdout.write("held");
setInterval(() => db, 1000);`;

function holdFromAnotherProcess(directory: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", HOLD, join(directory, "venue.lock")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  return new Promise((resolve, reject) => {
    let err = "";
    child.stderr!.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve(child);
    });
    child.on("exit", (code) => reject(new Error(`holder exited early (${code}): ${err}`)));
  });
}

const NAMESPACE = join("first-setup-resolutions", "backup-recovery");
const recoveryId = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
const laterId = "0d2b6b62-4a3e-4a4f-9b56-6a0f1f7d1c11";
const MUST_STAY = ["venue.lock", "migrations.lock"];
const KEPT = /^((venue|migrations|recovery)\.lock(-journal)?|venue\.holder\.json(\.partial)?)$/;
// Taking a venue lock writes these and its release deletes them, whoever asks for the lock.
const LOCK_OWNED = /^(venue\.holder\.json|venue\.lock-journal)/;

async function journal(shared = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "backup-discard-")));
  directories.push(root);
  const anchor = {
    venueDir: join(root, "venue"),
    stateDir: join(root, shared ? "venue" : "state"),
  };
  for (const path of new Set(Object.values(anchor))) await mkdir(path);
  await writeFile(join(anchor.stateDir, "first-setup.json"), "opaque malformed original");
  await writeFile(join(anchor.venueDir, "venue.db"), "unchanged database bytes");
  (await lockVenueDatabase(anchor.venueDir)).release();
  const base = join(anchor.stateDir, NAMESPACE, recoveryId);
  const target = {
    recoveryId,
    anchor,
    source: anchor,
    target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
    generation: 1,
  };
  const store = provision.createFirstSetupBackupWorkspace(anchor);
  const input: Omit<
    BackupRepairRecord,
    "version" | "sequence" | "previousRecordDigest" | "recordedAt"
  > = {
    target,
    observation: {
      inspectionId: "a".repeat(64),
      revision: null,
      ownerGeneration: null,
      originalsDigest: await store.inspect(recoveryId),
    },
    sourceId: "b".repeat(64),
    activationSourceId: "c".repeat(64),
    binding: {
      module: "synthetic",
      action: "restore",
      eventId: "4cc6a357-e31c-4c2e-9b40-023c9963bec8",
      sourceId: "c".repeat(64),
      targetNodeId: "47d5be37-2011-4afc-bdc8-46b5cb238deb",
    },
    input: null,
    retainedEvidenceDigest: "d".repeat(64),
    phase: "prepared",
  };
  await store.append(input);
  await store.append({ ...input, input: { accepted: true }, phase: "placement-started" });
  const venue = target.target.venueDir,
    state = target.target.stateDir;
  for (const name of ["venue.db", "venue.db-wal", "node.db"])
    await writeFile(join(venue, name), `restored ${name}`);
  (await lockVenueDatabase(venue)).release();
  await writeFile(join(venue, "venue.lock-journal"), "");
  await writeFile(join(venue, "venue.holder.json"), "{}");
  await writeFile(join(venue, "venue.holder.json.partial"), "{");
  await writeFile(join(venue, "migrations.lock"), "");
  await mkdir(join(state, "secrets"), { recursive: true });
  await writeFile(join(state, "secrets", "recovery-key.bin"), "secret");
  await writeFile(join(state, "first-setup.json"), "restored attempt");
  await writeFile(join(base, "publication.json"), "{}");
  expect(await exists(join(base, "evidence", "0.bin"))).toBe(true);
  await mkdir(join(base, "cloud"));
  await writeFile(join(base, "cloud", "cloud-recovery.json"), "{}");
  return { root, anchor, base, venue, state, store, input };
}
async function abandoned(shared = false) {
  const f = await journal(shared);
  await f.store.abandon(recoveryId);
  return f;
}
async function tree(path: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (LOCK_OWNED.test(entry.name)) continue;
      const full = join(directory, entry.name);
      out.push(relative(path, full));
      if (entry.isDirectory()) await walk(full);
    }
  }
  await walk(path);
  return out.sort();
}
const venuePointer = (f: { anchor: { venueDir: string } }) =>
  join(f.anchor.venueDir, NAMESPACE, "current.json");
const statePointer = (f: { anchor: { stateDir: string } }) =>
  join(f.anchor.stateDir, NAMESPACE, "current.json");
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
async function onlyKeepSet(f: Awaited<ReturnType<typeof journal>>) {
  const left = await tree(f.base);
  const records = left.filter((name) => /^\d+\.json$/.test(name));
  expect(records.length).toBeGreaterThan(0);
  const target = left.filter((name) => !records.includes(name));
  for (const name of MUST_STAY) expect(target).toContain(join("target", "venue", name));
  expect(
    target.filter(
      (name) =>
        !["target", join("target", "venue")].includes(name) &&
        !(name.startsWith(join("target", "venue") + "/") && KEPT.test(basename(name))),
    ),
  ).toEqual([]);
}

it("empties an abandoned recovery down to its records and its lock files, and reads as emptied", async () => {
  const f = await abandoned();
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(false);
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  await onlyKeepSet(f);
  expect(await exists(join(f.venue, "migrations.lock"))).toBe(true);
  expect(await exists(venuePointer(f))).toBe(false);
  expect(await exists(join(f.anchor.venueDir, "first-setup-resolutions"))).toBe(false);
  expect(await exists(statePointer(f))).toBe(true);
  expect((await f.store.read()).at(-1)!.phase).toBe("abandoned");
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
});

it("never asks to remove a record or a file the keep set names", async () => {
  const f = await abandoned();
  for (const name of ["venue.holder.json", "recovery.lock"])
    await writeFile(join(f.venue, name), "{}");
  const removed: string[] = [];
  await provision.emptyAbandonedBackupRecovery(
    f.anchor,
    recoveryId,
    lockVenueDatabase,
    async (path, kind) => {
      removed.push(path);
      await (kind === "file" ? unlink(path) : rmdir(path));
    },
  );
  expect(removed).toContain(join(f.venue, "venue.db"));
  expect(removed).toContain(venuePointer(f));
  expect(
    removed.filter(
      (path) =>
        (path.startsWith(join(f.base, "target")) && KEPT.test(basename(path))) ||
        (path.startsWith(f.base) && /^\d+\.json$/.test(basename(path)) && dirname(path) === f.base),
    ),
  ).toEqual([]);
});

it("keeps venue.lock and migrations.lock as the same files, never deleted and made again", async () => {
  const f = await abandoned();
  const before = await Promise.all(
    ["venue.lock", "migrations.lock"].map((name) => stat(join(f.venue, name))),
  );
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  const after = await Promise.all(
    ["venue.lock", "migrations.lock"].map((name) => stat(join(f.venue, name))),
  );
  expect(after.map(({ ino, birthtimeMs }) => ({ ino, birthtimeMs }))).toEqual(
    before.map(({ ino, birthtimeMs }) => ({ ino, birthtimeMs })),
  );
});

it.each(["target", "box"] as const)(
  "deletes nothing while another process holds the %s's venue folder",
  async (holder) => {
    const f = await abandoned();
    await holdFromAnotherProcess(holder === "box" ? f.anchor.venueDir : f.venue);
    const before = { venue: await tree(f.anchor.venueDir), state: await tree(f.anchor.stateDir) };
    await expect(
      provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId),
    ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
    expect({ venue: await tree(f.anchor.venueDir), state: await tree(f.anchor.stateDir) }).toEqual(
      before,
    );
    expect(await exists(venuePointer(f))).toBe(true);
  },
);

it("throws a lock's own failure unchanged and deletes nothing", async () => {
  const f = await abandoned();
  const before = { venue: await tree(f.anchor.venueDir), state: await tree(f.anchor.stateDir) };
  const failure = Object.assign(new Error("unable to open database file"), { errcode: 14 });
  const calls: string[] = [];
  await expect(
    provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId, async (directory) => {
      calls.push(directory);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(calls).toEqual([f.anchor.venueDir]);
  expect({ venue: await tree(f.anchor.venueDir), state: await tree(f.anchor.stateDir) }).toEqual(
    before,
  );
});

it("takes the box's lock and then the target's, and lets them go in reverse order", async () => {
  const f = await abandoned();
  const events: string[] = [];
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId, async (directory) => {
    const hold = await lockVenueDatabase(directory);
    events.push(`take ${directory}`);
    return {
      release: () => {
        events.push(`release ${directory}`);
        hold.release();
      },
    };
  });
  expect(events).toEqual([
    `take ${f.anchor.venueDir}`,
    `take ${f.venue}`,
    `release ${f.venue}`,
    `release ${f.anchor.venueDir}`,
  ]);
});

it("never empties a journal that is not abandoned, or a recovery the journal does not name", async () => {
  const f = await journal();
  const before = await tree(f.root);
  await expect(provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await f.store.abandon(recoveryId);
  await expect(provision.emptyAbandonedBackupRecovery(f.anchor, laterId)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  const after = await tree(f.root);
  expect(after.filter((name) => !before.includes(name))).toEqual([
    join("state", NAMESPACE, recoveryId, "000003.json"),
  ]);
  expect(before.filter((name) => !after.includes(name))).toEqual([]);
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(false);
});

it("refuses a recovery with no journal at all", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "backup-discard-")));
  directories.push(root);
  const anchor = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(anchor)) await mkdir(path);
  await expect(provision.emptyAbandonedBackupRecovery(anchor, recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await provision.isEmptiedTombstone(anchor, recoveryId)).toBe(false);
  for (const call of [provision.emptyAbandonedBackupRecovery, provision.isEmptiedTombstone])
    await expect(call(anchor, "not-a-uuid")).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  await writeFile(join(elsewhere, "000001.json"), "{}");
  await mkdir(join(anchor.stateDir, NAMESPACE), { recursive: true });
  await symlink(elsewhere, join(anchor.stateDir, NAMESPACE, recoveryId));
  await expect(provision.isEmptiedTombstone(anchor, recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it.each([
  [
    "a symlink",
    (f: Awaited<ReturnType<typeof journal>>) => symlink(f.anchor.venueDir, join(f.state, "linked")),
  ],
  [
    "a symlink named like a lock",
    (f: Awaited<ReturnType<typeof journal>>) =>
      symlink(join(f.venue, "venue.db"), join(f.venue, "recovery.lock")),
  ],
])("refuses %s and deletes nothing", async (_name, plant) => {
  const f = await abandoned();
  await plant(f);
  const before = await tree(f.root);
  await expect(provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(await tree(f.root)).toEqual(before);
  await expect(provision.isEmptiedTombstone(f.anchor, recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("is safe to run twice", async () => {
  const f = await abandoned();
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  const once = await tree(f.root);
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  expect(await tree(f.root)).toEqual(once);
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
});

it("finishes on a second run after a cut at each removal", async () => {
  const finished = await abandoned();
  await provision.emptyAbandonedBackupRecovery(finished.anchor, recoveryId);
  const expected = await tree(finished.root);
  for (let cut = 0; ; cut++) {
    const f = await abandoned();
    let calls = 0;
    const result = await provision
      .emptyAbandonedBackupRecovery(f.anchor, recoveryId, lockVenueDatabase, async (path, kind) => {
        if (calls++ === cut) throw Object.assign(new Error("cut"), { code: "EIO" });
        await (kind === "file" ? unlink(path) : rmdir(path));
      })
      .then(
        () => "done",
        (error: unknown) => error,
      );
    if (result === "done") {
      expect(cut).toBeGreaterThan(10);
      break;
    }
    expect(result).toMatchObject({ message: "cut" });
    await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
    expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
    expect(await tree(f.root)).toEqual(expected);
  }
});

it("reads a recovery whose folder is emptied but whose venue pointer remains as not yet emptied, and a second run finishes it", async () => {
  const f = await abandoned();
  let cut = false;
  await expect(
    provision.emptyAbandonedBackupRecovery(
      f.anchor,
      recoveryId,
      lockVenueDatabase,
      async (path, kind) => {
        if (path === venuePointer(f)) {
          cut = true;
          throw new Error("cut before the pointer");
        }
        await (kind === "file" ? unlink(path) : rmdir(path));
      },
    ),
  ).rejects.toThrow("cut before the pointer");
  expect(cut).toBe(true);
  await onlyKeepSet(f);
  expect(await exists(venuePointer(f))).toBe(true);
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(false);
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  expect(await exists(venuePointer(f))).toBe(false);
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
});

it("still reads an older tombstone as emptied once a later recovery's pointer replaced its own", async () => {
  const f = await abandoned();
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  const pointer = JSON.parse(await readFile(statePointer(f), "utf8")) as {
    target: { recoveryId: string };
  };
  pointer.target.recoveryId = laterId;
  await mkdir(join(f.anchor.venueDir, NAMESPACE), { recursive: true });
  await writeFile(venuePointer(f), JSON.stringify(pointer));
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
  pointer.target.recoveryId = recoveryId;
  await writeFile(venuePointer(f), JSON.stringify(pointer));
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(false);
  for (const unreadable of [{}, { target: null }, { target: { recoveryId: "not-a-uuid" } }]) {
    await writeFile(venuePointer(f), JSON.stringify(unreadable));
    expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(false);
  }
});

it("empties a file whose name only begins with a lock file's name, and keeps the lock", async () => {
  const f = await abandoned();
  await writeFile(join(f.venue, "venue.lock.db"), "restored database");
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  expect(await exists(join(f.venue, "venue.lock.db"))).toBe(false);
  expect(await exists(join(f.venue, "venue.lock"))).toBe(true);
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
});

it("reads a recovery as emptied while its target holds a held lock's journal and a holder's half-written file", async () => {
  const f = await abandoned();
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  for (const name of ["venue.lock-journal", "migrations.lock-journal", "venue.holder.json.partial"])
    await writeFile(join(f.venue, name), "");
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
});

it("reads a folder that still holds anything outside the keep set as not emptied", async () => {
  const f = await abandoned();
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  await writeFile(join(f.venue, "venue.db"), "back again");
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(false);
  await rm(join(f.venue, "venue.db"));
  await mkdir(join(f.base, "evidence"));
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(false);
});

it("empties a recovery whose venue and state folders are one folder, keeping the one pointer", async () => {
  const f = await abandoned(true);
  await provision.emptyAbandonedBackupRecovery(f.anchor, recoveryId);
  await onlyKeepSet(f);
  expect(await exists(statePointer(f))).toBe(true);
  expect((await f.store.read()).at(-1)!.phase).toBe("abandoned");
  expect(await provision.isEmptiedTombstone(f.anchor, recoveryId)).toBe(true);
});
