import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { BucketConfig, FileCall, S3FileStore } from "@waitron/stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadArchive } from "./archive-download.js";
import type { ArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { backupArchiveKey, dumpFileName } from "./backup-keys.js";

const KEY = backupArchiveKey(new Date("2026-10-01T03:00:00Z"));
const BODY = Buffer.from("WBK1 archive bytes");

const PACK: ArchiveRecoveryPack = {
  version: 1,
  format: "WBK1",
  venueId: "venue-1",
  bucket: {
    region: "eu-west-1",
    bucket: "owner-bucket",
    prefix: "waitron",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-access-key-value",
  },
  archivePrefix: "waitron/archives/venue-1/",
  recoveryKey: "recovery-key-value",
};

interface Fake {
  opened: BucketConfig[];
  calls: string[];
  closed: number;
  /** Replaces the default copy in `getFile`. */
  get?: (key: string, outPath: string, call: FileCall) => Promise<void>;
  list?: () => Promise<never>;
}

let root: string;
let bucketDir: string;
let staging: string;
let fake: Fake;

function openFiles(config: BucketConfig): S3FileStore {
  fake.opened.push(config);
  return {
    async putFile() {
      throw new Error("not used");
    },
    async putBytes() {
      throw new Error("not used");
    },
    async readStream() {
      throw new Error("not used");
    },
    async deleteMany() {
      throw new Error("not used");
    },
    async list(prefix) {
      fake.calls.push(`list:${prefix}`);
      if (fake.list) return fake.list();
      const names = await readdir(bucketDir);
      return Promise.all(
        names
          .filter((name) => name.startsWith(prefix))
          .map(async (name) => ({
            key: name,
            size: (await stat(join(bucketDir, name))).size,
            lastModified: new Date(),
          })),
      );
    },
    async getFile(key, outPath, call) {
      fake.calls.push(`getFile:${key}`);
      if (fake.get) return fake.get(key, outPath, call);
      await writeFile(outPath, await readFile(join(bucketDir, key)));
    },
    close() {
      fake.closed += 1;
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "archive-download-test-"));
  bucketDir = join(root, "bucket");
  staging = join(root, "staging");
  await mkdir(bucketDir);
  await writeFile(join(bucketDir, KEY), BODY);
  fake = { opened: [], calls: [], closed: 0 };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function run(overrides: Partial<Parameters<typeof downloadArchive>[0]> = {}) {
  return downloadArchive({
    pack: PACK,
    key: KEY,
    stagingDir: staging,
    signal: new AbortController().signal,
    openFiles,
    ...overrides,
  });
}

async function expectStagingEmpty() {
  expect(await readdir(staging)).toEqual([]);
}

describe("downloadArchive", () => {
  it("downloads the archive into a fresh folder that dispose removes", async () => {
    const done = await run();
    expect(await readFile(done.path)).toEqual(BODY);
    expect(done.path.startsWith(join(staging, "archive-download-"))).toBe(true);
    expect((await stat(staging)).mode & 0o777).toBe(0o700);
    expect(fake.opened).toEqual([{ ...PACK.bucket, prefix: PACK.archivePrefix }]);
    expect(fake.calls).toEqual([`list:${KEY}`, `getFile:${KEY}`]);
    expect(fake.closed).toBe(1);
    await done.dispose();
    await expectStagingEmpty();
    await done.dispose();
  });

  it("uses the real statfs when none is given", async () => {
    const done = await run({ statfs: undefined });
    expect(await readFile(done.path)).toEqual(BODY);
    await done.dispose();
  });

  it("opens the real file store when none is given", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      run({
        openFiles: undefined,
        pack: { ...PACK, bucket: { ...PACK.bucket, endpoint: "http://127.0.0.1:9" } },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: "restore.archive_download_failed",
      params: { reason: "timed_out" },
    });
  });

  it.each(["../x", `a/${KEY}`, "waitron-probe-1", dumpFileName(new Date()), ""])(
    "refuses the name %j before opening the store",
    async (key) => {
      await expect(run({ key })).rejects.toMatchObject({ code: "restore.archive_key_invalid" });
      expect(fake.opened).toEqual([]);
    },
  );

  it("refuses an archive the folder does not hold", async () => {
    await rm(join(bucketDir, KEY));
    await writeFile(join(bucketDir, `${KEY}.other`), BODY);
    await expect(run()).rejects.toMatchObject({ code: "restore.archive_missing", params: {} });
    expect(fake.calls).toEqual([`list:${KEY}`]);
    expect(fake.closed).toBe(1);
  });

  it("refuses before downloading when the staging disk has too little space", async () => {
    const statfs = async () => ({ bavail: 1, bsize: BODY.length - 1 });
    await expect(run({ statfs })).rejects.toMatchObject({ code: "restore.archive_disk_full" });
    expect(fake.calls).toEqual([`list:${KEY}`]);
    expect(fake.closed).toBe(1);
    await expectStagingEmpty();
  });

  it("downloads when the space check cannot be made", async () => {
    const statfs = async () => {
      throw new Error("not supported");
    };
    const done = await run({ statfs });
    expect(await readFile(done.path)).toEqual(BODY);
    await done.dispose();
  });

  it("reports a disk that fills mid-download and leaves nothing behind", async () => {
    fake.get = async (_key, outPath) => {
      await writeFile(outPath, "partial");
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    };
    await expect(run()).rejects.toMatchObject({ code: "restore.archive_disk_full" });
    expect(fake.closed).toBe(1);
    await expectStagingEmpty();
  });

  it("reports a cancelled download as timed out and leaves nothing behind", async () => {
    const controller = new AbortController();
    fake.get = async (key, outPath) => {
      await writeFile(outPath, "partial");
      controller.abort();
      throw new AppError("backup.destination_request_failed", {
        operation: "get",
        key,
        status: null,
        name: "AbortError",
      });
    };
    await expect(run({ signal: controller.signal })).rejects.toMatchObject({
      code: "restore.archive_download_failed",
      params: { reason: "timed_out" },
    });
    expect(fake.closed).toBe(1);
    await expectStagingEmpty();
  });

  it("reports a refused request without its key", async () => {
    fake.get = async (key) => {
      throw new AppError("backup.destination_request_failed", {
        operation: "get",
        key,
        status: 403,
        name: "AccessDenied",
      });
    };
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "restore.archive_download_failed",
      params: { reason: "request_failed" },
    });
    expect(JSON.stringify((error as AppError).params)).not.toContain(KEY);
    expect(fake.closed).toBe(1);
    await expectStagingEmpty();
  });

  it("reports a failed listing as a refused request", async () => {
    fake.list = async () => {
      throw new AppError("backup.destination_request_failed", {
        operation: "list",
        key: KEY,
        status: 500,
        name: "InternalError",
      });
    };
    await expect(run()).rejects.toMatchObject({
      code: "restore.archive_download_failed",
      params: { reason: "request_failed" },
    });
    expect(fake.closed).toBe(1);
  });

  it.each<[string, number | null, string]>([
    ["NoSuchKey", 404, "NoSuchKey"],
    ["a 404", 404, "NotFound"],
  ])(
    "reports an archive gone between listing and download (%s) as missing",
    async (_l, status, name) => {
      fake.get = async (key) => {
        throw new AppError("backup.destination_request_failed", {
          operation: "get",
          key,
          status,
          name,
        });
      };
      await expect(run()).rejects.toMatchObject({ code: "restore.archive_missing" });
      await expectStagingEmpty();
    },
  );

  it("reports anything else as failed and leaves nothing behind", async () => {
    fake.get = async (_key, outPath) => {
      await writeFile(outPath, "partial");
      throw new Error("boom");
    };
    await expect(run()).rejects.toMatchObject({
      code: "restore.archive_download_failed",
      params: { reason: "failed" },
    });
    expect(fake.closed).toBe(1);
    await expectStagingEmpty();
  });
});
