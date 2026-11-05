import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { signDocumentBody } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loadBoxEnv } from "./box-env.js";
import type { StartedServer } from "./boot.js";
import { parseEnvFile } from "./env-file.js";
import { readActivatedFrom } from "./start-peer-check.js";
import { expectChildKilled } from "./testing/child-process-death.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import type {
  ActivationKillArgs,
  ActivationKillPoint,
} from "./testing/handover-activation-kill-child.js";
import {
  ADMIN_EMAIL,
  OPERATION,
  PASSWORD,
  binding,
  placedSpareFixture,
  primary,
  standby,
} from "./testing/handover-placed-copy.js";
import { holdChart } from "./testing/place-copy-box.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
// `startServer` serves plain HTTP here; `handover-activation.test.ts` covers the refusal itself.
vi.mock("./node-operation-https.js", () => ({ requireNodeOperationHttps: () => {} }));

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBefore = useVenueDb({ migrations, timeoutMs: 60_000 });
const signIn = { email: ADMIN_EMAIL, password: PASSWORD };
const KILL_CHILD = fileURLToPath(
  new URL("./testing/handover-activation-kill-child.ts", import.meta.url),
);
const ACTIVATING_AT = "2026-10-16T12:40:00Z";

let root: string;
let started: StartedServer | undefined;
const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});
const fixture = placedSpareFixture({ mainBox, spareBefore, dirs });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "handover-activation-repair-"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
});
afterEach(async () => {
  await started?.close();
  started = undefined;
  vi.useRealTimers();
  external.internet.mockReset();
  await rm(root, { recursive: true, force: true });
});

