import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { openVenueDatabase } from "@waitron/db";

const READY_DEADLINE_MS = 90_000;
const HEALTH_DEADLINE_MS = 10_000;
const SHUTDOWN_DEADLINE_MS = 15_000;
const SERVER_DIR = resolve(import.meta.dirname, "..");

interface Fixture {
  root: string;
  child: ChildProcess;
  exited: Promise<number | null>;
  /** Settles once the output pipes have closed, which can be after `exit`. */
  closed: Promise<void>;
  output: () => string;
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const { root, child, exited } of fixtures.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function launch(prepare: (root: string) => Promise<NodeJS.ProcessEnv>): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "cloud-integration-"));
  let env: NodeJS.ProcessEnv;
  try {
    env = await prepare(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const child = spawn(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), "scripts/cloud-integration-fixture.ts"],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        CLOUD_TEST_ROOT: root,
        CLOUD_TEST_ORIGIN: "http://127.0.0.1:9",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  const closed = new Promise<void>((r) => child.once("close", () => r()));
  let output = "";
  child.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const fixture = { root, child, exited, closed, output: () => output };
  fixtures.push(fixture);
  return fixture;
}

/** ready.json's text, or `undefined` once the fixture has exited without writing it. */
async function readyOrExit({ root, exited }: Fixture): Promise<string | undefined> {
  let hasExited = false;
  void exited.then(() => (hasExited = true));
  const deadline = Date.now() + READY_DEADLINE_MS;
  while (Date.now() < deadline) {
    const text = await readFile(join(root, "ready.json"), "utf8").catch(() => undefined);
    if (text !== undefined) return text;
    if (hasExited) return undefined;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ready.json within ${READY_DEADLINE_MS} ms`);
}

function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} not within ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Waitron Cloud's integration scripts launch this fixture from a Waitron checkout.
it("the Cloud integration fixture provisions a preproduction venue and starts", async () => {
  const fixture = await launch(async (root) => {
    // Cloud's local-pairing guide has the dashboard built first; this checkout may not have.
    const dashboard = join(root, "dashboard");
    await mkdir(dashboard);
    await writeFile(join(dashboard, "index.html"), "<!doctype html>");
    return { WAITRON_DASHBOARD_APP_DIR: dashboard };
  });
  const text = await readyOrExit(fixture);
  if (text === undefined) {
    await withDeadline(fixture.closed, 2_000, "fixture output").catch(() => {});
    throw new Error(`fixture exited before ready.json:\n${fixture.output()}`);
  }
  const ready = JSON.parse(text) as { origin: string; port: number; localVenueId: string };
  expect(ready.origin).toBe(`http://127.0.0.1:${ready.port}`);
  const health = await fetch(`${ready.origin}/health`, {
    signal: AbortSignal.timeout(HEALTH_DEADLINE_MS),
  });
  expect(health.status).toBe(200);
  fixture.child.kill("SIGTERM");
  expect(await withDeadline(fixture.exited, SHUTDOWN_DEADLINE_MS, "fixture shutdown")).toBe(0);

  const store = await openVenueDatabase(join(fixture.root, "venue"));
  try {
    expect(
      store.venue.all(
        sql`select taxpayer_nif, environment, allocation_key from fiscal_allocations`,
      ),
    ).toEqual([
      {
        taxpayer_nif: "73000001K",
        environment: "preproduction",
        allocation_key: expect.stringMatching(/^throwaway-/),
      },
    ]);
    expect(store.venue.all(sql`select environment from deployment`)).toEqual([
      { environment: "preproduction" },
    ]);
  } finally {
    await store.close();
  }
}, 150_000);

it("the Cloud integration fixture treats an empty WAITRON_DASHBOARD_APP_DIR as unset", async () => {
  const fixture = await launch(() => Promise.resolve({ WAITRON_DASHBOARD_APP_DIR: "" }));
  // The saved environment is written before the server starts, so it is there whether or not this
  // checkout has a built dashboard for the server to find.
  await readyOrExit(fixture);
  const saved = JSON.parse(await readFile(join(fixture.root, "fixture-env.json"), "utf8")) as {
    WAITRON_DASHBOARD_APP_DIR?: string;
  };
  expect(saved.WAITRON_DASHBOARD_APP_DIR).toBe(resolve(SERVER_DIR, "../dashboard/dist"));
}, 150_000);
