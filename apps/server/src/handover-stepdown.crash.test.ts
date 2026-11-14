import { seedModuleSettings } from "../test/module-settings.js";
// Power loss is a child process running the real server, killed with SIGKILL at the step under
// test: no close, no stop of any duty, the store's handles dropped by the operating system. The
// restart then runs in this process on the same folders, with AEAT replaced by a counting stand-in.
// Each step is reached through a module the child swaps in at load, which writes a marker to file
// descriptor 3 and kills its own process there, so a case that crashed earlier names the wrong marker.
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import type { HandoverBinding } from "@waitron/handover";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverOperation, readHandoverRestriction } from "@waitron/node-db";
import { NODE_FILE, VENUE_FILE } from "@waitron/store";
import type { StartedServer } from "./boot.js";
import { beginHandover } from "./handover-store.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import {
  retainHttpListener,
  retainedHttpPreload,
  transferRetainedListeners,
} from "./testing/retained-http-listener.js";
import { provisionBillVenue } from "./testing/bill-venue.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

/** The fiscal passes the restarted box began, and the AEAT submissions they made. */
const aeat = vi.hoisted(() => ({ drains: 0, submits: 0 }));

// The real drain, with AEAT's transport replaced by a fake that counts submissions.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      if (real.id !== "verifactu") return real;
      const drainHere: typeof real.drain = async (
        { db, environment, skipRetryMs, signal },
        now,
      ) => {
        aeat.drains += 1;
        // Imported here: the fiscal package imports this mocked module, so a factory-time import
        // never settles.
        const { drain } = await import("@waitron/fiscal-verifactu");
        const { createFakeAeat } = await import("@waitron/verifactu/testing");
        const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") }).client();
        const client = {
          ...fake,
          submit: (...submitted: Parameters<typeof fake.submit>) => {
            aeat.submits += 1;
            return fake.submit(...submitted);
          },
        };
        return drain(
          {
            db,
            resolveClient: () => Promise.resolve(client),
            skipRetryMs,
            environment,
            ...(signal === undefined ? {} : { signal }),
          },
          now,
        );
      };
      return { ...real, drain: drainHere };
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const DESTINATION = "22222222-2222-4222-8222-222222222222";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** How long a restarted box is watched for AEAT traffic; the control's first submission lands inside it. */
const QUIET_MS = 2_000;
/** The child starts in about two seconds locally; on a CI shard a first, cold child took over 15. */
const CHILD_LIMIT_MS = 45_000;
const HEALTH_LIMIT_MS = 10_000;
/** Over the sum of one case's waits: three child waits, two health waits and the quiet wait. */
const CASE_LIMIT_MS = 3 * CHILD_LIMIT_MS + 2 * HEALTH_LIMIT_MS + QUIET_MS + 30_000;

type CrashPoint =
  | "before-node-transaction"
  | "gate-close"
  | "quiesce"
  | "after-node-transaction"
  | "admitted-work"
  | "close";

const here = (file: string) => new URL(file, import.meta.url).href;

function wrapper(original: string, body: string): string {
  return `import * as actual from ${JSON.stringify(original)};
export * from ${JSON.stringify(original)};
const t = globalThis.__stepdownCrash;
${body}`;
}

const GATE = wrapper(
  here("./handover-gate.ts"),
  `export function createHandoverGate() {
  const gate = actual.createHandoverGate();
  return {
    ...gate,
    close(deps) {
      if (t.at === "gate-close") t.die("gate-close");
      gate.close(deps);
    },
    settled(limitMs) {
      const waiting = gate.settled(limitMs);
      if (t.at === "admitted-work") {
        let done = false;
        void waiting.then(() => { done = true; });
        setTimeout(() => t.die(done ? "admitted-work settled early" : "admitted-work"), 200);
      }
      return waiting;
    },
  };
}`,
);

