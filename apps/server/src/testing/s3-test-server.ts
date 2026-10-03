import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { LITESTREAM_VERSION } from "@waitron/stream";
import { isUnset } from "../env-value.js";
import { freePort } from "./free-ports.js";

// versitygw run as a plain child process: the S3-compatible server the stream loop and pause tests
// stream to, plus the lookup of the litestream binary those tests also need. No package suite may
// start a container (CLAUDE.md §4). Why versitygw, and the measurements behind the flags below, are
// in docs/developers/testing-guide.md → "The stream loop test skips locally without its two
// binaries, and a skip reads as a pass".

/** Must equal `VERSITYGW_VERSION` in `scripts/setup-s3-test-server.mjs`; that script's suite reads this line. */
export const VERSITYGW_VERSION = "1.8.0";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Where `node scripts/setup-s3-test-server.mjs` installs it. `WAITRON_VERSITYGW_BIN` overrides. */
export const DEFAULT_VERSITYGW_BIN = join(REPO_ROOT, ".bin", "versitygw");

/** Where `node scripts/setup-litestream.mjs` installs it. `WAITRON_LITESTREAM_BIN` overrides. */
export const DEFAULT_LITESTREAM_BIN = join(REPO_ROOT, ".bin", "litestream");

/** At least three characters: versitygw refuses shorter names with `InvalidBucketName`. */
const BUCKET = "waitron-loop";
/**
 * How long `startS3TestServer` waits for its server to answer, over every port it tries. No readiness
 * listing is given longer than what is left of it.
 */
export const READY_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 5_000;
const VERSION_TIMEOUT_MS = 10_000;
const PAUSE_TIMEOUT_MS = 5_000;

export type BinaryLookup = { ok: true; bin: string } | { ok: false; reason: string };

export interface S3TestServer {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The last 8 KiB the server printed, for a failure message. */
  log(): string;
  /** SIGTERM, then SIGKILL after a grace period; resolves once the process is gone either way. */
  stop(): Promise<void>;
  /** Resolves once the process state reports stopped after SIGSTOP. Throws once it has exited. */
  pause(): Promise<void>;
  /** Lets a paused process run again (SIGCONT). Throws once it has exited. */
  resume(): void;
}

/** The pinned versitygw, or why it is not usable here. Never throws. */
export async function resolveVersitygw(env: NodeJS.ProcessEnv): Promise<BinaryLookup> {
  const bin = isUnset(env.WAITRON_VERSITYGW_BIN)
    ? DEFAULT_VERSITYGW_BIN
    : env.WAITRON_VERSITYGW_BIN;
  try {
    const { stdout } = await promisify(execFile)(bin, ["--version"], {
      timeout: VERSION_TIMEOUT_MS,
    });
    const version = /^Version\s*:\s*(\S+)\s*$/m.exec(stdout)?.[1];
    if (version !== VERSITYGW_VERSION) {
      return {
        ok: false,
        reason: `${bin} reports versitygw ${version ?? "(no version line)"}, not the pinned ${VERSITYGW_VERSION}`,
      };
    }
    return { ok: true, bin };
  } catch (error) {
    return {
      ok: false,
      reason: `versitygw is not runnable at ${bin}: ${(error as Error).message}`,
    };
  }
}

/** The pinned Litestream, or why it is not usable here. Never throws. */
export async function resolveLitestream(env: NodeJS.ProcessEnv): Promise<BinaryLookup> {
  const bin = isUnset(env.WAITRON_LITESTREAM_BIN)
    ? DEFAULT_LITESTREAM_BIN
    : env.WAITRON_LITESTREAM_BIN;
  try {
    const { stdout } = await promisify(execFile)(bin, ["version"], {
      timeout: VERSION_TIMEOUT_MS,
    });
    const version = stdout.trim();
    if (version !== LITESTREAM_VERSION) {
      return {
        ok: false,
        reason: `${bin} reports litestream ${version}, not the pinned ${LITESTREAM_VERSION}`,
      };
    }
    return { ok: true, bin };
  } catch (error) {
    return {
      ok: false,
      reason: `litestream is not runnable at ${bin}: ${(error as Error).message}`,
    };
  }
}

/** Live servers, killed if the test process exits before a suite's teardown runs. */
const live = new Set<ChildProcess>();
process.once("exit", () => {
  for (const child of live) child.kill("SIGKILL");
});

/** What versitygw 1.8.0 prints when its port is already bound (it prints its banner first). */
const PORT_TAKEN = "address already in use";
/** How many ports `startS3TestServer` draws before it gives up. */
export const PORT_ATTEMPTS = 5;
/** How long one readiness listing may take before it counts as not ready yet. */
export const PROBE_TIMEOUT_MS = 1_000;

class PortTaken extends Error {}