async function spareEnv(): Promise<Record<string, string>> {
  const { spareState, spareVenue } = dirs();
  const migrationsRoot = join(root, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(
    join(spareState, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  return {
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_STATE_DIR: spareState,
    WAITRON_VENUE_DIR: spareVenue,
    WAITRON_NODE_ID: standby.nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_MAX_TICK_MS: "600000",
    WAITRON_MIN_TICK_MS: "200",
    WAITRON_LOG_DIR: join(spareState, "logs"),
  };
}

/** A copy placed, then the real routes in their own process, killed at `at`. */
async function killedActivating(at: ActivationKillPoint) {
  const placed = await fixture.placeRealCopy();
  await placed.close();
  const { spareState, spareVenue } = dirs();
  const args: ActivationKillArgs = {
    venueDir: spareVenue,
    stateDir: spareState,
    nodeId: standby.nodeId,
    operationId: OPERATION,
    at,
    instant: ACTIVATING_AT,
    binding,
    signIn,
  };
  await expectChildKilled(
    promisify(execFile)(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), KILL_CHILD, JSON.stringify(args)],
      { timeout: 90_000 },
    ),
    { signal: "SIGKILL", stdout: `killed at ${at}\n` },
  );
  return placed;
}

/** The real start, with the real start check: M1 is switched off, so nothing answers it. */
async function startAfterTheKill(env?: Record<string, string>) {
  const restarts: string[] = [];
  beforeServerStarts();
  vi.setSystemTime(new Date("2026-10-16T12:41:00Z"));
  started = await startServer(env ?? (await spareEnv()), undefined, {
    stepdown: { mount: () => {}, restart: () => restarts.push("restart") },
  });
  return restarts;
}

async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `http://127.0.0.1:${httpPort()}/api/node/handover/${OPERATION}/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

async function acceptingSales(): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
  return ((await response.json()) as { acceptingSales?: unknown }).acceptingSales;
}

const fresh = () => ({ moduleOperation: { binding, input: null }, signIn });
const codeOf = (answer: { body: unknown }) =>
  (answer.body as { error?: { code?: string } }).error?.code;

function operationStateOnDisk(): string {
  const node = new DatabaseSync(join(dirs().spareVenue, "node.db"), { readOnly: true });
  try {
    return (node.prepare("select state from node_handover_operations").get() as { state: string })
      .state;
  } finally {
    node.close();
  }
}

/** What a stopped box holds. */
async function readDisk() {
  const { spareVenue } = dirs();
  const venue = new DatabaseSync(join(spareVenue, "venue.db"), { readOnly: true });
  const node = new DatabaseSync(join(spareVenue, "node.db"), { readOnly: true });
  const facts = (() => {
    try {
      const count = (db: DatabaseSync, query: string) =>
        (db.prepare(`select count(*) as n from ${query}`).get() as { n: number }).n;
      return {
        chartTerm: (venue.prepare("select term from node_membership").get() as { term: number })
          .term,
        activations: count(venue, "handover_activations"),
        ownSif: count(venue, `registro_sif where node_id = '${standby.nodeId}'`),
        state: (
          node.prepare("select state from node_handover_operations").get() as { state: string }
        ).state,
        activatedEvents: count(node, "node_handover_events where kind = 'activated'"),
        mode: (
          node.prepare("select mode from node_mode where node_id = ?").get(standby.nodeId) as {
            mode: string;
          }
        ).mode,
      };
    } finally {
      venue.close();
      node.close();
    }
  })();
  const store = await openVenueDatabase(spareVenue);
  try {
    return { ...facts, activatedFrom: [...(await readActivatedFrom(store.node, standby.nodeId))] };
  } finally {
    await store.close();
  }
}

const ACTIVATED_ON_DISK = {
  chartTerm: 2,
  activations: 1,
  ownSif: 1,
  state: "activated",
  activatedEvents: 1,
  mode: "primary",
  activatedFrom: [primary.nodeId],
};

describe("a box killed while activating, then a real start with its old box switched off", () => {
  // R21 also carries the selling: M2's own promotion chart leaves M1 uncounted. What only this
  // repair does is the record: without it the state stays `filing_assumed` and the set is empty.
  it.each<[string, ActivationKillPoint]>([
    ["between the venue.db commit and its node.db records", "venue-commit"],
    ["after the role, before the activated record", "role"],
  ])(
    "M2 killed %s restarts and sells, recorded activated with M1 as its source",
    async (_name, at) => {
      await killedActivating(at);
      expect(await readDisk()).toEqual({
        ...ACTIVATED_ON_DISK,
        state: "filing_assumed",
        activatedEvents: 0,
        mode: at === "role" ? "primary" : "mirror",
        activatedFrom: [],
      });

      const restarts = await startAfterTheKill();
      expect(await acceptingSales()).toBe(true);
      // Read before any request: the route's own repeat also records `activated`.
      expect(operationStateOnDisk()).toBe("activated");
      // A page that asks for a fresh name, or lost its input: nothing is left owing.
      const again = await post("preparation", {
        ...fresh(),
        proposal: { action: "clock-challenge" },
      });
      expect(codeOf(again)).toBe("handover.step_out_of_order");
      expect(await post("activate", fresh())).toEqual({
        status: 200,
        body: { activated: true, restarting: false },
      });
      await started!.close();
      started = undefined;

      expect(await readDisk()).toEqual(ACTIVATED_ON_DISK);
      expect(restarts).toEqual([]);
    },
    180_000,
  );

  it("on a chart its old box signed, where only the repair's record leaves that box uncounted, the start still sells", async () => {
    const placed = await killedActivating("role");
    const body = {
      term: 3,
      nodes: [
        { nodeId: primary.nodeId, contactUrl: "https://main.example", standing: "sell-only" },
        {
          nodeId: standby.nodeId,
          contactUrl: "https://spare.example",
          standing: "serving-primary",
        },
      ],
    } as const;
    holdChart(join(dirs().spareVenue, "venue.db"), {
      ...placed.chart,
      body,
      signature: signDocumentBody(body, placed.mainKey),
    });

    await startAfterTheKill();
    expect(await acceptingSales()).toBe(true);
    expect(operationStateOnDisk()).toBe("activated");
  }, 180_000);

  it("a box whose own chart names it primary but holds no handover_activations row is not recorded as activated", async () => {
    await killedActivating("venue-commit");
    const venue = new DatabaseSync(join(dirs().spareVenue, "venue.db"));
    try {
      const triggers = venue
        .prepare(
          "select name from sqlite_master where type = 'trigger' and tbl_name = 'handover_activations'",
        )
        .all() as { name: string }[];
      for (const { name } of triggers) venue.exec(`drop trigger "${name}"`);
      venue.exec("delete from handover_activations");
    } finally {
      venue.close();
    }

    await startAfterTheKill();
    await started!.close();
    started = undefined;

    expect(await readDisk()).toEqual({
      ...ACTIVATED_ON_DISK,
      activations: 0,
      state: "filing_assumed",
      activatedEvents: 0,
      activatedFrom: [],
    });
  }, 180_000);

  it("killed after trading.env and before the commit, the box stays a mirror with the leftover file, and can activate", async () => {
    await killedActivating("trading-env");
    const { spareState } = dirs();
    const written = parseEnvFile(await readFile(join(spareState, "trading.env"), "utf8"));
    expect(Object.keys(written).sort()).toEqual([
      "WAITRON_ACCOUNT_KEY",
      "WAITRON_ENV",
      "WAITRON_NODE_ID",
    ]);
    expect(written).toMatchObject({
      WAITRON_ENV: "preproduction",
      WAITRON_NODE_ID: standby.nodeId,
    });

    // The node id comes from the file here, as on a box.
    const env = await spareEnv();
    delete env.WAITRON_NODE_ID;
    const restarts = await startAfterTheKill(
      (await loadBoxEnv(env, spareState)) as Record<string, string>,
    );
    expect(await acceptingSales()).toBe(false);

    const prepare = (proposal: unknown) => post("preparation", { ...fresh(), proposal });
    const challenge = await prepare({ action: "clock-challenge" });
    const compared = await prepare({
      action: "compare-clocks",
      browser: { challengeId: (challenge.body as { id: string }).id, instantMs: Date.now() },
    });
    const selected = await prepare({
      action: "select",
      comparisonId: (compared.body as { id: string }).id,
    });
    const activation = await post("activate", {
      moduleOperation: { binding, input: (selected.body as { input: unknown }).input },
      signIn,
    });
    expect(activation).toEqual({ status: 200, body: { activated: true, restarting: true } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await started!.close();
    started = undefined;
    expect(restarts).toEqual(["restart"]);
    expect(await readDisk()).toEqual(ACTIVATED_ON_DISK);
  }, 180_000);

  it("a mirror holding a row is left alone", async () => {
    const placed = await fixture.placeRealCopy();
    await placed.close();
    const venue = new DatabaseSync(join(dirs().spareVenue, "venue.db"));
    try {
      venue
        .prepare(
          "insert into handover_activations (operation_id, scenario, source_node_id, destination_node_id, evidence, person_id, activated_at) values (?, 'controlled', ?, ?, '{}', ?, '2026-10-16T12:40:00.000Z')",
        )
        .run(OPERATION, primary.nodeId, standby.nodeId, OPERATION);
    } finally {
      venue.close();
    }

    await startAfterTheKill();
    expect(await acceptingSales()).toBe(false);
    await started!.close();
    started = undefined;

    expect(await readDisk()).toEqual({
      chartTerm: 1,
      activations: 1,
      ownSif: 0,
      state: "filing_assumed",
      activatedEvents: 0,
      mode: "mirror",
      activatedFrom: [],
    });
  }, 180_000);
});