const DUTIES = wrapper(
  here("./background-duties.ts"),
  `export function backgroundDuties(handles) {
  const duties = actual.backgroundDuties(handles);
  if (t.at !== "quiesce") return duties;
  let told = 0;
  return {
    ...duties,
    aborts: duties.aborts.map((duty) => ({
      ...duty,
      abort() {
        told += 1;
        if (told === 2) t.die("quiesce");
        duty.abort();
      },
    })),
  };
}
export async function stopBackgroundDuties(duties) {
  await actual.stopBackgroundDuties(duties);
  if (t.at === "close") t.die("close");
}`,
);

const STEPDOWN = wrapper(
  here("./handover-stepdown.ts"),
  `export async function stepDown(deps, request) {
  if (t.at === "before-node-transaction") t.die("before-node-transaction");
  const result = await actual.stepDown(deps, request);
  if (t.at === "after-node-transaction") t.die("after-node-transaction");
  return result;
}`,
);

const INTERNET = wrapper(
  here("../../../packages/fiscal-verifactu/src/hour-clock-internet.ts"),
  `export function authenticatedHourHead() {
  return Promise.reject(new Error("the crashing child asks AEAT nothing for the time"));
}`,
);

// The child stands for a box that prepared the handover while it was running, so its own start
// neither abandons the operation the suite seeded at `prepared` (`repairAtStart`) nor waits on it
// (the `peerCheck` seam below). The restart after the crash runs the real start check.
const START_CHECK = wrapper(
  here("./start-peer-check.ts"),
  `export async function repairAtStart() {}`,
);

const CHILD = `import { registerHooks } from "node:module";
import { writeSync } from "node:fs";
const mark = (line) => writeSync(3, line + "\\n");
globalThis.__stepdownCrash = {
  at: process.env.WAITRON_TEST_CRASH_AT,
  die(line) { mark(line); process.kill(process.pid, "SIGKILL"); },
};
const swaps = { "/handover-gate.js": ${JSON.stringify(GATE)}, "/background-duties.js": ${JSON.stringify(DUTIES)}, "/handover-stepdown.js": ${JSON.stringify(STEPDOWN)}, "/hour-clock-internet.js": ${JSON.stringify(INTERNET)}, "/start-peer-check.js": ${JSON.stringify(START_CHECK)} };
registerHooks({ resolve(specifier, context, next) {
  const swap = Object.entries(swaps).find(([end]) => specifier.endsWith(end));
  return swap === undefined ? next(specifier, context) : { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(swap[1]) };
}});
const { startServer } = await import(${JSON.stringify(here("./boot.ts"))});
const { env, binding, timings } = JSON.parse(process.argv[1]);
await startServer(env, env, {
  timings,
  peerCheck: () => Promise.resolve({ result: "proceed", successorNodeId: null }),
  stepdown: {
    mount(app, stepDown) {
      app.post("/test/hold", () => { mark("held"); return new Promise(() => {}); });
      app.post("/test/stepdown", async (c) => c.json(await stepDown({ binding, kind: "handed-over", self: c })));
    },
  },
  restart() { mark("restart"); },
});
mark("started");`;