/**
 * Start versitygw on an OS-chosen loopback port, serving one bucket from a directory under `root`.
 * `--sidecar` keeps object metadata in a plain directory rather than in extended attributes, so the
 * server does not depend on what the temporary filesystem supports. A directory under the gateway
 * root IS a bucket, so the bucket is made with `mkdir` and no S3 call.
 *
 * The port is drawn and released before versitygw binds it, so another test's server can take it
 * first. Each server therefore gets credentials of its own and is ready only once a listing signed
 * with them is answered, which no other server can do; a server that lost its port is started again
 * on a fresh one.
 */
export async function startS3TestServer(opts: {
  bin: string;
  root: string;
  readState?: () => Promise<string | undefined>;
}): Promise<S3TestServer> {
  const data = join(opts.root, "data");
  const meta = join(opts.root, "meta");
  await mkdir(join(data, BUCKET), { recursive: true });
  await mkdir(meta, { recursive: true });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const taken: string[] = [];
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    try {
      return await startOnPort(opts.bin, data, meta, await freePort(), deadline, opts.readState);
    } catch (error) {
      if (!(error instanceof PortTaken)) throw error;
      taken.push(error.message);
    }
  }
  throw new Error(
    `versitygw lost every one of the ${PORT_ATTEMPTS} ports it drew:\n${taken.join("\n")}`,
  );
}

async function startOnPort(
  bin: string,
  data: string,
  meta: string,
  port: number,
  deadline: number,
  readState?: () => Promise<string | undefined>,
): Promise<S3TestServer> {
  const accessKeyId = `waitron${randomBytes(8).toString("hex")}`;
  const secretAccessKey = randomBytes(16).toString("hex");
  const child = spawn(
    bin,
    [
      "--access",
      accessKeyId,
      "--secret",
      secretAccessKey,
      "--port",
      `127.0.0.1:${port}`,
      "posix",
      "--sidecar",
      meta,
      data,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  live.add(child);

  let log = "";
  const collect = (chunk: Buffer): void => {
    log = (log + chunk.toString()).slice(-8192);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let exitCode: number | null | undefined;
  // `close`, not `exit`: Node emits it once the pipes have closed, so the log already holds the
  // line a lost port is recognised by.
  const exited = new Promise<void>((resolve) => {
    const settle = (code: number | null): void => {
      exitCode = code;
      live.delete(child);
      resolve();
    };
    child.once("close", settle);
    child.once("error", () => settle(null));
  });
  const signal = (name: "SIGSTOP" | "SIGCONT"): void => {
    if (exitCode !== undefined) {
      throw new Error(
        `versitygw on 127.0.0.1:${port} exited with ${exitCode}, so it cannot take ${name}: ${log}`,
      );
    }
    child.kill(name);
  };
  const state =
    readState ??
    (async (): Promise<string | undefined> => {
      if (child.pid === undefined) return undefined;
      try {
        if (process.platform === "linux") {
          const stat = await readFile(`/proc/${child.pid}/stat`, "utf8");
          return stat.slice(stat.lastIndexOf(") ") + 2, stat.lastIndexOf(") ") + 3);
        }
        const { stdout } = await promisify(execFile)("ps", [
          "-o",
          "state=",
          "-p",
          String(child.pid),
        ]);
        return stdout.trim().charAt(0);
      } catch {
        return undefined;
      }
    });

  const server: S3TestServer = {
    endpoint: `http://127.0.0.1:${port}`,
    region: "us-east-1",
    bucket: BUCKET,
    accessKeyId,
    secretAccessKey,
    log: () => log,
    pause: () => {
      signal("SIGSTOP");
      return (async () => {
        const deadline = Date.now() + PAUSE_TIMEOUT_MS;
        while ((await state()) !== "T") {
          if (exitCode !== undefined || Date.now() >= deadline) {
            throw new Error(`versitygw did not stop after SIGSTOP: ${log}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      })();
    },
    resume: () => signal("SIGCONT"),
    async stop() {
      if (exitCode !== undefined) return;
      child.kill("SIGCONT"); // a paused process cannot act on SIGTERM
      child.kill("SIGTERM");
      const grace = new Promise<"late">((resolve) =>
        setTimeout(() => resolve("late"), STOP_GRACE_MS),
      );
      if ((await Promise.race([exited.then(() => "gone" as const), grace])) === "late") {
        child.kill("SIGKILL");
        child.stdout?.destroy();
        child.stderr?.destroy();
        await exited;
      }
    },
  };

  const client = new S3Client({
    endpoint: server.endpoint,
    region: server.region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  });
  try {
    for (;;) {
      if (exitCode !== undefined) {
        const words = `versitygw exited with ${exitCode} before answering on 127.0.0.1:${port}: ${log}`;
        throw log.includes(PORT_TAKEN) ? new PortTaken(words) : new Error(words);
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error(
          `versitygw did not answer on 127.0.0.1:${port} within ${READY_TIMEOUT_MS}ms: ${log}`,
        );
      }
      if (await answers(client, Math.min(PROBE_TIMEOUT_MS, left))) return server;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    await server.stop();
    throw error;
  } finally {
    client.destroy();
  }
}

/** Whether a listing signed with this server's own credentials is answered. */
async function answers(client: S3Client, timeoutMs: number): Promise<boolean> {
  try {
    await client.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }), {
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}
