import nativeFs from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupArchiveKey } from "./backup-keys.js";
import type { StorageDrive } from "./box-host-client.js";
import {
  listDriveBackups,
  readDriveJson,
  readingDriveFile,
  receiveDriveArchive,
  releaseDrives,
  resolveDriveFile,
  takeDriveFile,
} from "./drive-backup-files.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";

const NODE = "c0000000-0000-4000-8000-000000000001";
const PLENTY = async () => 1024 ** 4;

let scratch: string;
let root: string;
let staging: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "drive-backup-files-"));
  root = join(scratch, "drives");
  staging = join(scratch, "state", "scratch", "restore");
  await mkdir(root);
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function name(at: string): string {
  return backupArchiveKey(new Date(at), { nodeId: NODE });
}

async function put(drive: string, path: string, bytes: string | Buffer = "cipher"): Promise<void> {
  const full = join(root, drive, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, bytes);
}

const drive = (name: string, readable = true): StorageDrive => ({
  drive: name,
  fileSystem: "vfat",
  readable,
});

describe("listDriveBackups", () => {
  it("files are listed newest first by the stamp in their names, three folders deep, skipping hidden folders and links", async () => {
    const oldest = name("2026-01-01T10:00:00Z");
    const middle = name("2026-03-01T10:00:00Z");
    const newest = name("2026-06-01T10:00:00Z");
    const deepest = name("2026-05-01T10:00:00Z");
    await put("sda1", oldest);
    // A copy onto a stick carries the copy's time, so the newest file by mtime is the oldest here.
    await utimes(join(root, "sda1", oldest), new Date(), new Date());
    await put("sda1", `backups/${middle}`);
    await put("sdb1", `a/b/c/${deepest}`);
    await put("sdb1", `a/b/c/d/${name("2026-07-01T10:00:00Z")}`);
    await put("sdb1", `.hidden/${name("2026-08-01T10:00:00Z")}`);
    await put("sdb1", `System Volume Information/${name("2026-08-02T10:00:00Z")}`);
    await put("sdb1", `$RECYCLE.BIN/${name("2026-08-03T10:00:00Z")}`);
    await put("sdb1", newest);
    await put("sdb1", "notes.txt");
    await put("sdb1", `${newest.replace(".backup.enc", "")} (1).backup.enc`);
    await mkdir(join(scratch, "outside"));
    await writeFile(join(scratch, "outside", name("2026-09-01T10:00:00Z")), "x");
    await symlink(join(scratch, "outside"), join(root, "sdb1", "linked"));
    await symlink(
      join(scratch, "outside", name("2026-09-01T10:00:00Z")),
      join(root, "sdb1", name("2026-09-02T10:00:00Z")),
    );
    await put("sdc1", name("2026-10-01T10:00:00Z"));

    const drives = [drive("sda1"), drive("sdb1"), drive("sdc1", false)];
    const listed = await listDriveBackups(drives, { root, log: vi.fn() });

    expect(listed.drives).toEqual(drives);
    expect(listed.files).toEqual([
      { drive: "sdb1", path: newest, size: 6, takenAt: "2026-06-01T10:00:00.000Z" },
      { drive: "sdb1", path: `a/b/c/${deepest}`, size: 6, takenAt: "2026-05-01T10:00:00.000Z" },
      { drive: "sda1", path: `backups/${middle}`, size: 6, takenAt: "2026-03-01T10:00:00.000Z" },
      { drive: "sda1", path: oldest, size: 6, takenAt: "2026-01-01T10:00:00.000Z" },
    ]);
  });

  it("a drive whose folder is missing lists no files", async () => {
    expect(await listDriveBackups([drive("sdd1")], { root, log: vi.fn() })).toEqual({
      drives: [drive("sdd1")],
      files: [],
    });
  });
  it("a drive folder that cannot be read is skipped and logged by drive and error code", async () => {
    await writeFile(join(root, "sda1"), "not a folder");
    await put("sdb1", name("2026-06-01T10:00:00Z"));
    const log = vi.fn();
    const listed = await listDriveBackups([drive("sda1"), drive("sdb1")], { root, log });
    expect(listed.files.map((file) => file.drive)).toEqual(["sdb1"]);
    expect(log.mock.calls).toEqual([
      ["warn", "drives.folder_unreadable", { drive: "sda1", code: "ENOTDIR" }],
    ]);
  });
});