interface Child {
  process: ChildProcess;
  marks: string[];
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const children: ChildProcess[] = [];
let server: StartedServer | undefined;
let scratch: string | undefined;

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  try {
    if (server !== undefined) await server.close();
  } finally {
    server = undefined;
    aeat.drains = 0;
    aeat.submits = 0;
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

async function startChild(
  at: CrashPoint,
  env: Record<string, string>,
  binding: HandoverBinding,
  startupDeadline: number,
): Promise<Child & { port: number }> {
  const held = await retainHttpListener();
  env = { ...env, WAITRON_HTTP_PORT: String(held.port) };
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("WAITRON_")),
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      retainedHttpPreload,
      "--import",
      import.meta.resolve("tsx"),
      "--input-type=module",
      "-e",
      CHILD,
      JSON.stringify({ env, binding, timings: { minTickMs: 200, maxTickMs: 600_000 } }),
    ],
    {
      env: { ...base, ...env, WAITRON_TEST_CRASH_AT: at },
      stdio: ["ignore", "pipe", "pipe", "pipe", "ipc"],
    },
  );
  children.push(child);
  let output = "";
  let pending = "";
  const marks: string[] = [];
  child.stdout!.on("data", (bytes: Buffer) => (output += bytes.toString()));
  child.stderr!.on("data", (bytes: Buffer) => (output += bytes.toString()));
  (child.stdio[3] as NodeJS.ReadableStream).on("data", (bytes: Buffer) => {
    pending += bytes.toString();
    const lines = pending.split("\n");
    pending = lines.pop()!;
    marks.push(...lines);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  const stopped = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  try {
    await transferRetainedListeners(child, [held], Math.max(1, startupDeadline - Date.now()));
    return { process: child, marks, output: () => output, exited, port: held.port };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await stopped;
    throw error;
  } finally {
    if (held.server.listening) await held.close();
  }
}

async function waitForMark(
  child: Child,
  mark: string,
  deadline = Date.now() + CHILD_LIMIT_MS,
): Promise<void> {
  while (!child.marks.includes(mark)) {
    if (child.process.exitCode !== null || child.process.signalCode !== null)
      throw new Error(`the child ended before "${mark}": ${child.output()}`);
    if (Date.now() > deadline) throw new Error(`no "${mark}" from the child: ${child.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Rejects naming the child's output if it has not ended within `CHILD_LIMIT_MS`. */
async function ending(child: Child) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.process.kill("SIGKILL");
      reject(new Error(`the child did not end: ${child.output()}`));
    }, CHILD_LIMIT_MS);
  });
  try {
    return await Promise.race([child.exited, late]);
  } finally {
    clearTimeout(timer);
  }
}

interface Restarted {
  node: { status: number; body: Record<string, unknown> };
  operationState: string | undefined;
  /** node.db's write-ahead log as the kill left it. */
  nodeWalBytes: number;
  restriction: Awaited<ReturnType<typeof readHandoverRestriction>>;
  enviosBefore: unknown[];
  enviosAfter: unknown[];
}

async function crashThenRestart(at: CrashPoint): Promise<Restarted> {
  beforeServerStarts();
  const venue = await provisionBillVenue(suite.db);
  const nodeId = venue.cfg.nodeId;
  const binding: HandoverBinding = {
    operationId: OP,
    scenario: "controlled",
    venue: { country: "ES", taxId: "61000002T", environment: "preproduction" },
    sourceNodeId: nodeId,
    destinationNodeId: DESTINATION,
    membership: { term: 3, digest: "a".repeat(64) },
  };
  await beginHandover({ node: suite.node, nodeId }, binding, "source");

  scratch = await mkdtemp(join(tmpdir(), "waitron-stepdown-crash-"));
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await seedModuleSettings(suite.db, { "fiscal-none": false });
  // Records waiting for AEAT: a box that starts as a filing primary sends them. The child is started
  // without test submissions, so it files none of them.
  await seedPendingEnvios(suite.db, {
    count: 3,
    identity: { locationId: venue.cfg.locationId, nodeId, nif: "61000002T" },
    entorno: "preproduction",
  });
  const enviosBefore = suite.db.all(sql`select * from envios order by rowid`);
  // The suite holds its own folder for this process, so the child gets a copy of it.
  const venueDir = join(scratch, "venue");
  await mkdir(venueDir);
  suite.db.run(sql`vacuum into ${join(venueDir, VENUE_FILE)}`);
  suite.node.run(sql`vacuum into ${join(venueDir, NODE_FILE)}`);
  const childEnv: Record<string, string> = {
    ...KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
  };
  const env = { ...childEnv, WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled" };

  const startupDeadline = Date.now() + CHILD_LIMIT_MS;
  const child = await startChild(
    at,
    { ...childEnv, WAITRON_HTTP_HOST: "127.0.0.1" },
    binding,
    startupDeadline,
  );
  await waitForMark(child, "started", startupDeadline);
  const base = `http://127.0.0.1:${child.port}`;
  await vi.waitFor(
    async () => {
      expect((await fetch(`${base}/health`)).status).toBe(200);
    },
    { timeout: HEALTH_LIMIT_MS },
  );
  const expected = ["started"];
  if (at === "admitted-work") {
    void fetch(`${base}/test/hold`, { method: "POST" }).catch(() => undefined);
    await waitForMark(child, "held");
    expected.push("held");
  }
  // A stepdown killed before it answers drops this request's connection.
  void fetch(`${base}/test/stepdown`, { method: "POST" }).catch(() => undefined);
  const ended = await ending(child);
  expect(
    { signal: ended.signal, marks: child.marks },
    `the child's output:\n${child.output()}`,
  ).toEqual({ signal: "SIGKILL", marks: [...expected, at] });

  // Read before the restart, which replays the log; a graceful close would have removed the file.
  const nodeWalBytes = (await stat(join(venueDir, `${NODE_FILE}-wal`))).size;
  server = await startServer(env, env, { timings: { maxTickMs: 600000, minTickMs: 200 } });
  const restartedBase = `http://127.0.0.1:${httpPort()}`;
  await vi.waitFor(
    async () => {
      expect((await fetch(`${restartedBase}/health`)).status).toBe(200);
    },
    { timeout: HEALTH_LIMIT_MS },
  );
  const answer = await fetch(`${restartedBase}/api/node`);
  const node = { status: answer.status, body: (await answer.json()) as Record<string, unknown> };
  // A read beside the running server, sharing its hold on the folder.
  const reading = await openVenueDatabase(venueDir);
  try {
    const operation = await readHandoverOperation(reading.node, nodeId, OP);
    return {
      node,
      nodeWalBytes,
      operationState: operation?.state,
      restriction: await readHandoverRestriction(reading.node, nodeId),
      enviosBefore,
      enviosAfter: reading.venue.all(sql`select * from envios order by rowid`),
    };
  } finally {
    await reading.close();
  }
}

describe("power lost part-way through a stepdown", () => {
  it.each([
    ["after the node transaction, before the answer", "after-node-transaction"],
    ["while it waits for admitted work", "admitted-work"],
    ["while it closes", "close"],
  ] as const)(
    "%s, the box comes back restricted and files nothing with AEAT",
    async (_, at) => {
      const restarted = await crashThenRestart(at);
      // The stepdown's writes were still in the log the restart replayed.
      expect(restarted.nodeWalBytes).toBeGreaterThan(0);
      expect(restarted.node).toMatchObject({ status: 200, body: { acceptingSales: false } });
      expect(restarted.operationState).toBe("source_stepped_down");
      expect(restarted.restriction).toMatchObject({ kind: "handed-over", operationId: OP });
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
      expect(aeat).toEqual({ drains: 0, submits: 0 });
      // Neither the child nor the restart touched the waiting records.
      expect(restarted.enviosAfter).toEqual(restarted.enviosBefore);
    },
    CASE_LIMIT_MS,
  );

  // The duties are told to stop before the node transaction, so a power cut while they are told
  // leaves nothing written.
  it.each([
    ["before the node transaction", "before-node-transaction"],
    ["as the gate closes, before any duty is told", "gate-close"],
    ["while the outside work is being told to stop, before the write", "quiesce"],
  ] as const)(
    "%s, the box comes back a primary that files",
    async (_, at) => {
      const restarted = await crashThenRestart(at);
      expect(restarted.node).toMatchObject({ status: 200, body: { acceptingSales: true } });
      expect(restarted.operationState).not.toBe("source_stepped_down");
      expect(restarted.restriction).toBeNull();
      await vi.waitFor(() => expect(aeat.submits).toBeGreaterThan(0), { timeout: QUIET_MS });
    },
    CASE_LIMIT_MS,
  );
});
