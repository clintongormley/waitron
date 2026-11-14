import { openVenueDatabase } from "@waitron/db";
import { readModuleConfig } from "./module-config.js";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { enabledModules } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { signDocumentBody } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeMirrorLink } from "@waitron/node-db";
import { checkEmergencyCopy } from "./handover-emergency-check.js";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import {
  ADMIN_EMAIL,
  OPERATION,
  PASSWORD,
  binding,
  placedSpareFixture,
  primary,
  standby,
} from "./testing/handover-placed-copy.js";
import { THIRD_BOX, holdChart } from "./testing/place-copy-box.js";
import { mintBoxAuthority, startBoxServer } from "./testing/box-authority.js";

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

let root: string;
let started: StartedServer | undefined;
const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});
const fixture = placedSpareFixture({ mainBox, spareBefore, dirs });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "boot-chart-moved-on-"));
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
    WAITRON_LOG_DIR: join(spareState, "logs"),
  };
}

async function post(
  path: string,
  body: unknown,
  operationId = OPERATION,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `http://127.0.0.1:${httpPort()}/api/node/handover/${operationId}/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

let sentActivation: unknown;

const codeOf = (answer: { body: unknown }) =>
  (answer.body as { error?: { code?: string } }).error?.code;

/** The real start and the real routes, tried as far as each lets the next go, and what is on disk. */
async function startAndTryToActivate() {
  const restarts: string[] = [];
  beforeServerStarts();
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  started = await startServer(await spareEnv(), undefined, {
    timings: { minTickMs: 200, maxTickMs: 600_000 },
    peerCheck: async () => ({ result: "proceed", successorNodeId: null }),
    restart: () => restarts.push("restart"),
  });

  const prepare = (proposal: unknown) =>
    post("preparation", { moduleOperation: { binding, input: null }, signIn, proposal });
  const challenge = await prepare({ action: "clock-challenge" });
  let input: unknown = null;
  if (challenge.status === 200) {
    const compared = await prepare({
      action: "compare-clocks",
      browser: { challengeId: (challenge.body as { id: string }).id, instantMs: Date.now() },
    });
    const selected = await prepare({
      action: "select",
      comparisonId: (compared.body as { id: string }).id,
    });
    input = (selected.body as { input: unknown }).input;
  }
  sentActivation = { moduleOperation: { binding, input }, signIn };
  const activation = await post("activate", sentActivation);
  // Long enough for a duty pass, which would ask at once.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await started.close();
  return {
    ...readDisk(),
    preparation: codeOf(challenge) ?? challenge.status,
    activation: codeOf(activation) ?? activation.body,
    restarts,
  };
}

/** What a stopped box holds. */
function readDisk() {
  const { spareVenue } = dirs();
  const venue = new DatabaseSync(join(spareVenue, "venue.db"), { readOnly: true });
  const node = new DatabaseSync(join(spareVenue, "node.db"), { readOnly: true });
  try {
    const count = (table: string) =>
      (venue.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
    const chart = venue.prepare("select term from node_membership").get() as { term: number };
    const row = node
      .prepare("select state, waiting_reason from node_handover_operations")
      .get() as { state: string; waiting_reason: string | null };
    const placed = node
      .prepare("select count(*) as n from node_handover_events where kind = 'copy_placed'")
      .get() as { n: number };
    const mode = node
      .prepare("select mode from node_mode where node_id = ?")
      .get(standby.nodeId) as { mode: string };
    return {
      chartTerm: chart.term,
      state: row.state,
      waiting: row.waiting_reason,
      placed: placed.n,
      mode: mode.mode,
      ownSif: (
        venue
          .prepare("select count(*) as n from registro_sif where node_id = ?")
          .get(standby.nodeId) as { n: number }
      ).n,
      activations: count("handover_activations"),
    };
  } finally {
    venue.close();
    node.close();
  }
}

describe("a real start over the old file a chart moved on in", () => {
  it("the review's case: a chart naming a third box main stops placing, and nothing can activate", async () => {
    const stopped = await fixture.stoppedBeforePlacing();
    const body = {
      term: 4,
      nodes: [
        { nodeId: primary.nodeId, contactUrl: "https://main.example", standing: "sell-only" },
        {
          nodeId: standby.nodeId,
          contactUrl: "https://spare.example",
          standing: "serving-secondary",
        },
        { nodeId: THIRD_BOX, contactUrl: "https://third.example", standing: "serving-primary" },
      ],
    } as const;
    holdChart(join(dirs().spareVenue, "venue.db"), {
      ...stopped.chart,
      body,
      signature: signDocumentBody(body, stopped.mainKey),
    });

    // Failing case, the review's: chart term 2, copy placed, `{ activated: true }`, a new filing name.
    expect(await startAndTryToActivate()).toEqual({
      chartTerm: 4,
      state: "filing_assumed",
      waiting: "handover.source_no_longer_main",
      placed: 0,
      mode: "mirror",
      preparation: "handover.step_out_of_order",
      activation: "handover.step_out_of_order",
      ownSif: 0,
      activations: 0,
      restarts: [],
    });
  }, 180_000);

  it("control: with the chart still naming the old box, the same start places and activates", async () => {
    await fixture.stoppedBeforePlacing();

    expect(await startAndTryToActivate()).toEqual({
      chartTerm: 2,
      state: "activated",
      waiting: null,
      placed: 1,
      mode: "primary",
      preparation: 200,
      activation: { activated: true, restarting: true },
      ownSif: 1,
      activations: 1,
      restarts: ["restart"],
    });
  }, 180_000);
});

describe("a real restart after activating, then the same request again", () => {
  const onNodeDb = (statements: string[]) => {
    const node = new DatabaseSync(join(dirs().spareVenue, "node.db"));
    try {
      for (const statement of statements) node.exec(statement);
    } finally {
      node.close();
    }
  };
  const activatedRecordLost = [
    "update node_handover_operations set state = 'filing_assumed'",
    "delete from node_handover_events where kind = 'activated'",
  ];
  const roleLost = [
    ...activatedRecordLost,
    "update node_mode set mode = 'mirror', singleton_role = 'secondary'",
  ];

  it.each([
    ["the answer lost", []],
    ["the record of activated lost too", activatedRecordLost],
    ["the role lost as well", roleLost],
  ])(
    "%s: the restarted box answers activated, keeps its one name, and does not restart again",
    async (_name, lost) => {
      await fixture.stoppedBeforePlacing();
      const first = await startAndTryToActivate();
      expect(first.activation).toEqual({ activated: true, restarting: true });
      onNodeDb(lost);

      const restarts: string[] = [];
      beforeServerStarts();
      started = await startServer(await spareEnv(), undefined, {
        timings: { minTickMs: 200, maxTickMs: 600_000 },
        peerCheck: async () => ({ result: "proceed", successorNodeId: null }),
        restart: () => restarts.push("restart"),
      });
      const retry = await post("activate", sentActivation);
      await started.close();

      expect(retry).toEqual({ status: 200, body: { activated: true, restarting: false } });
      expect(readDisk()).toEqual({
        chartTerm: 2,
        state: "activated",
        waiting: null,
        placed: 1,
        mode: "primary",
        ownSif: 1,
        activations: 1,
      });
      expect(restarts).toEqual([]);
    },
    180_000,
  );
});

describe("the emergency routes through a real spare start", () => {
  const declaration = {
    operationId: OPERATION,
    expectedCopy: { identifier: "", lastChangeAtMs: null as number | null },
    signIn,
    statements: { sourceSwitchedOff: true, noParallelRecovery: true, missingTailAccepted: true },
    reason: "Source switched off",
    locale: "en",
  };
  async function startEmergency() {
    const copy = await fixture.placeEmergencyCopy();
    // A failure to connect counts as the main box being gone only at an address this spare
    // reached it at under the venue authority, so the spare first meets it running.
    const authority = await mintBoxAuthority();
    const source = await startBoxServer(authority, () => ({ status: 503, body: "{}" }));
    // Joining leaves the main box's authority in the spare's own `tls/`.
    await mkdir(join(dirs().spareState, "tls"), { recursive: true });
    await writeFile(join(dirs().spareState, "tls", "ca.crt"), authority.caPem);
    await writeFile(join(dirs().spareState, "tls", "ca.key"), authority.caKeyPem);
    await writeMirrorLink(copy.node, standby.nodeId, {
      originUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: authority.caPem,
      originNodeId: primary.nodeId,
    });
    const contactUrl = `https://127.0.0.1:${new URL(source.url).port}`;
    const body = {
      ...copy.chart.body,
      nodes: copy.chart.body.nodes.map((node) =>
        node.nodeId === primary.nodeId ? { ...node, contactUrl } : node,
      ),
    };
    await copy.close();
    holdChart(join(dirs().spareVenue, "venue.db"), {
      ...copy.chart,
      body,
      signature: signDocumentBody(body, copy.mainKey),
    });
    beforeServerStarts();
    vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
    const env = await spareEnv();
    started = await startServer(env, undefined, {
      timings: { minTickMs: 200, maxTickMs: 600_000 },
      peerCheck: async () => ({ result: "proceed", successorNodeId: null }),
      restart: () => {},
    });
    const probe = await openVenueDatabase(dirs().spareVenue, { exclusive: false });
    let moduleConfig;
    try {
      moduleConfig = await readModuleConfig(probe.venue);
    } finally {
      await probe.close();
    }
    declaration.expectedCopy = await checkEmergencyCopy({
      venueDir: dirs().spareVenue,
      modules: enabledModules(ALL_MODULES, moduleConfig),
    });
    const running = await post("declare", declaration, "emergency");
    expect(codeOf(running)).toBe("handover.source_not_established");
    expect(source.requests).toHaveLength(1);
    await source.close();
    const answer = await post("declare", declaration, "emergency");
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return env;
  }

  it("declares, prepares and activates through the mirror gate, then repairs a lost node record on restart", async () => {
    const env = await startEmergency();
    const prepare = (proposal: unknown) =>
      post("preparation", { moduleOperation: { binding, input: null }, signIn, proposal });
    const challenge = await prepare({ action: "clock-challenge" });
    expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
    const compared = await prepare({
      action: "compare-clocks",
      browser: { challengeId: (challenge.body as { id: string }).id, instantMs: Date.now() },
    });
    const selected = await prepare({
      action: "select",
      comparisonId: (compared.body as { id: string }).id,
    });
    expect(selected.status, JSON.stringify(selected.body)).toBe(200);
    const activationBody = {
      moduleOperation: { binding, input: (selected.body as { input: unknown }).input },
      signIn,
    };
    expect(await post("activate", activationBody)).toEqual({
      status: 200,
      body: { activated: true, restarting: true },
    });
    await started!.close();
    const node = new DatabaseSync(join(dirs().spareVenue, "node.db"));
    try {
      node.exec(
        "update node_handover_operations set state = 'emergency_declared'; delete from node_handover_events where kind = 'activated'",
      );
    } finally {
      node.close();
    }
    beforeServerStarts();
    started = await startServer(env, undefined, {
      timings: { minTickMs: 200, maxTickMs: 600_000 },
      peerCheck: async () => ({ result: "proceed", successorNodeId: null }),
    });
    expect(await post("activate", activationBody)).toEqual({
      status: 200,
      body: { activated: true, restarting: false },
    });
    await started.close();
    expect(readDisk()).toEqual({
      chartTerm: 2,
      state: "activated",
      waiting: null,
      placed: 0,
      mode: "primary",
      ownSif: 1,
      activations: 1,
    });
  }, 180_000);

  it("shares the declaration's wrong-password delay with preparation and activation", async () => {
    await startEmergency();
    const wrong = { ...signIn, password: "wrong" };
    for (const step of ["declare", "preparation", "declare", "preparation"] as const) {
      const answer =
        step === "declare"
          ? await post(step, { ...declaration, signIn: wrong }, "emergency")
          : await post(step, {
              moduleOperation: { binding, input: null },
              signIn: wrong,
              proposal: { action: "clock-challenge" },
            });
      expect(codeOf(answer)).toBe("password.invalid");
    }
    for (const step of ["declare", "preparation", "activate"] as const) {
      const answer =
        step === "declare"
          ? await post(step, { ...declaration, signIn: wrong }, "emergency")
          : await post(step, {
              moduleOperation: { binding, input: null },
              signIn: wrong,
              proposal: { action: "clock-challenge" },
            });
      expect(codeOf(answer)).toBe("password.throttled");
    }
  }, 180_000);
});