describe("resolveDriveFile", () => {
  const good = name("2026-06-01T10:00:00Z");
  const linkedName = name("2026-06-02T10:00:00Z");

  it.each([
    ["a parent segment", { drive: "sda1", path: `../sdb1/${good}` }],
    ["a dot segment", { drive: "sda1", path: `./${good}` }],
    ["an empty segment", { drive: "sda1", path: `backups//${good}` }],
    ["an absolute path", { drive: "sda1", path: `/${good}` }],
    ["a link out of the drive", { drive: "sda1", path: `out/${good}` }],
    ["a linked file", { drive: "sda1", path: linkedName }],
    ["a hidden folder", { drive: "sda1", path: `.hidden/${good}` }],
    ["four folders deep", { drive: "sda1", path: `a/b/c/d/${good}` }],
    ["a name that does not parse", { drive: "sda1", path: "notes.backup.enc" }],
    ["a bad drive name", { drive: "../sda1", path: good }],
    ["a drive that is not a string", { drive: 1, path: good }],
    ["a missing path", { drive: "sda1" }],
    ["extra keys", { drive: "sda1", path: good, size: 1 }],
    ["not an object", `sda1/${good}`],
    ["a folder with the file's name", { drive: "sda1", path: `folder/${good}` }],
  ])("a path outside the drive folder is refused: %s", async (_label, file) => {
    await put("sda1", good);
    await put("sda1", `.hidden/${good}`);
    await put("sda1", `a/b/c/d/${good}`);
    await put("sda1", "notes.backup.enc");
    await put("sdb1", good);
    await mkdir(join(scratch, "outside"));
    await writeFile(join(scratch, "outside", good), "x");
    await symlink(join(scratch, "outside"), join(root, "sda1", "out"));
    await symlink(join(root, "sda1", good), join(root, "sda1", linkedName));
    await mkdir(join(root, "sda1", "folder", good), { recursive: true });

    await expect(resolveDriveFile(file, { root })).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "file" },
    });
    await expect(
      resolveDriveFile(file, { root, invalidCode: "handover.request_invalid" }),
    ).rejects.toMatchObject({ code: "handover.request_invalid", params: { field: "file" } });
  });

  it("a drive folder reached through a link is still accepted", async () => {
    await put("sda1", `backups/${good}`);
    const linked = join(scratch, "linked-root");
    await symlink(root, linked);

    const resolved = await resolveDriveFile(
      { drive: "sda1", path: `backups/${good}` },
      { root: linked },
    );

    expect(resolved).toEqual({
      path: join(linked, "sda1", "backups", good),
      size: 6,
      takenAt: "2026-06-01T10:00:00.000Z",
    });
  });

  it("a file gone after the list answers restore.drive_file_unreadable", async () => {
    await put("sda1", good);
    const listed = await listDriveBackups([drive("sda1")], { root, log: vi.fn() });
    await rm(join(root, "sda1"), { recursive: true });

    await expect(
      resolveDriveFile({ drive: "sda1", path: listed.files[0]!.path }, { root }),
    ).rejects.toMatchObject({ code: "restore.drive_file_unreadable" });
  });
});

