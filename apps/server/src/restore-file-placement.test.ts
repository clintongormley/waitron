import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKUP_ROOM_NOTE_FILE } from "@waitron/provisioning";
import { encryptArtifact } from "./artifact-cipher.js";
import { type ArchiveEntry, packArchive } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";
import { restoreDatabase, restoreFromArtifact, type RestoreDeps } from "./restore.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "waitron-file-placement-"));
  roots.push(root);
  const venueDir = join(root, "venue");
  await mkdir(venueDir);
  const source = join(root, "source.db");
  await writeFile(source, "NEW-DATABASE");
  for (const suffix of ["", "-wal", "-shm"])
    await writeFile(join(venueDir, `venue.db${suffix}`), `OLD${suffix}`);
  await writeFile(join(venueDir, "venue.db.incoming"), "STALE");
  const stateDir = join(root, "state");
  await mkdir(stateDir);
  return { root, venueDir, stateDir, source, target: join(venueDir, "venue.db") };
}
const ioError = (code: string) => Object.assign(new Error(code), { code });
async function oldIntact(venueDir: string) {
  for (const suffix of ["", "-wal", "-shm"])
    expect(await readFile(join(venueDir, `venue.db${suffix}`), "utf8")).toBe(`OLD${suffix}`);
}

describe("restoreDatabase consumes a database file", () => {
  it("places a sparse file over 2 GiB without buffering it, preserves its edges and restricts its mode", async () => {
    const { source, target, venueDir, stateDir } = await fixture();
    const size = 2 ** 31 + 4096;
    await truncate(source, size);
    const fd = await open(source, "r+");
    try {
      await fd.write(Buffer.from("END"), 0, 3, size - 3);
    } finally {
      await fd.close();
    }
    await chmod(source, 0o644);
    const before = await stat(source);
    const log = vi.fn();
    expect(await restoreDatabase({ databasePath: source, venueDir, stateDir, log })).toBe(target);
    const placed = await stat(target);
    expect(placed.size).toBe(size);
    expect(placed.ino).toBe(before.ino);
    expect(placed.mode & 0o777).toBe(0o600);
    const out = await open(target, "r");
    try {
      const edge = Buffer.alloc(12);
      await out.read(edge, 0, 12, 0);
      expect(edge.toString()).toBe("NEW-DATABASE");
      const tail = Buffer.alloc(3);
      await out.read(tail, 0, 3, size - 3);
      expect(tail.toString()).toBe("END");
    } finally {
      await out.close();
    }
    await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${target}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${target}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(log).toHaveBeenCalledWith("info", "restore.db.placed", { bytes: size });
  });

  it("copies only on EXDEV and retains the source for its owner to clean", async () => {
    const { source, target, venueDir, stateDir } = await fixture();
    const fs = {
      rm,
      rmdir,
      rename: async (from: string, to: string) => {
        if (from === source) throw ioError("EXDEV");
        await rename(from, to);
      },
    };
    await restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {}, fs });
    expect(await readFile(target, "utf8")).toBe("NEW-DATABASE");
    expect(await readFile(source, "utf8")).toBe("NEW-DATABASE");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it.each(["rename", "copy", "source-mode", "incoming-mode"] as const)(
    "a %s failure keeps the old set and removes partial incoming",
    async (step) => {
      const { source, target, venueDir, stateDir } = await fixture();
      const fs = {
        rm,
        rmdir,
        rename: async (from: string, to: string) => {
          if (from === source && step === "rename") throw ioError("EACCES");
          if (from === source && (step === "copy" || step === "incoming-mode"))
            throw ioError("EXDEV");
          await rename(from, to);
        },
        copyFile: async (from: string, to: string) => {
          if (step === "copy") {
            await writeFile(to, "PARTIAL");
            throw ioError("ENOSPC");
          }
          await copyFile(from, to);
        },
        chmod: async (path: string, mode: number) => {
          if (
            (step === "source-mode" && path === source) ||
            (step === "incoming-mode" && path === `${target}.incoming`)
          )
            throw ioError("EPERM");
          await chmod(path, mode);
        },
      };
      await expect(
        restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {}, fs }),
      ).rejects.toMatchObject({
        code: {
          rename: "EACCES",
          copy: "ENOSPC",
          "source-mode": "EPERM",
          "incoming-mode": "EPERM",
        }[step],
      });
      await oldIntact(venueDir);
      await expect(stat(`${target}.incoming`)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(source, "utf8")).toBe("NEW-DATABASE");
    },
  );

  it("puts the old sidecar set back when final placement fails", async () => {
    const { source, target, venueDir, stateDir } = await fixture();
    await expect(
      restoreDatabase({
        databasePath: source,
        venueDir,
        stateDir,
        log: () => {},
        fs: {
          rm,
          rmdir,
          copyFile,
          chmod,
          rename: async (from, to) => {
            if (from === `${target}.incoming`) throw ioError("EIO");
            await rename(from, to);
          },
        },
      }),
    ).rejects.toMatchObject({ code: "restore.placement_failed", params: { kept: "previous" } });
    await oldIntact(venueDir);
    await expect(stat(`${target}.incoming`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "venue.db",
    "venue.db.incoming",
    "venue.db-wal",
    "venue.db-shm",
    "node.db",
    "venue.lock",
    "migrations.lock",
  ])("refuses a source alias to %s before clearing incoming", async (name) => {
    const { root, source, target, venueDir, stateDir } = await fixture();
    const protectedPath = join(venueDir, name);
    if (!["venue.db", "venue.db.incoming", "venue.db-wal", "venue.db-shm"].includes(name))
      await writeFile(protectedPath, "KEEP");
    await rm(source);
    await link(protectedPath, source);
    await expect(
      restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {} }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    await oldIntact(venueDir);
    expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
    await rm(source);
    expect((await stat(protectedPath)).nlink).toBe(1);
    const alias = join(root, "venue-alias");
    await symlink(venueDir, alias);
    await expect(
      restoreDatabase({ databasePath: join(alias, name), venueDir, stateDir, log: () => {} }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
  });

  it.each([".venue.db-litestream", ".venue.db-replaced-probe"])(
    "refuses a source under %s before its cleanup",
    async (folder) => {
      const { source, target, venueDir, stateDir } = await fixture();
      const directory = join(venueDir, folder);
      await mkdir(directory);
      const databasePath = join(directory, "copy.db");
      await copyFile(source, databasePath);
      await expect(
        restoreDatabase({ databasePath, venueDir, stateDir, log: () => {} }),
      ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
      await oldIntact(venueDir);
      expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
      expect(await readFile(databasePath, "utf8")).toBe("NEW-DATABASE");
    },
  );

  it("refuses a multiply linked source without changing either link or the old set", async () => {
    const { root, source, target, venueDir, stateDir } = await fixture();
    const retained = join(root, "retained.db");
    await chmod(source, 0o644);
    await link(source, retained);
    await expect(
      restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {} }),
    ).rejects.toMatchObject({ code: "restore.unsafe_entry_path" });
    await oldIntact(venueDir);
    expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
    expect(await readFile(source, "utf8")).toBe("NEW-DATABASE");
    expect(await readFile(retained, "utf8")).toBe("NEW-DATABASE");
    expect((await stat(source)).mode & 0o777).toBe(0o644);
    expect((await stat(retained)).mode & 0o777).toBe(0o644);
  });

  it.each(["symlink", "directory", "missing"])(
    "refuses a %s source with the old set and incoming intact",
    async (kind) => {
      const { source, target, venueDir, stateDir } = await fixture();
      await rm(source);
      if (kind === "symlink") await symlink(target, source);
      if (kind === "directory") await mkdir(source);
      await expect(
        restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {} }),
      ).rejects.toMatchObject({
        code: "restore.unsafe_entry_path",
      });
      await oldIntact(venueDir);
      expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
    },
  );

  it("deletes the backup room note", async () => {
    const { source, venueDir, stateDir } = await fixture();
    await writeFile(join(stateDir, BACKUP_ROOM_NOTE_FILE), "{}");
    await restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {} });
    await expect(stat(join(stateDir, BACKUP_ROOM_NOTE_FILE))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops before touching the old set when the note cannot be deleted", async () => {
    const { source, target, venueDir, stateDir } = await fixture();
    await mkdir(join(stateDir, BACKUP_ROOM_NOTE_FILE));
    await expect(
      restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {} }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(EISDIR|EPERM)$/) });
    await oldIntact(venueDir);
    expect(await readFile(`${target}.incoming`, "utf8")).toBe("STALE");
    expect(await readFile(source, "utf8")).toBe("NEW-DATABASE");
  });
});

