import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, expect, vi, type Mock } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "@waitron/composition";
import { hourFirstFiscalFixture } from "./hour-first-fiscal.js";
import { migratedTemplate } from "./migrated-template.js";
import { ownedHourSetup } from "./owned-hour-setup.js";
import { MODULE, PASSWORD, request } from "./first-fiscal.js";
import { createFirstSetupModuleHost } from "../src/module-operation-host.js";
import { createFakeTimersHourClock } from "../src/testing/hour-test-clock.js";
import { START_AGAIN_ROUTES, type FirstFiscalHost } from "../src/setup-first-fiscal-api.js";
import { mountSetup } from "../src/setup-api.js";

export const STOP = START_AGAIN_ROUTES.stop.path;

// Read at load, before anything can point TMPDIR elsewhere.
const PARENT = tmpdir();
const stopTemplate = migratedTemplate(
  "stop-route-template-",
  migrationOptionsFor(manifestSets(), null),
);

export const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const SETUP_MODULES = () =>
  ALL_MODULES.filter((module) => ["core", MODULE, "fiscal-none"].includes(module.name));

/** Thrown by the walk's transport to end the owner's setup after a named step. */
const STOPPED = Symbol("stopped");

/**
 * A setup on the ordinary setup server, its empty migrated `venue.db` held open as the ordinary
 * server holds it until `closeDatabase`. With no option the setup has taken its fiscal module's
 * input and kept its recovery document. `claimed` stops after the claim; `until` stops the owner's
 * walk after that step.
 */
export async function ordinaryServer(
  options: {
    claimed?: true;
    until?: "candidates" | "input" | "node-key";
    requestRestart?: false;
  } = {},
) {
  const root = await mkdtemp(join(PARENT, "stop-route-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(stateDir, { recursive: true });
  await mkdir(venueDir, { recursive: true });
  const migrated = await stopTemplate();
  for (const name of ["venue.db", "node.db"])
    await copyFile(join(migrated, name), join(venueDir, name));
  const held = await openVenueDatabase(venueDir);
  let open = true;
  const closeDatabase = async () => {
    if (!open) return;
    open = false;
    await held.close();
  };
  cleanups.push(closeDatabase);
  let host: FirstFiscalHost;
  let capability: string;
  const bareHost = () =>
    createFirstSetupModuleHost({
      stateDir,
      venueDir,
      environment: {},
      database: () => held.venue,
      modules: SETUP_MODULES(),
    });
  if (options.claimed === true) {
    host = bareHost();
    const claimApp = new Hono();
    mountSetup(claimApp, { environment: "production", firstFiscal: host }, () => {});
    const claimed = await claimApp.request("https://box.test/setup-api/first-setup/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue: request,
      }),
    });
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    capability = ((await claimed.json()) as { capability: string }).capability;
  } else if (options.until !== undefined) {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime("2026-10-16T11:40:00Z");
    try {
      const clock = createFakeTimersHourClock();
      host = createFirstSetupModuleHost({
        stateDir,
        venueDir,
        environment: {},
        database: () => held.venue,
        modules: SETUP_MODULES(),
        testClock: clock,
      });
      const walkApp = new Hono();
      mountSetup(
        walkApp,
        { environment: "production", firstFiscal: host, requestFromBox: () => false },
        () => {},
      );
      let lastCapability: string | undefined;
      let finished = false;
      const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (finished) throw STOPPED;
        const response = await walkApp.request(String(input), init);
        const body = (await response.clone().json()) as { capability?: string };
        if (body.capability !== undefined) lastCapability = body.capability;
        if (String(input).endsWith(`/first-setup/${options.until}`)) finished = true;
        return response;
      }) as typeof fetch;
      await ownedHourSetup(transport, "https://box.test", request, PASSWORD, undefined, clock).then(
        () => {
          throw new Error(`the walk never reached ${options.until}`);
        },
        (error: unknown) => {
          if (error !== STOPPED) throw error;
        },
      );
      capability = lastCapability!;
    } finally {
      vi.useRealTimers();
    }
  } else {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime("2026-10-16T11:40:00Z");
    try {
      const f = await hourFirstFiscalFixture({
        clock: createFakeTimersHourClock(),
        database: () => held.venue,
        workspace: { root, stateDir, venueDir },
      });
      host = f.host;
      capability = f.ownerAttempt.capability;
    } finally {
      vi.useRealTimers();
    }
  }
  const requestRestart: Mock<() => void> = vi.fn();
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "production",
      firstFiscal: host,
      requestFromBox: () => false,
      ...(options.requestRestart === false ? {} : { requestRestart }),
    },
    () => {},
  );
  const socket = new TLSSocket(new Socket());
  cleanups.push(async () => {
    socket.destroy();
  });
  const ids = async () => {
    const inspection = await host.resolution.inspectFirstSetupResolution();
    return {
      inspectionId: inspection.inspectionId,
      revision: inspection.revision!,
      ownerGeneration: inspection.ownerGeneration!,
    };
  };
  const stop = (
    body: unknown,
    init: { headers?: Record<string, string>; https?: false; on?: Hono } = {},
  ) =>
    (init.on ?? app).request(
      `https://box.test${STOP}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...init.headers },
        body: JSON.stringify(body),
      },
      init.https === false ? undefined : { incoming: { socket } },
    );
  /** A request over HTTPS to another app, such as the repair entry's. */
  const post = (on: Hono, path: string, body: unknown) =>
    on.request(
      `https://box.test${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { incoming: { socket } },
    );
  const record = () => readFile(join(stateDir, "flows/setup/record.json"));
  /** The owner's own tab, with the headers of the attempt as it stands now. */
  const ownerChange = async (action: string, body: unknown = {}) => {
    const state = (await host.store.readResumable())!.state;
    return app.request(`https://box.test/setup-api/first-setup/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": capability,
        "X-Waitron-Setup-Attempt": state.frozen.attemptId,
        "X-Waitron-Setup-Revision": String(state.revision),
        "X-Waitron-Setup-Generation": String(state.ownerGeneration),
      },
      body: JSON.stringify(body),
    });
  };
  const owner = async () => {
    const state = (await host.store.read())!;
    return {
      attemptId: state.frozen.attemptId,
      revision: state.revision,
      ownerGeneration: state.ownerGeneration,
      capability,
    };
  };
  return {
    host,
    app,
    requestRestart,
    ids,
    stop,
    post,
    record,
    ownerChange,
    owner,
    stateDir,
    venueDir,
    closeDatabase,
  };
}

export type Server = Awaited<ReturnType<typeof ordinaryServer>>;
export type Ids = Awaited<ReturnType<Server["ids"]>>;

/** Lets a restart the route put on a timer run, so a refusal can be shown not to have scheduled one. */
export const aTurn = () => new Promise((resolve) => setTimeout(resolve, 20));

export async function expectRefusedUnchanged(
  s: Server,
  response: Response,
  status: number,
  code: string,
  before: Buffer,
) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
  await aTurn();
  expect(await s.record()).toEqual(before);
  expect(s.requestRestart).not.toHaveBeenCalled();
}
