// A rehearsal run killed part-way, against versitygw: the keeper the run started cleans up after it
// (design D8–D10), and a request off the run's plan never reaches the server (D3–D4). The run is
// `./testing/aws-rehearsal-interrupt-driver.ts`, or Vitest running
// `./testing/aws-rehearsal-interrupt.vitest-case.ts`, in a process group of its own. Install the
// server with `node scripts/setup-s3-test-server.mjs`. Without it each case is reported SKIPPED;
// with CI=true or WAITRON_REQUIRE_STREAM_BINARIES=1 a missing binary FAILS the case.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createBucketClient } from "@waitron/stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanupFromReceipt } from "./testing/aws-rehearsal.js";
import { UNCAUGHT_MESSAGE } from "./testing/aws-rehearsal-interrupt-driver.js";
import { journalFileName, processStartTime } from "./testing/aws-rehearsal-journal.js";
import { tsxLoaderUrl } from "./testing/aws-rehearsal-keeper-start.js";
import { cleanupCommandFor, receiptFileName } from "./testing/aws-rehearsal-receipt.js";
import { AWS_REHEARSAL_NONCE_KEY } from "./testing/aws-request-plan.js";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";

const INSTALL = "node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";
const DRIVER = fileURLToPath(
  new URL("./testing/aws-rehearsal-interrupt-driver.ts", import.meta.url),
);
const VITEST_CASE_CONFIG = fileURLToPath(
  new URL("./testing/vitest.aws-rehearsal-interrupt.config.ts", import.meta.url),
);
const SERVER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VITEST_BIN = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);
const REGION = "eu-north-1";
/** The keeper's teardown limit in the failing-cleanup case: versitygw stays paused past it. */
const SHORT_TEARDOWN_MS = 2_000;
const POINT_MS = 30_000;
const KEEPER_MS = 60_000;
const POLL_MS = 100;

const versitygw = await resolveVersitygw(process.env);
if (!versitygw.ok && !REQUIRED) {
  console.warn(`Rehearsal interrupt cases SKIPPED: ${versitygw.reason}. Install with: ${INSTALL}`);
}

interface RunFacts {
  runId: string;
  bucket: string;
  /** Null when the scenario stopped before making it. */
  scratch: string | null;
  sleepPid: number | null;
}

/**
 * Forwards to versitygw unchanged (the Host header the request was signed with included), and once
 * armed pauses versitygw with SIGSTOP when the first DELETE arrives, before forwarding it. In a run
 * that tracked an upload, a teardown's first DELETE is that upload's abort (`teardownOwnedBucket`),
 * so the keeper's ownership read before it is answered.
 */
interface PausingProxy {
  endpoint: string;
  /** Resolves once versitygw is paused. */
  pauseOnFirstDelete(): Promise<void>;
  close(): Promise<void>;
}

