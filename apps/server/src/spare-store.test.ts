// The fake-spawn cases always run. The real-binary case needs the pinned versitygw: install it with
// `node scripts/setup-s3-test-server.mjs`. Without it that case is reported SKIPPED, with the reason
// in its note. With CI=true (GitHub sets it on every job) or WAITRON_REQUIRE_STREAM_BINARIES=1, a
// missing binary FAILS the case instead.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { ChildHandle, SpawnFn } from "@waitron/stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPARE_STORE_BUCKET,
  SPARE_STORE_REGION,
  startSpareStore,
  type SpareStore,
} from "./spare-store.js";
import { freePorts } from "./testing/free-ports.js";
import { resolveVersitygw } from "./testing/s3-test-server.js";

const INSTALL = "node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";
const READY_MS = 10_000;

const ACCESS_KEY_ID = "waitron0123456789abcdef";
const SECRET = "f".repeat(64);

interface Spawned {
  bin: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  exit(code: number | null): void;
  killed: boolean;
}

function fakeSpawn(onSpawn?: () => void) {
  const spawned: Spawned[] = [];
  const spawn: SpawnFn = (bin, args, env) => {
    onSpawn?.();
    let settle!: (code: number | null) => void;
    const exited = new Promise<number | null>((resolve) => (settle = resolve));
    const record: Spawned = { bin, args, env, exit: (code) => settle(code), killed: false };
    spawned.push(record);
    const handle: ChildHandle = {
      pid: 4242,
      exited,
      output: () => "",
      kill: () => {
        record.killed = true;
        settle(null);
      },
    };
    return handle;
  };
  return { spawn, spawned };
}

const scratch: string[] = [];
let started: SpareStore | undefined;
afterEach(async () => {
  vi.useRealTimers();
  if (started !== undefined) await started.stop();
  started = undefined;
  for (const folder of scratch.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function stateDir(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "waitron-spare-store-"));
  scratch.push(folder);
  return folder;
}

describe("startSpareStore", () => {
  it("passes the keys in the environment and never on the command line", async () => {
    const dir = await stateDir();
    const { spawn, spawned } = fakeSpawn();
    const logs: string[] = [];
    const store = await startSpareStore({
      bin: "/opt/versitygw",
      stateDir: dir,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      loopbackPort: 7444,
      spawn,
      log: (level, event, fields) => logs.push(JSON.stringify({ level, event, fields })),
    });
    started = store;
    expect(spawned).toHaveLength(1);
    const [child] = spawned;
    expect(child!.bin).toBe("/opt/versitygw");
    expect(child!.env.ROOT_ACCESS_KEY_ID).toBe(ACCESS_KEY_ID);
    expect(child!.env.ROOT_SECRET_ACCESS_KEY).toBe(SECRET);
    expect(child!.args.join(" ")).not.toContain(ACCESS_KEY_ID);
    expect(child!.args.join(" ")).not.toContain(SECRET);
    expect(child!.args).not.toContain("--access");
    expect(child!.args).not.toContain("--secret");
    expect(child!.args).toEqual([
      "--port",
      "127.0.0.1:7444",
      "--region",
      SPARE_STORE_REGION,
      "posix",
      "--sidecar",
      join(dir, "pair-store", "meta"),
      join(dir, "pair-store", "data"),
    ]);
    child!.exit(1);
    await vi.waitFor(() => expect(logs.join("\n")).toContain("spare.store_exited"));
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("listens on loopback only, with the bucket made as a folder before it starts", async () => {
    const dir = await stateDir();
    const bucketAtSpawn: boolean[] = [];
    const { spawn, spawned } = fakeSpawn(() =>
      bucketAtSpawn.push(existsSync(join(dir, "pair-store", "data", SPARE_STORE_BUCKET))),
    );
    const store = await startSpareStore({
      bin: "versitygw",
      stateDir: dir,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      loopbackPort: 7555,
      spawn,
      log: () => {},
    });
    started = store;
    expect(store.loopbackUrl).toBe("http://127.0.0.1:7555");
    const ports = spawned[0]!.args.flatMap((arg, i, all) => (all[i - 1] === "--port" ? [arg] : []));
    expect(ports).toEqual(["127.0.0.1:7555"]);
    expect(bucketAtSpawn).toEqual([true]);
    expect(existsSync(join(dir, "pair-store", "meta"))).toBe(true);
  });

  it("starts again after versitygw exits, and not after it is stopped", async () => {
    vi.useFakeTimers();
    const dir = await stateDir();
    const { spawn, spawned } = fakeSpawn();
    const logs: { event: string; fields?: Record<string, unknown> }[] = [];
    const store = await startSpareStore({
      bin: "versitygw",
      stateDir: dir,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      loopbackPort: 7444,
      spawn,
      log: (_level, event, fields) => logs.push({ event, fields }),
    });
    started = store;
    spawned[0]!.exit(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(spawned).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawned).toHaveLength(2);
    expect(spawned[1]!.args).toEqual(spawned[0]!.args);
    expect(spawned[1]!.env).toEqual(spawned[0]!.env);
    expect(logs).toContainEqual({
      event: "spare.store_exited",
      fields: { exitCode: 2, restartInMs: 1_000 },
    });
    spawned[1]!.exit(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spawned).toHaveLength(3);
    await store.stop();
    expect(spawned[2]!.killed).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spawned).toHaveLength(3);
  });

  it("the real versitygw answers with the pair's key and refuses another key with 403", async (ctx) => {
    const versitygw = await resolveVersitygw(process.env);
    if (!versitygw.ok) {
      if (REQUIRED) {
        throw new Error(
          `the spare store's case cannot run: ${versitygw.reason}. CI installs it with: ${INSTALL}`,
        );
      }
      return ctx.skip(`${versitygw.reason} — install with: ${INSTALL}`);
    }
    const dir = await stateDir();
    const [port] = await freePorts(1);
    const store = await startSpareStore({
      bin: versitygw.bin,
      stateDir: dir,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      loopbackPort: port!,
      log: () => {},
    });
    started = store;
    const client = (accessKeyId: string, secretAccessKey: string) =>
      new S3Client({
        endpoint: store.loopbackUrl,
        region: SPARE_STORE_REGION,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 1,
      });
    const pair = client(ACCESS_KEY_ID, SECRET);
    const otherSecret = client(ACCESS_KEY_ID, "0".repeat(64));
    // versitygw 1.8.0 answers an access key id it does not hold with 404 `XAdminUserNotFound`.
    const otherId = client("waitronffffffffffffffff", SECRET);
    try {
      const list = new ListObjectsV2Command({ Bucket: SPARE_STORE_BUCKET, MaxKeys: 1 });
      const deadline = Date.now() + READY_MS;
      let answered: { KeyCount?: number } | undefined;
      while (answered === undefined) {
        try {
          answered = await pair.send(list, { abortSignal: AbortSignal.timeout(1_000) });
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await delay(50);
        }
      }
      expect(answered.KeyCount).toBe(0);
      const refusal = (from: S3Client) =>
        from.send(list).then(
          () => undefined,
          (error: { name?: string; $metadata?: { httpStatusCode?: number } }) => ({
            name: error.name,
            status: error.$metadata?.httpStatusCode,
          }),
        );
      expect(await refusal(otherSecret)).toEqual({ name: "SignatureDoesNotMatch", status: 403 });
      expect(await refusal(otherId)).toEqual({ name: "XAdminUserNotFound", status: 404 });
    } finally {
      pair.destroy();
      otherSecret.destroy();
      otherId.destroy();
    }
  }, 30_000);
});