describe("takeDriveFile", () => {
  const good = name("2026-06-01T10:00:00Z");
  const file = { drive: "sda1", path: `backups/${good}` };

  it("too little free space refuses before copying, and nothing changes", async () => {
    await put("sda1", file.path, Buffer.alloc(1000, 1));
    const freeBytes = vi.fn(async () => START_FREE_SPACE_FLOOR + 999);

    await expect(
      takeDriveFile(file, { root, stagingDir: staging, freeBytes }),
    ).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
    expect(freeBytes).toHaveBeenCalledWith(staging);
    expect(await readdir(staging)).toEqual([]);
  });

  it("a filesystem that cannot say how much is free refuses", async () => {
    await put("sda1", file.path);
    await expect(
      takeDriveFile(file, { root, stagingDir: staging, freeBytes: async () => null }),
    ).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
    expect(await readdir(staging)).toEqual([]);
  });

  it("the chosen file is copied; the stick's file is untouched", async () => {
    const bytes = Buffer.alloc(300 * 1024, 7);
    await put("sda1", file.path, bytes);
    const source = join(root, "sda1", file.path);
    await chmod(source, 0o644);
    const modified = new Date("2026-06-02T08:00:00Z");
    await utimes(source, modified, modified);
    const freeBytes = vi.fn(async () => START_FREE_SPACE_FLOOR + bytes.length);

    const taken = await takeDriveFile(file, { root, stagingDir: staging, freeBytes });

    expect(taken.byteLength).toBe(bytes.length);
    expect(taken.artifactPath).toMatch(
      new RegExp(`^${staging.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/drive-[0-9a-f-]{36}/archive$`),
    );
    expect(await readFile(taken.artifactPath)).toEqual(bytes);
    expect((await stat(taken.artifactPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(source)).toEqual(bytes);
    const after = await stat(source);
    expect(after.mode & 0o777).toBe(0o644);
    expect(after.mtime).toEqual(modified);

    await taken.dispose();
    expect(await readdir(staging)).toEqual([]);
  });

  it("a browser that goes away during the copy leaves no partial copy", async () => {
    await put("sda1", file.path, Buffer.alloc(4 * 1024 ** 2, 3));
    const controller = new AbortController();
    const real = nativeFs.createReadStream;
    let chunks = 0;
    const spy = vi.spyOn(nativeFs, "createReadStream").mockImplementation((...args) => {
      const stream = real(...(args as Parameters<typeof real>));
      stream.on("data", () => {
        chunks += 1;
        if (chunks === 1) controller.abort();
      });
      return stream;
    });
    syncBuiltinESMExports();
    try {
      await expect(
        takeDriveFile(file, {
          root,
          stagingDir: staging,
          freeBytes: PLENTY,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      spy.mockRestore();
      syncBuiltinESMExports();
    }
    expect(chunks).toBeGreaterThanOrEqual(1);
    expect(await readdir(staging)).toEqual([]);
  });

  it("a file gone between the check and the copy answers restore.drive_file_unreadable", async () => {
    await put("sda1", file.path);
    const freeBytes = async () => {
      await rm(join(root, "sda1"), { recursive: true });
      return 1024 ** 4;
    };
    await expect(
      takeDriveFile(file, { root, stagingDir: staging, freeBytes }),
    ).rejects.toMatchObject({ code: "restore.drive_file_unreadable" });
    expect(await readdir(staging)).toEqual([]);
  });
});

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function streamedRequest(text: string, onPull: () => void): Request {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      onPull();
      if (sent) c.close();
      else {
        sent = true;
        c.enqueue(bytes);
      }
    },
  });
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("readingDriveFile", () => {
  const eio = () => Object.assign(new Error("i/o error"), { code: "EIO" });
  it("a read error with no path answers restore.drive_file_unreadable once the file is gone, and keeps its own answer while it is there", async () => {
    const file = join(root, "sda1", "backup");
    await put("sda1", "backup");
    const kept = await readingDriveFile(file, () => Promise.reject(eio())).catch((e: unknown) => e);
    expect(kept).toMatchObject({ code: "EIO" });
    await rm(file);
    await expect(readingDriveFile(file, () => Promise.reject(eio()))).rejects.toMatchObject({
      code: "restore.drive_file_unreadable",
    });
  });
  it("an error that is not a read error, or a run with no drive path, keeps its own answer", async () => {
    const file = join(root, "sda1", "gone");
    const full = Object.assign(new Error("full"), { code: "ENOSPC", path: file });
    await expect(readingDriveFile(file, () => Promise.reject(full))).rejects.toBe(full);
    const missing = Object.assign(new Error("missing"), { code: "ENOENT", path: file });
    await expect(readingDriveFile(undefined, () => Promise.reject(missing))).rejects.toBe(missing);
    await expect(readingDriveFile(file, async () => 7)).resolves.toBe(7);
  });
});

describe("readDriveJson", () => {
  it("reads a JSON body within its limit", async () => {
    expect(await readDriveJson(jsonRequest('{"a":1}'), 16)).toEqual({ a: 1 });
  });

  it("a JSON body over its limit is refused before it is parsed", async () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      // Without a declared length: the limit is met while reading.
      let pulls = 0;
      await expect(
        readDriveJson(
          streamedRequest(`{"a":"${"x".repeat(64)}"}`, () => (pulls += 1)),
          16,
        ),
      ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "body" } });
      await expect(
        readDriveJson(jsonRequest(`{"a":"${"x".repeat(64)}"}`), 16, "handover.request_invalid"),
      ).rejects.toMatchObject({ code: "handover.request_invalid", params: { field: "body" } });
      expect(parse).not.toHaveBeenCalled();
      expect(pulls).toBe(1);
    } finally {
      parse.mockRestore();
    }
  });

  it("a body that is not JSON is refused", async () => {
    await expect(readDriveJson(jsonRequest("{"), 16)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "body" },
    });
  });
});