async function startPausingProxy(target: S3TestServer): Promise<PausingProxy> {
  const upstream = new URL(target.endpoint);
  let armed: { resolve(): void; reject(error: unknown): void } | null = null;
  const server: Server = createServer((incoming, answer) => {
    if (armed !== null && incoming.method === "DELETE") {
      const fire = armed;
      armed = null;
      target.pause().then(fire.resolve, fire.reject);
    }
    const out = request(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: incoming.method,
        path: incoming.url,
        headers: incoming.headers,
      },
      (reply) => {
        answer.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(answer);
      },
    );
    out.on("error", () => answer.destroy());
    incoming.on("error", () => out.destroy());
    answer.on("close", () => {
      if (!answer.writableFinished) out.destroy();
    });
    incoming.pipe(out);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    endpoint: `http://127.0.0.1:${port}`,
    pauseOnFirstDelete: () =>
      new Promise<void>((resolve, reject) => {
        armed = { resolve, reject };
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function psField(pid: number, field: "ppid" | "pgid"): string {
  return execFileSync("ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8" }).trim();
}

async function journalsIn(
  receiptDir: string | undefined,
): Promise<{ keeperPid: number | null; pids: { pid: number; startTime: string | null }[] }[]> {
  if (receiptDir === undefined || !existsSync(receiptDir)) return [];
  const names = (await readdir(receiptDir)).filter((name) => name.endsWith("-journal.json"));
  const journals = [];
  for (const name of names) {
    try {
      journals.push(JSON.parse(await readFile(join(receiptDir, name), "utf8")));
    } catch {
      // Removed between the listing and the read: a refused run deletes its journal.
    }
  }
  return journals;
}

function stopPid(pid: number | undefined, group = false): void {
  if (pid === undefined || !alive(pid)) return;
  try {
    process.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** The prefixes of the buckets this file's cases make: each run's own, and the unplanned case's other one. */
const CASE_BUCKET_PREFIXES = ["waitron-rehearsal-", "waitron-interrupt-other-"];

/** Empties and deletes the cases' buckets; a step that fails is left for the next case to report. */
async function removeCaseBuckets(admin: S3Client): Promise<void> {
  const listed = await admin.send(new ListBucketsCommand({})).catch(() => undefined);
  for (const { Name: bucket } of listed?.Buckets ?? []) {
    if (bucket === undefined || !CASE_BUCKET_PREFIXES.some((p) => bucket.startsWith(p))) continue;
    try {
      const uploads = await admin.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
      for (const { Key, UploadId } of uploads.Uploads ?? []) {
        await admin.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key, UploadId }));
      }
      const objects = await admin.send(new ListObjectsV2Command({ Bucket: bucket }));
      for (const { Key } of objects.Contents ?? []) {
        await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
      }
      await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
    } catch {
      // The next case's own checks say what is still there.
    }
  }
}

describe("a rehearsal run killed part-way, against versitygw", () => {
  let dir: string | undefined;
  let s3: S3TestServer | undefined;
  let client: S3Client | undefined;
  /** What this suite started or caused, stopped in afterEach. */
  let started: {
    driver?: ChildProcess;
    receiptDir?: string;
    keeperPid?: number;
    /** Read when the case first saw the keeper's pid; afterEach signals it only while this matches. */
    keeperStartTime?: string | null;
    sleepPid?: number;
    proxy?: PausingProxy;
  } = {};

  beforeAll(async () => {
    if (!versitygw.ok) return;
    dir = await mkdtemp(join(tmpdir(), "waitron-interrupt-"));
    s3 = await startS3TestServer({
      bin: versitygw.bin,
      root: join(dir, "s3"),
      region: REGION,
      accessLog: join(dir, "access.log"),
    });
    client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
      maxAttempts: 1,
    });
  }, S3_READY_MS + 10_000);

  afterEach(async () => {
    try {
      s3?.resume();
    } catch {
      // It has exited; afterAll says nothing more about it.
    }
    await started.proxy?.close();
    if (started.driver?.pid !== undefined) stopPid(started.driver.pid, true);
    // Each only while it is still the process the run started. A keeper whose start time this case
    // never read is not signalled.
    const pids = new Set([started.sleepPid]);
    const { keeperPid, keeperStartTime } = started;
    if (keeperPid !== undefined && keeperStartTime !== undefined && keeperStartTime !== null) {
      if (processStartTime(keeperPid) === keeperStartTime) pids.add(keeperPid);
    }
    // A case that failed before the driver's RUN line knows its tracked pids only from the journal.
    for (const journal of await journalsIn(started.receiptDir)) {
      for (const { pid, startTime } of journal.pids) {
        if (startTime !== null && processStartTime(pid) === startTime) pids.add(pid);
      }
    }
    for (const pid of pids) stopPid(pid);
    started = {};
    // A failed case's leftover buckets would fail each later case's bucket count.
    if (client !== undefined) await removeCaseBuckets(client);
  });

  afterAll(async () => {
    client?.destroy();
    if (s3 !== undefined) await s3.stop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  function requireServer(ctx: { skip(note: string): never }): {
    server: S3TestServer;
    client: S3Client;
    dir: string;
  } {
    if (!versitygw.ok) {
      if (REQUIRED) {
        throw new Error(
          `the rehearsal interrupt cases cannot run: ${versitygw.reason}. CI installs it with: ${INSTALL}`,
        );
      }
      return ctx.skip(`${versitygw.reason} — install with: ${INSTALL}`);
    }
    if (s3 === undefined || client === undefined || dir === undefined) {
      throw new Error("the S3 test server did not start");
    }
    return { server: s3, client, dir };
  }

  async function rehearsalBuckets(admin: S3Client): Promise<string[]> {
    const listed = await admin.send(new ListBucketsCommand({}));
    return (listed.Buckets ?? [])
      .map((bucket) => bucket.Name ?? "")
      .filter((name) => name.startsWith("waitron-rehearsal-"));
  }

  /** The environment a real run takes its profile from, with files holding versitygw's keys. */
  async function profileEnv(
    server: S3TestServer,
    caseDir: string,
  ): Promise<Record<string, string>> {
    const tmp = join(caseDir, "tmp");
    await mkdir(tmp, { recursive: true });
    const credentials = join(caseDir, "credentials");
    const config = join(caseDir, "config");
    await writeFile(
      credentials,
      `[waitron-rehearsal]\naws_access_key_id = ${server.accessKeyId}\naws_secret_access_key = ${server.secretAccessKey}\n`,
      { mode: 0o600 },
    );
    await writeFile(config, `[profile waitron-rehearsal]\nregion = ${REGION}\n`);
    return {
      WAITRON_RUN_AWS_REHEARSAL: "1",
      AWS_PROFILE: "waitron-rehearsal",
      AWS_REGION: REGION,
      AWS_SHARED_CREDENTIALS_FILE: credentials,
      AWS_CONFIG_FILE: config,
      TMPDIR: tmp,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? caseDir,
    };
  }

  /** Starts the driver in a process group of its own; its output is collected. */
  async function startDriver(
    server: S3TestServer,
    caseDir: string,
    point: string,
    options: { endpoint?: string; flags?: string[] } = {},
  ): Promise<{ driver: ChildProcess; receiptDir: string; output: () => string }> {
    const receiptDir = join(caseDir, "receipts");
    started.receiptDir = receiptDir;
    const env = await profileEnv(server, caseDir);
    const driver = spawn(
      process.execPath,
      [
        "--import",
        tsxLoaderUrl(),
        DRIVER,
        "--endpoint",
        options.endpoint ?? server.endpoint,
        "--receipt-dir",
        receiptDir,
        "--point",
        point,
        ...(options.flags ?? []),
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"], env },
    );
    started.driver = driver;
    let text = "";
    driver.stdout!.on("data", (chunk: Buffer) => (text += chunk.toString()));
    driver.stderr!.on("data", (chunk: Buffer) => (text += chunk.toString()));
    return { driver, receiptDir, output: () => text };
  }

  /** Waits for `POINT <point>` in `read()`, then reads the run's facts and its keeper's pid. */
  async function reachPoint(
    run: ChildProcess,
    read: () => Promise<string> | string,
    receiptDir: string,
    point: string,
  ): Promise<RunFacts> {
    const until = Date.now() + POINT_MS;
    let text = await read();
    while (!text.includes(`POINT ${point}\n`)) {
      if (run.exitCode !== null || run.signalCode !== null || Date.now() > until) {
        throw new Error(`the run did not reach ${point}; it printed:\n${text}`);
      }
      await delay(POLL_MS);
      text = await read();
    }
    const line = text.split("\n").find((entry) => entry.startsWith("RUN "))!;
    const facts = JSON.parse(line.slice(4)) as RunFacts;
    if (facts.sleepPid !== null) started.sleepPid = facts.sleepPid;
    const journal = JSON.parse(
      await readFile(join(receiptDir, journalFileName(facts.runId)), "utf8"),
    ) as { keeperPid: number | null };
    if (journal.keeperPid !== null) {
      started.keeperPid = journal.keeperPid;
      started.keeperStartTime = processStartTime(journal.keeperPid);
    }
    return facts;
  }

  /** Starts the driver in a process group of its own and waits for its `POINT <point>` line. */
  async function driveTo(
    server: S3TestServer,
    caseDir: string,
    point: string,
    options: { endpoint?: string; flags?: string[] } = {},
  ): Promise<{ facts: RunFacts; receiptDir: string; output: () => string }> {
    const { driver, receiptDir, output } = await startDriver(server, caseDir, point, options);
    const facts = await reachPoint(driver, output, receiptDir, point);
    return { facts, receiptDir, output };
  }

  async function exitOf(run: ChildProcess): Promise<number | NodeJS.Signals | null> {
    if (run.exitCode !== null || run.signalCode !== null) return run.exitCode ?? run.signalCode;
    return new Promise((resolve) => run.once("close", (code, signal) => resolve(code ?? signal)));
  }

  /** The keeper's log once its last line is `exit <n>`. */
  async function keeperFinished(receiptDir: string, runId: string): Promise<string[]> {
    const path = join(receiptDir, `aws-rehearsal-${runId}-keeper.log`);
    const until = Date.now() + KEEPER_MS;
    for (;;) {
      const lines = existsSync(path)
        ? (await readFile(path, "utf8")).split("\n").filter((entry) => entry !== "")
        : [];
      if (/^exit \d+$/.test(lines.at(-1) ?? "")) return lines;
      if (Date.now() > until) {
        throw new Error(
          `the keeper's log did not end with an exit line within ${KEEPER_MS} ms:\n${lines.join("\n")}`,
        );
      }
      await delay(POLL_MS);
    }
  }

  it(
    "SIGINT to the run's group mid-scenario: the keeper deletes the bucket and the scratch, stops the tracked process and says nothing is left",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "mid-"));
      const { facts, receiptDir } = await driveTo(server, caseDir, "mid-scenario");

      // The state the keeper has to undo, seen before the interrupt.
      expect(await rehearsalBuckets(client)).toEqual([facts.bucket]);
      expect(existsSync(join(facts.scratch!, "secrets", "secrets.env"))).toBe(true);
      expect(alive(facts.sleepPid!)).toBe(true);
      expect(started.keeperPid).toBeTypeOf("number");
      expect(alive(started.keeperPid!)).toBe(true);
      // Its launcher has exited, so it is outside the run's tree and its process group. Its parent
      // is pid 1 on macOS; on Linux a subreaper, if the runner has one, takes it instead.
      expect(psField(started.keeperPid!, "ppid")).not.toBe(String(started.driver!.pid));
      expect(psField(started.keeperPid!, "ppid")).not.toBe(String(process.pid));
      expect(psField(started.keeperPid!, "pgid")).not.toBe(String(started.driver!.pid));

      process.kill(-started.driver!.pid!, "SIGINT");
      const lines = await keeperFinished(receiptDir, facts.runId);

      const said = `the keeper's log:\n${lines.join("\n")}`;
      expect(await rehearsalBuckets(client), said).toEqual([]);
      expect(existsSync(facts.scratch!), said).toBe(false);
      expect(alive(facts.sleepPid!), said).toBe(false);
      const interrupted = JSON.parse(
        await readFile(join(receiptDir, receiptFileName(facts.runId, "interrupted")), "utf8"),
      ) as { remaining: { bucket: string | null } };
      expect(interrupted.remaining.bucket).toBeNull();
      expect(lines).toContain("nothing left behind");
      expect(lines.at(-1)).toBe("exit 0");
    },
    POINT_MS + KEEPER_MS + 10_000,
  );

  /** Task 7a's end state, for a run whose scratch and tracked process may never have been made. */
  async function expectNothingLeft(
    admin: S3Client,
    caseDir: string,
    facts: RunFacts,
    receiptDir: string,
    lines: string[],
  ): Promise<void> {
    const said = `the keeper's log:\n${lines.join("\n")}`;
    expect(await rehearsalBuckets(admin), said).toEqual([]);
    const scratch = facts.scratch ?? join(caseDir, "tmp", `waitron-aws-rehearsal-${facts.runId}`);
    expect(existsSync(scratch), said).toBe(false);
    if (facts.sleepPid !== null) expect(alive(facts.sleepPid), said).toBe(false);
    const interrupted = JSON.parse(
      await readFile(join(receiptDir, receiptFileName(facts.runId, "interrupted")), "utf8"),
    ) as { remaining: { bucket: string | null } };
    expect(interrupted.remaining.bucket, said).toBeNull();
    expect(lines, said).toContain("nothing left behind");
    expect(lines.at(-1), said).toBe("exit 0");
  }

  /** What the run made, seen before it is interrupted mid-scenario. */
  async function expectMidScenario(admin: S3Client, facts: RunFacts): Promise<void> {
    expect(await rehearsalBuckets(admin)).toEqual([facts.bucket]);
    expect(existsSync(join(facts.scratch!, "secrets", "secrets.env"))).toBe(true);
    expect(alive(facts.sleepPid!)).toBe(true);
    expect(alive(started.keeperPid!)).toBe(true);
  }

  async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${what} within ${ms} ms`)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  it(
    "SIGINT to the run's group right after setup: the keeper deletes the bucket, which holds only its marker",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "setup-"));
      const { facts, receiptDir } = await driveTo(server, caseDir, "after-setup");

      expect(await rehearsalBuckets(client)).toEqual([facts.bucket]);
      const listed = await client.send(new ListObjectsV2Command({ Bucket: facts.bucket }));
      expect((listed.Contents ?? []).map((object) => object.Key)).toEqual([
        AWS_REHEARSAL_NONCE_KEY,
      ]);
      expect(facts.scratch).toBeNull();
      expect(alive(started.keeperPid!)).toBe(true);

      process.kill(-started.driver!.pid!, "SIGINT");
      const lines = await keeperFinished(receiptDir, facts.runId);
      await expectNothingLeft(client, caseDir, facts, receiptDir, lines);
    },
    POINT_MS + KEEPER_MS + 10_000,
  );

  it(
    "SIGTERM to the run's own pid alone mid-scenario, as a watchdog that misses its group: the keeper cleans up",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "term-"));
      const { facts, receiptDir } = await driveTo(server, caseDir, "mid-scenario");
      await expectMidScenario(client, facts);

      process.kill(started.driver!.pid!, "SIGTERM");
      expect(await exitOf(started.driver!)).toBe("SIGTERM");
      const lines = await keeperFinished(receiptDir, facts.runId);
      await expectNothingLeft(client, caseDir, facts, receiptDir, lines);
    },
    POINT_MS + KEEPER_MS + 10_000,
  );

  it(
    "SIGTERM to the run's group while its own teardown is held by a paused server: the keeper finishes it",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "held-"));
      started.proxy = await startPausingProxy(server);
      const held = started.proxy.pauseOnFirstDelete();
      const { facts, receiptDir } = await driveTo(server, caseDir, "teardown", {
        endpoint: started.proxy.endpoint,
      });
      await within(held, POINT_MS, "the run's teardown sent no DELETE");

      // The scenario has returned and its teardown is waiting on the server.
      expect(started.driver!.exitCode).toBeNull();
      expect(existsSync(join(receiptDir, receiptFileName(facts.runId)))).toBe(false);

      process.kill(-started.driver!.pid!, "SIGTERM");
      expect(await exitOf(started.driver!)).toBe("SIGTERM");
      server.resume();
      const lines = await keeperFinished(receiptDir, facts.runId);
      await expectNothingLeft(client, caseDir, facts, receiptDir, lines);
    },
    2 * POINT_MS + KEEPER_MS + 10_000,
  );

  it(
    "an uncaught error thrown from a timer mid-scenario: the keeper cleans up",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "throw-"));
      const { facts, receiptDir, output } = await driveTo(server, caseDir, "uncaught-error");
      await expectMidScenario(client, facts);

      process.kill(started.driver!.pid!, "SIGUSR2");
      expect(await exitOf(started.driver!)).toBe(1);
      expect(output()).toContain(UNCAUGHT_MESSAGE);
      const lines = await keeperFinished(receiptDir, facts.runId);
      await expectNothingLeft(client, caseDir, facts, receiptDir, lines);
    },
    POINT_MS + KEEPER_MS + 10_000,
  );

  it(
    "a cleanup that cannot finish within the keeper's teardown limit says what is left, and its receipt's cleanup command removes it",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "fail-"));
      started.proxy = await startPausingProxy(server);
      const { facts, receiptDir } = await driveTo(server, caseDir, "mid-scenario", {
        endpoint: started.proxy.endpoint,
        flags: ["--teardown-ms", String(SHORT_TEARDOWN_MS)],
      });
      await expectMidScenario(client, facts);
      const held = started.proxy.pauseOnFirstDelete();

      process.kill(-started.driver!.pid!, "SIGINT");
      await within(held, KEEPER_MS, "the keeper sent no DELETE");
      const lines = await keeperFinished(receiptDir, facts.runId);
      server.resume();

      const said = `the keeper's log:\n${lines.join("\n")}`;
      expect(lines, said).toContain("left behind:");
      expect(lines, said).toContain(`bucket ${facts.bucket}`);
      expect(lines.at(-1), said).toBe("exit 1");
      const receiptPath = join(receiptDir, receiptFileName(facts.runId, "interrupted"));
      const interrupted = JSON.parse(await readFile(receiptPath, "utf8")) as {
        remaining: { bucket: string | null };
        cleanupCommand: string | null;
      };
      expect(interrupted.remaining.bucket, said).toBe(facts.bucket);
      expect(interrupted.cleanupCommand, said).toBe(cleanupCommandFor(REGION, receiptPath));
      // Neither needs the server.
      expect(existsSync(facts.scratch!), said).toBe(false);
      expect(alive(facts.sleepPid!), said).toBe(false);
      expect(await rehearsalBuckets(client)).toEqual([facts.bucket]);

      const printed: string[] = [];
      const cleaned = await cleanupFromReceipt(receiptPath, {
        env: await profileEnv(server, caseDir),
        endpoint: server.endpoint,
        createAdminClient: (profile) =>
          createBucketClient({
            endpoint: server.endpoint,
            region: profile.region,
            bucket: "",
            prefix: "",
            accessKeyId: profile.accessKeyId,
            secretAccessKey: profile.secretAccessKey,
          }),
        print: (line) => printed.push(line),
      });
      expect(cleaned.ok, printed.join("\n")).toBe(true);
      expect(await rehearsalBuckets(client)).toEqual([]);
    },
    POINT_MS + 2 * KEEPER_MS + 10_000,
  );

  it(
    "a request off the run's plan is refused before the server sees it, and fails the run naming it",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "unplanned-"));
      const other = `${CASE_BUCKET_PREFIXES[1]}${caseDir.slice(-6).toLowerCase()}`;
      await client.send(new CreateBucketCommand({ Bucket: other }));
      try {
        const { driver, receiptDir, output } = await startDriver(server, caseDir, "unplanned", {
          flags: ["--other-bucket", other],
        });
        expect(await exitOf(driver), output()).toBe(1);
        const text = output();
        expect(text).toContain("REFUSED AwsRehearsalRefused");
        expect(text).not.toContain("SENT DeleteBucket");
        expect(text).toMatch(
          /1 unplanned request\(s\) refused before sending; the first: [^\n]*DeleteBucket/,
        );

        const accessLog = join(dir, "access.log");
        const onOther = async (): Promise<string[]> =>
          (await readFile(accessLog, "utf8"))
            .split("\n")
            .filter((line) => line.split(" ")[1] === other);
        // The control was sent last; once the server has logged it, it has logged everything before.
        const until = Date.now() + POINT_MS;
        while (!(await onOther()).some((line) => line.includes(" s3_GetBucketLocation "))) {
          if (Date.now() > until) {
            throw new Error(
              `the server never logged the control:\n${(await onOther()).join("\n")}`,
            );
          }
          await delay(POLL_MS);
        }
        expect((await onOther()).filter((line) => line.includes(" s3_DeleteBucket "))).toEqual([]);
        await client.send(new HeadBucketCommand({ Bucket: other }));
        expect(text).toContain("CONTROL sent");

        // The run itself ended, failed, and removed its bucket; its keeper had nothing to do.
        const facts = JSON.parse(
          text
            .split("\n")
            .find((line) => line.startsWith("RUN "))!
            .slice(4),
        ) as RunFacts;
        const lines = await keeperFinished(receiptDir, facts.runId);
        expect(lines).toContain("the run finished; nothing to do");
        expect(lines.at(-1)).toBe("exit 0");
        expect(await rehearsalBuckets(client)).toEqual([]);
        // A bucket outside the rehearsal's pattern is never named (design D3).
        expect(text).toContain("DeleteBucket was sent to a bucket this run did not create");
        expect(text).not.toContain(other);
        expect(
          await readFile(join(receiptDir, receiptFileName(facts.runId)), "utf8"),
        ).not.toContain(other);
      } finally {
        // Already gone when the refusal failed, which an assertion above reports.
        await client.send(new DeleteBucketCommand({ Bucket: other })).catch(() => undefined);
      }
    },
    POINT_MS + KEEPER_MS + 10_000,
  );

  it(
    "SIGINT to Vitest's process group mid-scenario: the keeper cleans up as it does for the driver",
    async (ctx) => {
      const { server, client, dir } = requireServer(ctx);
      const caseDir = await mkdtemp(join(dir, "vitest-"));
      const receiptDir = join(caseDir, "receipts");
      started.receiptDir = receiptDir;
      const facts = join(caseDir, "facts.txt");
      const vitest = spawn(process.execPath, [VITEST_BIN, "run", "--config", VITEST_CASE_CONFIG], {
        cwd: SERVER_ROOT,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...(await profileEnv(server, caseDir)),
          WAITRON_INTERRUPT_ENDPOINT: server.endpoint,
          WAITRON_INTERRUPT_RECEIPT_DIR: receiptDir,
          WAITRON_INTERRUPT_FACTS: facts,
        },
      });
      started.driver = vitest;
      let printed = "";
      vitest.stdout!.on("data", (chunk: Buffer) => (printed += chunk.toString()));
      vitest.stderr!.on("data", (chunk: Buffer) => (printed += chunk.toString()));
      const read = async (): Promise<string> =>
        existsSync(facts) ? readFile(facts, "utf8") : `(Vitest printed:)\n${printed}`;
      const run = await reachPoint(vitest, read, receiptDir, "mid-scenario");
      await expectMidScenario(client, run);

      process.kill(-vitest.pid!, "SIGINT");
      const lines = await keeperFinished(receiptDir, run.runId);
      await expectNothingLeft(client, caseDir, run, receiptDir, lines);
    },
    POINT_MS + KEEPER_MS + 10_000,
  );
});
