import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./store.ts";

export const LITESTREAM_VERSION = "0.5.18";

const CHILD_TIMEOUT_MS = 30_000;

const KILL_GRACE_MS = 5_000;

export const BUNDLED_BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".bin",
  "litestream",
);

// The config names environment variables so credentials stay in the child process's environment.
const ENV_ACCESS_KEY_ID = "WAITRON_BENCH_ACCESS_KEY_ID";
const ENV_SECRET_ACCESS_KEY = "WAITRON_BENCH_SECRET_ACCESS_KEY";

const credentialsByConfig = new Map<string, Store["credentials"]>();

// Compaction settings belong at the top level. Litestream ignores them under `dbs[0]`.
const FAST_COMPACTION = [
  `l0-retention: 2s`,
  `l0-retention-check-interval: 1s`,
  `levels:`,
  `  - interval: 2s`,
  `  - interval: 30s`,
  `  - interval: 60s`,
];

// A missing or unusable pin returns `null` so each scenario can decide whether to skip.
export async function resolveLitestream(): Promise<{ bin: string; version: string } | null> {
  const candidates = [process.env.WAITRON_LITESTREAM_BIN, BUNDLED_BIN, "litestream"];
  for (const bin of candidates) {
    if (!bin) continue;
    const probe = await run(bin, ["version"], { timeoutMs: 10_000 });
    if (probe.code !== 0) continue;
    const version = probe.stdout.trim();
    if (version === LITESTREAM_VERSION) return { bin, version };
  }
  return null;
}

export function writeConfig(opts: {
  dbPath: string;
  /**
   * Only these three fields are read, and measurement 5 builds one inside a Linux container where
   * the SDK client a full `Store` carries is not installed.
   */
  store: Pick<Store, "bucket" | "endpoint" | "credentials">;
  prefix: string;
  configPath: string;
  fastCompaction?: boolean;
  // Extra top-level YAML lets probes supply their own snapshot and level settings.
  globalLines?: string[];
}): string {
  const { dbPath, store, prefix, configPath, fastCompaction = false, globalLines = [] } = opts;
  const url = `s3://${store.bucket}/${prefix}?endpoint=${store.endpoint}&region=us-east-1&force-path-style=true`;
  writeFileSync(
    configPath,
    [
      `access-key-id: \${${ENV_ACCESS_KEY_ID}}`,
      `secret-access-key: \${${ENV_SECRET_ACCESS_KEY}}`,
      ...(fastCompaction ? FAST_COMPACTION : []),
      ...globalLines,
      ``,
      `dbs:`,
      `  - path: ${dbPath}`,
      `    replica:`,
      `      url: ${url}`,
      ``,
    ].join("\n"),
  );
  credentialsByConfig.set(configPath, store.credentials);
  return configPath;
}

export function replicate(
  bin: string,
  config: string,
  onLog?: (chunk: string) => void,
): { kill(): void; exited: Promise<number | null> } {
  const child = spawn(bin, ["replicate", "-config", config], {
    env: childEnv(config),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  let killed = false;
  let log = "";
  // Capture stdout too, where the pinned binary logs by default.
  const collect = (chunk: Buffer) => {
    const text = chunk.toString();
    log = tail(log + text);
    onLog?.(text);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  let settleExit: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => {
    settleExit = (code) => {
      children.delete(child);
      resolve(code);
    };
    child.on("close", (code) => {
      if (!killed && code !== 0) console.error(`litestream replicate exited ${code}: ${log}`);
      settleExit(code);
    });
    child.on("error", () => settleExit(null));
  });

  return {
    kill() {
      killed = true;
      child.kill("SIGTERM");
      const escalation = setTimeout(() => {
        child.kill("SIGKILL");
        // Settle on `exit` because a surviving descendant can hold the stdio pipes open.
        child.stdout?.destroy();
        child.stderr?.destroy();
        settleExit(null);
      }, KILL_GRACE_MS);
      escalation.unref();
    },
    exited,
  };
}

// `dbName` is the path named in the config. The source file can be absent.
export async function restore(
  bin: string,
  config: string,
  dbName: string,
  outPath: string,
  extraArgs: string[] = [],
  timeoutMs: number = CHILD_TIMEOUT_MS,
): Promise<void> {
  const result = await run(
    bin,
    ["restore", "-config", config, ...extraArgs, "-o", outPath, dbName],
    { env: childEnv(config), timeoutMs },
  );
  if (result.timedOut) {
    throw new Error(`litestream restore was killed after ${timeoutMs}ms: ${result.stderr.trim()}`);
  }
  if (result.code !== 0) {
    throw new Error(`litestream restore exited ${result.code}: ${result.stderr.trim()}`);
  }
}

// Use `replicate -once` to upload outstanding changes without a resident daemon.
export async function syncOnce(
  bin: string,
  config: string,
  timeoutMs: number = CHILD_TIMEOUT_MS,
): Promise<void> {
  const result = await run(bin, ["replicate", "-once", "-config", config], {
    env: childEnv(config),
    timeoutMs,
  });
  if (result.timedOut) {
    throw new Error(
      `litestream replicate -once was killed after ${timeoutMs}ms: ${result.stderr.trim()}`,
    );
  }
  if (result.code !== 0) {
    throw new Error(`litestream replicate -once exited ${result.code}: ${result.stderr.trim()}`);
  }
}

const children = new Set<ReturnType<typeof spawn>>();
process.on("exit", () => {
  for (const child of children) child.kill("SIGTERM");
});

function childEnv(config: string): NodeJS.ProcessEnv {
  const credentials = credentialsByConfig.get(config);
  if (!credentials) {
    // The config names the two variables and holds no values, so a config this module did not write
    // would reach litestream with empty credentials and fail as an S3 error — which names the store,
    // not the mistake.
    throw new Error(`no credentials recorded for ${config}; it was not written by writeConfig`);
  }
  return {
    ...process.env,
    [ENV_ACCESS_KEY_ID]: credentials.accessKeyId,
    [ENV_SECRET_ACCESS_KEY]: credentials.secretAccessKey,
  };
}

function run(
  bin: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => (stdout = tail(stdout + chunk.toString())));
    child.stderr.on("data", (chunk: Buffer) => (stderr = tail(stderr + chunk.toString())));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // Destroy the pipes too, since a surviving descendant can keep Node alive through them.
      child.stdout.destroy();
      child.stderr.destroy();
      // Settle on `exit` before a surviving descendant can delay pipe closure.
      settle({ code: null, stdout, stderr });
    }, options.timeoutMs ?? CHILD_TIMEOUT_MS);

    function settle(result: { code: number | null; stdout: string; stderr: string }): void {
      clearTimeout(timer);
      resolve({ ...result, timedOut });
    }
    child.on("error", (error) => settle({ code: null, stdout, stderr: error.message }));
    child.on("close", (code) => settle({ code, stdout, stderr }));
  });
}

function tail(text: string): string {
  return text.length > 8192 ? text.slice(-8192) : text;
}