describe("receiveDriveArchive", () => {
  const good = name("2026-06-01T10:00:00Z");
  const file = { drive: "sda1", path: good };

  it("a file read where it lies keeps the drive path and its fields", async () => {
    await put("sda1", good);
    const upload = await receiveDriveArchive(
      jsonRequest(
        JSON.stringify({
          file,
          masterKey: "key",
          request: { eventId: "e" },
          ignored: "x",
        }),
      ),
      { fields: ["masterKey", "request"] },
      { root, stagingDir: staging, limitBytes: 4096 },
    );
    expect(upload.artifactPath).toBe(join(root, "sda1", good));
    expect(upload.byteLength).toBe(6);
    expect(upload.fields).toEqual(
      new Map([
        ["masterKey", "key"],
        ["request", '{"eventId":"e"}'],
      ]),
    );
    await upload.dispose();
    expect(await readFile(join(root, "sda1", good), "utf8")).toBe("cipher");
  });

  it("a drive file has no byte limit", async () => {
    await put("sda1", good);
    const upload = await receiveDriveArchive(
      jsonRequest(JSON.stringify({ file })),
      { maxBytes: 1, moves: true },
      { root, stagingDir: staging, limitBytes: 4096, freeBytes: PLENTY },
    );
    expect(upload.byteLength).toBe(6);
    expect(upload.artifactPath.startsWith(join(staging, "drive-"))).toBe(true);
    expect(await readFile(upload.artifactPath, "utf8")).toBe("cipher");
    await upload.dispose();
    expect(await readdir(staging)).toEqual([]);
  });

  it.each([
    ["not an object", "[1]", false, "body"],
    ["no file", '{"masterKey":"k"}', false, "file"],
    [
      "a field that is neither text nor an object",
      `{"file":{"drive":"sda1","path":"${good}"},"masterKey":1}`,
      false,
      "masterKey",
    ],
    [
      "an unnamed key when the fields are exact",
      `{"file":{"drive":"sda1","path":"${good}"},"other":"x"}`,
      true,
      "body",
    ],
  ])("refuses a body with %s", async (_label, body, exactFields, field) => {
    await put("sda1", good);
    await expect(
      receiveDriveArchive(
        jsonRequest(body),
        { fields: ["masterKey"], exactFields },
        { root, stagingDir: staging, limitBytes: 4096 },
      ),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field } });
  });
});

describe("releaseDrives", () => {
  it("asks the host as the server and logs what it released", async () => {
    const storageRelease = vi.fn(async () => ({ available: true as const, released: 2 }));
    const log = vi.fn();
    await releaseDrives({ host: { storageRelease }, places: { taken: 0 }, log });
    expect(storageRelease).toHaveBeenCalledWith({ source: "server" });
    expect(log).toHaveBeenCalledWith("info", "drives.released", { released: 2 });
  });

  it.each([
    [
      "a refused release",
      async () => ({
        available: false as const,
        reason: "refused" as const,
        refusal: "busy" as const,
      }),
    ],
    [
      "no host",
      async () => ({ available: false as const, reason: "missing" as const, detail: "ENOENT" }),
    ],
    ["a throwing host", async () => Promise.reject(new Error("socket"))],
  ])("logs %s and never throws", async (_label, storageRelease) => {
    const log = vi.fn();
    await expect(
      releaseDrives({ host: { storageRelease }, places: { taken: 0 }, log }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("warn", "drives.release_failed", expect.any(Object));
  });

  it("logs the host's own busy as box_host.busy", async () => {
    const log = vi.fn();
    await releaseDrives({
      host: {
        storageRelease: async () => ({ available: false, reason: "refused", refusal: "busy" }),
      },
      places: { taken: 0 },
      log,
    });
    expect(log).toHaveBeenCalledWith("warn", "drives.release_failed", { code: "box_host.busy" });
  });

  it("logs without asking when both host places are taken", async () => {
    const storageRelease = vi.fn();
    const log = vi.fn();
    await releaseDrives({ host: { storageRelease }, places: { taken: 2 }, log });
    expect(storageRelease).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", "drives.release_failed", { code: "box_host.busy" });
  });
});