/** A real SQLite file holding one `node_mode` row for `nodeId`, as node.db would. */
function nodeFile(path: string, nodeId: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("create table node_mode (node_id text primary key)");
    database.prepare("insert into node_mode (node_id) values (?)").run(nodeId);
  } finally {
    database.close();
  }
}
function nodeIdsIn(path: string): unknown[] {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database
      .prepare("select node_id from node_mode")
      .all()
      .map((row) => row.node_id);
  } finally {
    database.close();
  }
}
async function nodeFixture() {
  const placement = await fixture();
  nodeFile(join(placement.venueDir, "node.db"), "NEW");
  await writeFile(join(placement.venueDir, "node.db-wal"), "");
  const archived = join(placement.root, "archived-node.db");
  nodeFile(archived, "OLD");
  return { ...placement, nodeDump: await readFile(archived) };
}

describe("restoreDatabase puts a backup's node.db back", () => {
  it("places the archive's node.dump as node.db and sets the box's own aside", async () => {
    const { source, venueDir, stateDir, nodeDump } = await nodeFixture();
    const asides: string[] = [];
    const fs = {
      rename,
      rmdir,
      rm: async (path: string, options: { recursive?: boolean; force: boolean }) => {
        // Keep the set-aside folder, so the test can read what was set aside.
        if (path.includes(".venue.db-replaced-")) {
          asides.push(path);
          throw ioError("EBUSY");
        }
        await rm(path, options);
      },
    };
    await restoreDatabase({
      databasePath: source,
      venueDir,
      stateDir,
      log: () => {},
      fs,
      nodeDump,
    });
    expect(nodeIdsIn(join(venueDir, "node.db"))).toEqual(["OLD"]);
    await expect(stat(join(venueDir, "node.db-wal"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(venueDir, "node.db.incoming"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await stat(join(venueDir, "node.db"))).mode & 0o777).toBe(0o600);
    expect(asides).toHaveLength(1);
    expect(nodeIdsIn(join(asides[0]!, "node.db"))).toEqual(["NEW"]);
    expect(await readFile(join(asides[0]!, "venue.db"), "utf8")).toBe("OLD");
  });

  it("puts the box's own node.db back when the final placement fails", async () => {
    const { source, target, venueDir, stateDir, nodeDump } = await nodeFixture();
    await expect(
      restoreDatabase({
        databasePath: source,
        venueDir,
        stateDir,
        log: () => {},
        nodeDump,
        fs: {
          rm,
          rmdir,
          rename: async (from, to) => {
            if (from === `${target}.incoming`) throw ioError("EIO");
            await rename(from, to);
          },
        },
      }),
    ).rejects.toMatchObject({ code: "restore.placement_failed", params: { kept: "previous" } });
    await oldIntact(venueDir);
    expect(nodeIdsIn(join(venueDir, "node.db"))).toEqual(["NEW"]);
    await expect(stat(join(venueDir, "node.db.incoming"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("leaves no node.db behind when a target that had none fails its final placement", async () => {
    const { source, target, venueDir, stateDir, nodeDump } = await nodeFixture();
    await rm(join(venueDir, "node.db"));
    await rm(join(venueDir, "node.db-wal"));
    await expect(
      restoreDatabase({
        databasePath: source,
        venueDir,
        stateDir,
        log: () => {},
        nodeDump,
        fs: {
          rm,
          rmdir,
          rename: async (from, to) => {
            if (from === `${target}.incoming`) throw ioError("EIO");
            await rename(from, to);
          },
        },
      }),
    ).rejects.toMatchObject({ code: "restore.placement_failed", params: { kept: "previous" } });
    await oldIntact(venueDir);
    await expect(stat(join(venueDir, "node.db"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(venueDir, "node.db.incoming"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("places node.db before venue.db", async () => {
    const { source, target, venueDir, stateDir, nodeDump } = await nodeFixture();
    const placed: string[] = [];
    await restoreDatabase({
      databasePath: source,
      venueDir,
      stateDir,
      log: () => {},
      nodeDump,
      fs: {
        rm,
        rmdir,
        rename: async (from, to) => {
          if (to === target || to === join(venueDir, "node.db")) placed.push(to);
          await rename(from, to);
        },
      },
    });
    expect(placed).toEqual([join(venueDir, "node.db"), target]);
  });

  it("leaves the box's own node.db alone when handed no node copy", async () => {
    const { source, venueDir, stateDir } = await nodeFixture();
    await restoreDatabase({ databasePath: source, venueDir, stateDir, log: () => {} });
    expect(nodeIdsIn(join(venueDir, "node.db"))).toEqual(["NEW"]);
  });
});

describe("a restore from an archive and the node copy", () => {
  const MANIFEST: BackupManifest = {
    manifestVersion: 1,
    createdAt: "2026-09-05T00:00:00.000Z",
    environment: "preproduction",
    modules: {},
  };
  const KEY = "correct horse battery staple";
  function artifact(entries: ArchiveEntry[]): Uint8Array {
    return encryptArtifact(
      packArchive([
        { name: "manifest.json", bytes: Buffer.from(JSON.stringify(MANIFEST)) },
        ...entries,
      ]),
      KEY,
    );
  }
  async function restoreFixture() {
    const placement = await nodeFixture();
    const stagingDir = join(placement.root, "staging");
    const secrets: ArchiveEntry[] = [
      { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_VAULT_MASTER_KEY=deadbeef\n") },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from("WAITRON_NODE_ID=c0000000-0000-4000-8000-000000000003\n"),
      },
    ];
    const deps = (entries: ArchiveEntry[], overrides: Partial<RestoreDeps> = {}): RestoreDeps => ({
      artifact: artifact(entries),
      recoveryKey: KEY,
      venueDir: placement.venueDir,
      stateDir: placement.stateDir,
      stagingDir,
      migrationsRoot: null,
      modules: ALL_MODULES,
      environment: "preproduction",
      migrate: vi.fn(async () => {}),
      log: () => {},
      ...overrides,
    });
    const dump: ArchiveEntry = { name: "db.dump", bytes: Buffer.from("NEW-DATABASE") };
    const node: ArchiveEntry = { name: "node.dump", bytes: placement.nodeDump };
    return { ...placement, deps, dump, node, secrets };
  }

  it("refuses an archive with no node.dump, replacing nothing", async () => {
    const { deps, dump, secrets, venueDir, stateDir } = await restoreFixture();
    await writeFile(join(stateDir, "trading.env"), "WAITRON_NODE_ID=the-box\n");
    await expect(restoreFromArtifact(deps([dump, ...secrets]))).rejects.toMatchObject({
      code: "restore.archive_incomplete",
      params: { missing: "node.dump" },
    });
    await oldIntact(venueDir);
    expect(nodeIdsIn(join(venueDir, "node.db"))).toEqual(["NEW"]);
    expect(await readFile(join(stateDir, "trading.env"), "utf8")).toBe("WAITRON_NODE_ID=the-box\n");
    await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the target's own node.db under skipSecrets", async () => {
    const { deps, dump, node, secrets, target, venueDir } = await restoreFixture();
    await restoreFromArtifact(deps([dump, node, ...secrets], { skipSecrets: true }));
    expect(await readFile(target, "utf8")).toBe("NEW-DATABASE");
    expect(nodeIdsIn(join(venueDir, "node.db"))).toEqual(["NEW"]);
  });
});
