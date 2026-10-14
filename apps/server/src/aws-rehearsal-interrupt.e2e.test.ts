// A rehearsal run killed part-way, against versitygw: the keeper the run started cleans up after it
// (design D8–D10). The run is `./testing/aws-rehearsal-interrupt-driver.ts`, in a process group of its
// own. Install the server with `node scripts/setup-s3-test-server.mjs`. Without it each case is
// reported SKIPPED; with CI=true or WAITRON_REQUIRE_STREAM_BINARIES=1 a missing binary FAILS the case.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { journalFileName, processStartTime } from "./testing/aws-rehearsal-journal.js";
import { tsxLoaderUrl } from "./testing/aws-rehearsal-keeper-start.js";
import { receiptFileName } from "./testing/aws-rehearsal-receipt.js";
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
const REGION = "eu-north-1";
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
  scratch: string;
  sleepPid: number;
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
      // Being replaced as it was read; the pids it names are in the next one too.
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

describe("a rehearsal run killed part-way, against versitygw", () => {
  let dir: string | undefined;
  let s3: S3TestServer | undefined;
  let client: S3Client | undefined;
  /** Every pid this suite started or caused, stopped by pid alone in afterEach. */
  let started: {
    driver?: ChildProcess;
    receiptDir?: string;
    keeperPid?: number;
    sleepPid?: number;
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
    if (started.driver?.pid !== undefined) stopPid(started.driver.pid, true);
    // A case that failed before the driver's RUN line knows these only from the run's journal.
    const pids = new Set([started.keeperPid, started.sleepPid]);
    for (const journal of await journalsIn(started.receiptDir)) {
      if (journal.keeperPid !== null) pids.add(journal.keeperPid);
      // Only while it is still the process the run started.
      for (const { pid, startTime } of journal.pids) {
        if (startTime !== null && processStartTime(pid) === startTime) pids.add(pid);
      }
    }
    for (const pid of pids) stopPid(pid);
    started = {};
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

  /** Starts the driver in a process group of its own and waits for its `POINT <point>` line. */
  async function driveTo(
    server: S3TestServer,
    caseDir: string,
    point: string,
  ): Promise<{ facts: RunFacts; receiptDir: string; output: () => string }> {
    const receiptDir = join(caseDir, "receipts");
    started.receiptDir = receiptDir;
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
    const driver = spawn(
      process.execPath,
      [
        "--import",
        tsxLoaderUrl(),
        DRIVER,
        "--endpoint",
        server.endpoint,
        "--receipt-dir",
        receiptDir,
        "--point",
        point,
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          WAITRON_RUN_AWS_REHEARSAL: "1",
          AWS_PROFILE: "waitron-rehearsal",
          AWS_REGION: REGION,
          AWS_SHARED_CREDENTIALS_FILE: credentials,
          AWS_CONFIG_FILE: config,
          TMPDIR: tmp,
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? caseDir,
        },
      },
    );
    started.driver = driver;
    let text = "";
    driver.stdout!.on("data", (chunk: Buffer) => (text += chunk.toString()));
    driver.stderr!.on("data", (chunk: Buffer) => (text += chunk.toString()));
    const until = Date.now() + POINT_MS;
    while (!text.includes(`POINT ${point}\n`)) {
      if (driver.exitCode !== null || Date.now() > until) {
        throw new Error(`the driver did not reach ${point}; it printed:\n${text}`);
      }
      await delay(POLL_MS);
    }
    const line = text.split("\n").find((entry) => entry.startsWith("RUN "))!;
    const facts = JSON.parse(line.slice(4)) as RunFacts;
    started.sleepPid = facts.sleepPid;
    const journal = JSON.parse(
      await readFile(join(receiptDir, journalFileName(facts.runId)), "utf8"),
    ) as { keeperPid: number | null };
    if (journal.keeperPid !== null) started.keeperPid = journal.keeperPid;
    return { facts, receiptDir, output: () => text };
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
      expect(existsSync(join(facts.scratch, "secrets", "secrets.env"))).toBe(true);
      expect(alive(facts.sleepPid)).toBe(true);
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
      expect(existsSync(facts.scratch), said).toBe(false);
      expect(alive(facts.sleepPid), said).toBe(false);
      const interrupted = JSON.parse(
        await readFile(join(receiptDir, receiptFileName(facts.runId, "interrupted")), "utf8"),
      ) as { remaining: { bucket: string | null } };
      expect(interrupted.remaining.bucket).toBeNull();
      expect(lines).toContain("nothing left behind");
      expect(lines.at(-1)).toBe("exit 0");
    },
    POINT_MS + KEEPER_MS + 10_000,
  );
});
