import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { expect, it, vi } from "vitest";
import {
  STOP,
  aTurn,
  cleanups,
  expectRefusedUnchanged,
  ordinaryServer,
  type Ids,
  type Server,
} from "../test/stop-route-server.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { freePorts } from "./testing/free-ports.js";

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

it.each([
  ["a claimed setup", { claimed: true } as const, "claimed"],
  ["a setup that has taken an input", {}, "consumption-intent"],
])(
  "%s is stopped over HTTPS with no owner: the record says abandoned and the box restarts",
  async (_, options, status) => {
    const s = await ordinaryServer(options);
    expect((await s.host.resolution.inspectFirstSetupResolution()).database).toBe("no-venue-rows");
    expect((await s.host.store.read())!.status).toBe(status);
    const owner = await s.owner();
    const response = await s.stop(await s.ids());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ restarting: true });
    expect((await s.host.store.readResumable())!.state.status).toBe("abandoned");
    await vi.waitFor(() => expect(s.requestRestart).toHaveBeenCalledOnce());
    await expect(s.host.owner.authorize(owner)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
  },
);

it.each([
  [
    "a setup the owner's own tab abandoned",
    async (s: Server) => {
      expect((await s.ownerChange("abandon")).status).toBe(200);
    },
  ],
])("%s: the stop writes nothing and the box restarts", async (_, reach) => {
  const s = await ordinaryServer();
  await reach(s);
  const before = await s.record();
  const response = await s.stop(await s.ids());
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ restarting: true });
  expect(await s.record()).toEqual(before);
  await vi.waitFor(() => expect(s.requestRestart).toHaveBeenCalledOnce());
});

it("a stop the repair page would refuse is refused, and writes nothing", async () => {
  const s = await ordinaryServer();
  await writeFile(join(s.stateDir, "flows/setup/operation.json"), JSON.stringify({ left: "behind" }));
  const ids = await s.ids();
  const summary = await createFirstSetupResolutionActions({
    stateDir: s.stateDir,
    venueDir: s.venueDir,
    host: s.host,
  })
    .startAgainSummary(ids)
    .then(
      () => "accepted",
      (error: { code: string }) => error.code,
    );
  expect(summary).toBe("setup.not_ready");
  const before = await s.record();
  await expectRefusedUnchanged(s, await s.stop(ids), 503, summary, before);
  expect((await s.ownerChange("abandon")).status).toBe(200);
});

it.each([
  ["plain HTTP", { https: false } as const, (ids: Ids) => ids, 403, "setup.connection_insecure"],
  [
    "a foreign page",
    { headers: { Origin: "https://elsewhere.test" } },
    (ids: Ids) => ids,
    403,
    "setup.owner_required",
  ],
  [
    "a body that is not JSON",
    { headers: { "Content-Type": "text/plain" } },
    (ids: Ids) => ids,
    400,
    "setup.request_invalid",
  ],
  [
    "a stale revision",
    {},
    (ids: Ids) => ({ ...ids, revision: ids.revision + 1 }),
    409,
    "setup.attempt_conflict",
  ],
  [
    "a stale inspection",
    {},
    (ids: Ids) => ({ ...ids, inspectionId: "stale" }),
    409,
    "setup.attempt_conflict",
  ],
  ["an extra key", {}, (ids: Ids) => ({ ...ids, password: "x" }), 400, "setup.request_invalid"],
  [
    "a revision that is not positive",
    {},
    (ids: Ids) => ({ ...ids, revision: 0 }),
    400,
    "setup.request_invalid",
  ],
])("refuses %s, and writes nothing", async (_, init, body, status, code) => {
  const s = await ordinaryServer();
  const ids = await s.ids();
  const before = await s.record();
  await expectRefusedUnchanged(s, await s.stop(body(ids), init), status, code, before);
});

it("refuses a forwarded HTTPS header on a plain socket, and writes nothing", async () => {
  const s = await ordinaryServer();
  const ids = await s.ids();
  const before = await s.record();
  const [port] = await freePorts(1);
  const server = serve({ fetch: s.app.fetch, port, hostname: "127.0.0.1" });
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  if (!server.listening) await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${port}${STOP}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
    body: JSON.stringify(ids),
  });
  await expectRefusedUnchanged(s, response, 403, "setup.connection_insecure", before);
});

it("a stop sent while the owner's step holds the coordinator neither writes nor answers until the step ends", async () => {
  const s = await ordinaryServer();
  const ids = await s.ids();
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const holding = new Promise<void>((resolve) => (entered = resolve));
  const step = s.host.coordinator.run(async () => {
    entered();
    await released;
  });
  await holding;
  let answered = false;
  const stopped = Promise.resolve(s.stop(ids)).then((response) => {
    answered = true;
    return response;
  });
  await aTurn();
  expect(answered).toBe(false);
  expect((await s.host.store.readResumable())!.state.status).toBe("consumption-intent");
  release();
  await step;
  expect((await stopped).status).toBe(200);
  expect((await s.host.store.readResumable())!.state.status).toBe("abandoned");
});

it.each([
  [
    "changes the record",
    async (s: Server, hold: unknown) => {
      const { state } = (await s.host.store.readResumable())!;
      await s.host.store.update(
        state.frozen.attemptId,
        state.revision,
        { kind: "publication-binding", digest: "a".repeat(64) },
        hold as Parameters<Server["host"]["store"]["update"]>[3],
      );
    },
    409,
    "setup.attempt_conflict",
  ],
  [
    "leaves a file Start again refuses",
    async (s: Server) => {
      await writeFile(join(s.stateDir, "flows/setup/operation.json"), JSON.stringify({ left: "behind" }));
    },
    409,
    "setup.attempt_conflict",
  ],
])(
  "a stop that waited while the owner's step %s answers as the step left it",
  async (_, change, status, code) => {
    const s = await ordinaryServer();
    const ids = await s.ids();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const holding = new Promise<void>((resolve) => (entered = resolve));
    const step = s.host.coordinator.run(async (hold) => {
      entered();
      await released;
      await change(s, hold);
    });
    await holding;
    const read = vi.spyOn(s.host.store, "readResumable");
    const stopped = Promise.resolve(s.stop(ids));
    await aTurn();
    expect(read).not.toHaveBeenCalled();
    release();
    await step;
    const before = await s.record();
    await expectRefusedUnchanged(s, await stopped, status, code, before);
  },
);

it("the repair entry does not serve the stop route", async () => {
  const s = await ordinaryServer();
  expect((await s.ownerChange("abandon")).status).toBe(200);
  const admission = await resolveFirstSetupEntry(
    { stateDir: s.stateDir, venueDir: s.venueDir },
    {},
    s.requestRestart,
  );
  if (admission.kind !== "resolution") throw new Error("Expected the repair entry");
  const before = await s.record();
  const response = await s.stop(await s.ids(), { on: admission.app });
  expect(response.status).toBe(404);
  await aTurn();
  expect(await s.record()).toEqual(before);
  expect(s.requestRestart).not.toHaveBeenCalled();
});

it("the ordinary server without requestRestart does not serve the stop route", async () => {
  const s = await ordinaryServer({ requestRestart: false });
  const before = await s.record();
  const response = await s.stop(await s.ids());
  expect(response.status).toBe(404);
  expect(await s.record()).toEqual(before);
});
