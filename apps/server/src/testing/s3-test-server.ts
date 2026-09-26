import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createConnection, createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LITESTREAM_VERSION } from "@waitron/stream";
import { isUnset } from "../env-value.js";

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

const ACCESS_KEY_ID = "waitronlooptest";
const SECRET_ACCESS_KEY = "waitron-loop-test-secret";
/** At least three characters: versitygw refuses shorter names with `InvalidBucketName`. */
const BUCKET = "waitron-loop";
/** How long `startS3TestServer` waits for the port to accept, before it gives up. */
export const READY_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 5_000;
const VERSION_TIMEOUT_MS = 10_000;

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
  /** Freezes the process (SIGSTOP): every call to it then hangs, answering nothing. */
  pause(): void;
  /** Lets a paused process run again (SIGCONT). */
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

/**
 * Start versitygw on an OS-chosen loopback port, serving one bucket from a directory under `root`.
 * `--sidecar` keeps object metadata in a plain directory rather than in extended attributes, so the
 * server does not depend on what the temporary filesystem supports. A directory under the gateway
 * root IS a bucket, so the bucket is made with `mkdir` and no S3 call.
 */
export async function startS3TestServer(opts: {
  bin: string;
  root: string;
}): Promise<S3TestServer> {
  const data = join(opts.root, "data");
  const meta = join(opts.root, "meta");
  await mkdir(join(data, BUCKET), { recursive: true });
  await mkdir(meta, { recursive: true });
  const port = await freePort();

  const child = spawn(
    opts.bin,
    [
      "--access",
      ACCESS_KEY_ID,
      "--secret",
      SECRET_ACCESS_KEY,
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
  const exited = new Promise<void>((resolve) => {
    const settle = (code: number | null): void => {
      exitCode = code;
      live.delete(child);
      resolve();
    };
    child.once("exit", settle);
    child.once("error", () => settle(null));
  });

  const server: S3TestServer = {
    endpoint: `http://127.0.0.1:${port}`,
    region: "us-east-1",
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    log: () => log,
    pause() {
      if (exitCode === undefined) child.kill("SIGSTOP");
    },
    resume() {
      if (exitCode === undefined) child.kill("SIGCONT");
    },
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

  const deadline = Date.now() + READY_TIMEOUT_MS;
  try {
    for (;;) {
      if (exitCode !== undefined) {
        throw new Error(`versitygw exited with ${exitCode} before listening on ${port}: ${log}`);
      }
      if (await accepts(port)) return server;
      if (Date.now() >= deadline) {
        throw new Error(
          `versitygw did not listen on 127.0.0.1:${port} within ${READY_TIMEOUT_MS}ms: ${log}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    await server.stop();
    throw error;
  }
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** An OS-assigned port, released before use — the same shape as `boot.test.ts`'s `freePort`. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
