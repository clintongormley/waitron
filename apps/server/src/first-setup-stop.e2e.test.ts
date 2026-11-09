import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { MODULE } from "../test/first-fiscal.js";
import { aTurn, ordinaryServer, type Server } from "../test/stop-route-server.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { START_AGAIN_ROUTES } from "./setup-first-fiscal-api.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const roots = (s: Server) => ({ stateDir: s.stateDir, venueDir: s.venueDir });

async function update(s: Server, change: Parameters<Server["host"]["store"]["update"]>[2]) {
  const { state } = (await s.host.store.readResumable())!;
  await s.host.store.update(state.frozen.attemptId, state.revision, change);
}

/** The repair entry's app, as the restart serves it once the ordinary server has let go. */
async function repairEntry(s: Server): Promise<Hono> {
  await s.closeDatabase();
  const admission = await resolveFirstSetupEntry(roots(s), {});
  expect(admission.kind).toBe("resolution");
  if (admission.kind !== "resolution") throw new Error("Expected the repair entry");
  return admission.app;
}

async function repairIds(app: Hono) {
  const response = await app.request(`https://box.test${START_AGAIN_ROUTES.inspect.path}`);
  expect(response.status, await response.clone().text()).toBe(200);
  const inspection = (await response.json()) as {
    inspectionId: string;
    revision: number;
    ownerGeneration: number;
  };
  return {
    inspectionId: inspection.inspectionId,
    revision: inspection.revision,
    ownerGeneration: inspection.ownerGeneration,
  };
}

async function onlyLockFiles(s: Server) {
  for (const dir of [s.stateDir, s.venueDir])
    expect(
      (await readdir(dir)).filter((name) => !name.endsWith(".lock")),
      dir,
    ).toEqual([]);
}

const STOPPABLE: [string, () => Promise<Server>][] = [
  ["a bare claim", () => ordinaryServer({ claimed: true })],
  ["a setup after its candidates", () => ordinaryServer({ until: "candidates" })],
  // The owner's input step records an `import`: no route writes an `input` change.
  ["a setup after its input", () => ordinaryServer({ until: "input" })],
  [
    "a setup after the publication binding",
    async () => {
      const s = await ordinaryServer();
      await update(s, { kind: "publication-binding", digest: "a".repeat(64) });
      return s;
    },
  ],
  ["a setup holding consumption intent, its recovery document kept", () => ordinaryServer()],
  [
    "a setup holding consumption intent, its recovery document not kept",
    () => ordinaryServer({ until: "node-key" }),
  ],
];
const RESTART_ONLY: [string, () => Promise<Server>][] = [
  [
    "a setup the owner's tab abandoned",
    async () => {
      const s = await ordinaryServer();
      expect((await s.ownerChange("abandon")).status).toBe(200);
      return s;
    },
  ],
  [
    "an activation-started setup beside an empty database",
    async () => {
      const s = await ordinaryServer();
      await update(s, { kind: "activation-started" });
      return s;
    },
  ],
];

it.each([
  ...STOPPABLE.map(([name, reach]) => [name, reach, "normal"] as const),
  ...RESTART_ONLY.map(([name, reach]) => [name, reach, "resolution"] as const),
])(
  "%s: then the repair entry serves Start again for it, and Start again deletes it",
  async (_, reach, before) => {
    const s = await reach();
    expect((await resolveFirstSetupEntry(roots(s), {})).kind).toBe(before);
    const stopped = await s.stop(await s.ids());
    expect(stopped.status, await stopped.clone().text()).toBe(200);
    await vi.waitFor(() => expect(s.requestRestart).toHaveBeenCalledOnce());
    const app = await repairEntry(s);
    const ids = await repairIds(app);
    const summary = await s.post(app, START_AGAIN_ROUTES.summary.path, ids);
    expect(summary.status, await summary.clone().text()).toBe(200);
    const started = await s.post(app, START_AGAIN_ROUTES.startAgain.path, ids);
    expect(started.status, await started.clone().text()).toBe(200);
    await onlyLockFiles(s);
  },
);

it.each([
  [
    "an activation-started setup beside an empty database and its published module selection",
    async () => {
      const s = await ordinaryServer();
      await update(s, { kind: "activation-started" });
      await writeFile(join(s.stateDir, "modules.json"), '{"modules":{}}\n', { mode: 0o600 });
      return s;
    },
  ],
])("%s: a state the repair page refuses is refused by the stop too", async (_, reach) => {
  const s = await reach();
  const ids = await s.ids();
  const summary = await createFirstSetupResolutionActions({ ...roots(s), host: s.host })
    .startAgainSummary(ids)
    .then(
      () => "accepted",
      (error: { code: string }) => error.code,
    );
  expect(summary).not.toBe("accepted");
  const before = await s.record();
  const stopped = await s.stop(ids);
  expect(stopped.status).not.toBe(200);
  expect(((await stopped.json()) as { error: { code: string } }).error.code).toBe(summary);
  await aTurn();
  expect(await s.record()).toEqual(before);
  expect(s.requestRestart).not.toHaveBeenCalled();
});

it("the owner's tab is refused after another page stopped the setup", async () => {
  const s = await ordinaryServer();
  const { state } = (await s.host.store.readResumable())!;
  const stopped = await s.stop(await s.ids());
  expect(stopped.status, await stopped.clone().text()).toBe(200);
  const change = await s.ownerChange("input", { module: MODULE, input: state.inputs[MODULE] });
  expect(change.status).toBe(403);
  expect(((await change.json()) as { error: { code: string } }).error.code).toBe(
    "setup.owner_required",
  );
  const abandoned = (await s.host.store.readResumable())!.state;
  expect(abandoned.status).toBe("abandoned");
  await expect(
    s.host.store.update(abandoned.frozen.attemptId, abandoned.revision, {
      kind: "publication-binding",
      digest: "b".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});
