import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { invoiceSeries, stampDeployment, withTransaction } from "@waitron/db";
import { applyVenue, planVenue, venueFiscalSelection } from "@waitron/provisioning";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  enabledModules,
  initialSetupFor,
  withOperationAuthority,
  withPreparedModuleOperations,
} from "@waitron/module";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { mountSetup } from "./setup-api.js";
import { MODULE, PASSWORD, request } from "../test/first-fiscal.js";

const NOW = Date.parse("2026-10-16T11:40:00Z");
const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  external.internet.mockImplementation(async () => {
    const mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 500,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  });
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(environment: "production" | "preproduction" = "preproduction") {
  const root = await mkdtemp(join(tmpdir(), "configured-hour-"));
  roots.push(root);
  const stateDir = join(root, "state");
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir: join(root, "venue"),
    modules: ALL_MODULES,
    environment: {},
    database: () => venue.db,
  });
  const claim = await host.owner.claimFirstSetup(
    { environment, request },
    randomBytes(32).toString("base64url"),
  );
  let owner = { ...claim.state, capability: claim.capability };
  const app = new Hono();
  mountSetup(app, { environment, firstFiscal: host }, () => {});
  const post = async (action: string, body: unknown, capability = owner.capability) => {
    const response = await app.request(`/setup-api/first-setup/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": capability,
        "X-Waitron-Setup-Attempt": owner.attemptId,
        "X-Waitron-Setup-Revision": String(owner.revision),
        "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
      },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    const value = (
      response.headers.get("Content-Type")?.includes("application/json") ? JSON.parse(raw) : { raw }
    ) as {
      state?: typeof owner;
      preparation: { id: string; status: string; targetMs: number };
      error: { code: string };
    };
    if (response.status === 200 && value.state)
      owner = { ...value.state, capability: owner.capability };
    return { status: response.status, body: value };
  };
  const clocks = async () => {
    const challenge = await post("preparation", {
      module: MODULE,
      proposal: { action: "clock-challenge" },
    });
    expect(challenge.status).toBe(200);
    return post("preparation", {
      module: MODULE,
      proposal: {
        action: "compare-clocks",
        browser: { challengeId: challenge.body.preparation.id, instantMs: NOW },
      },
    });
  };
  const select = async (answer = "no", reconfirmation?: string) =>
    post("candidates", {
      module: MODULE,
      proposal: { answer },
      reconfirmation: reconfirmation ?? (await host.owner.reconfirm(owner, PASSWORD, "block-use")),
    });
  return { host, post, clocks, select, stateDir };
}

it.each(["production", "preproduction"] as const)(
  "configured %s setup shares clock and durable selection with operation preparation",
  async (environment) => {
    const f = await fixture(environment);
    expect((await f.clocks()).status).toBe(200);
    const result = await f.select();
    expect(result.status).toBe(200);
    const state = (await f.host.store.read())!;
    const context = firstSetupModuleContext(state, MODULE);
    const saved = context.request as { input: unknown };
    expect(saved).toMatchObject({
      status: "selected",
      identity: "06RB",
      input: {
        allocation: {
          environment,
          source: "hour",
          reservationEvidence: null,
          series: [
            { code: "A-06RB", purpose: "standard" },
            { code: "FF-06RB", purpose: "full" },
            { code: "R-06RB", purpose: "rectificative" },
          ],
        },
      },
    });
    const journal = JSON.parse(
      await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8"),
    );
    expect(journal.revisions).toHaveLength(1);
    expect(journal.revisions[0].value.entries[0].identity).toBe("06RB");
    expect((await f.post("input", { module: MODULE, input: saved.input })).status).toBe(200);
    const value = await f.host.coordinator.run(() =>
      withOperationAuthority(context.binding, context.administratorId, (authority) =>
        withPreparedModuleOperations(
          f.host.modules,
          new Map([[MODULE, { binding: context.binding, authority, input: saved.input }]]),
          context.binding.targetNodeId,
          "setup",
          async (prepared) => {
            expect(prepared.get(MODULE)!.input).not.toEqual(saved.input);
            return "prepared";
          },
        ),
      ),
    );
    expect(value).toBe("prepared");
  },
);

it.each(["yes", "unknown"])(
  "a configured %s answer returns its durable wait without freezing a usable request",
  async (answer) => {
    const f = await fixture();
    await f.clocks();
    const result = await f.select(answer);
    expect(result.status).toBe(200);
    expect(result.body.preparation).toMatchObject({
      status: "waiting",
      targetMs: Date.parse("2026-10-16T12:00:00Z"),
    });
    const state = (await f.host.store.read())!;
    expect(state.status).toBe("claimed");
    expect(firstSetupModuleContext(state, MODULE).request).toBeNull();
    const journal = JSON.parse(
      await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8"),
    );
    expect(journal.revisions[0].value.entries[0].kind).toBe("wait");
    expect(journal.revisions[0].value.entries[0]).not.toHaveProperty("identity");
  },
);

it("rejects an unauthenticated clock action before contacting the outside source", async () => {
  const f = await fixture();
  const result = await f.post(
    "preparation",
    { module: MODULE, proposal: { action: "compare-clocks", browser: null } },
    "forged",
  );
  expect(result.status).toBe(403);
  expect(result.body.error.code).toBe("setup.owner_required");
  expect(external.internet).not.toHaveBeenCalled();
});

it("a bad password grant cannot record an hour using the real configured contribution", async () => {
  const f = await fixture();
  await f.clocks();
  const result = await f.select("no", "forged");
  expect(result.status).toBe(403);
  expect(result.body.error.code).toBe("setup.owner_required");
  await expect(readFile(join(f.stateDir, "module-preparation-state.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("writes and reads back the configured hour through the real provisioning and committed seats", async () => {
  const f = await fixture();
  await f.clocks();
  expect((await f.select()).status).toBe(200);
  const state = (await f.host.store.read())!;
  const context = firstSetupModuleContext(state, MODULE);
  const input = (context.request as { input: unknown }).input;
  expect((await f.post("input", { module: MODULE, input })).status).toBe(200);
  const selected = enabledModules(
    f.host.modules,
    venueFiscalSelection(f.host.modules, request.location.fiscalTerritory).config,
  );
  await stampDeployment(venue.db, "preproduction");
  const result = await f.host.coordinator.run(() =>
    applyVenue(planVenue(state.frozen.request, selected), {
      db: venue.db,
      modules: selected,
      initialNodeId: context.binding.targetNodeId,
      initialAdministratorId: context.administratorId,
      moduleInputs: new Map([
        [MODULE, { eventId: context.binding.eventId, sourceId: context.binding.sourceId, input }],
      ]),
    }),
  );
  expect(result.nodeId).toBe(context.binding.targetNodeId);
  const stored = await venue.db.select().from(registroSif);
  expect(stored).toHaveLength(1);
  expect(stored[0]!.numeroInstalacion).toBe("06RB");
  expect(
    (await venue.db.select().from(invoiceSeries)).map(({ code, nextNumber }) => ({
      code,
      nextNumber,
    })),
  ).toEqual([
    { code: "A-06RB", nextNumber: 1 },
    { code: "FF-06RB", nextNumber: 1 },
    { code: "R-06RB", nextNumber: 1 },
  ]);
  const committed = await withTransaction(venue.db, (tx) =>
    initialSetupFor(f.host.modules, MODULE)!.committed(tx, context, input),
  );
  expect(committed).toMatchObject({
    activationEventId: context.binding.eventId,
    sifId: stored[0]!.id,
  });
});

it("manual displayed-time consent reaches the real configured selector after TLS comparison fails", async () => {
  const f = await fixture();
  external.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const comparison = await f.post("preparation", {
    module: MODULE,
    proposal: { action: "compare-clocks", browser: null },
  });
  expect(comparison.status).toBe(200);
  const before = await f.select();
  expect(before.status).toBe(400);
  expect(before.body.error.code).toBe("sif.allocation_invalid");
  const forged = await f.post("preparation", {
    module: MODULE,
    proposal: { action: "confirm-clock", comparisonId: "forged" },
  });
  expect(forged.status).toBe(400);
  expect(forged.body.error.code).toBe("sif.allocation_invalid");
  expect(
    (
      await f.post("preparation", {
        module: MODULE,
        proposal: { action: "confirm-clock", comparisonId: comparison.body.preparation.id },
      })
    ).status,
  ).toBe(200);
  expect((await f.select()).status).toBe(200);
});

it("the configured input seat refuses changed names after the hour was frozen", async () => {
  const f = await fixture();
  await f.clocks();
  expect((await f.select()).status).toBe(200);
  const context = firstSetupModuleContext((await f.host.store.read())!, MODULE);
  const input = structuredClone(
    (context.request as { input: { allocation: { installationIdentity: string } } }).input,
  );
  input.allocation.installationIdentity = "06RC";
  const result = await f.post("input", { module: MODULE, input });
  expect(result.status).toBe(400);
  expect(result.body.error.code).toBe("sif.allocation_invalid");
  expect((await f.host.store.read())!.inputs).not.toHaveProperty(MODULE);
});

it("rejects uploaded clock scope and arbitrary sources before calling the internet observer", async () => {
  const f = await fixture();
  const result = await f.post("preparation", {
    module: MODULE,
    proposal: {
      action: "compare-clocks",
      browser: null,
      source: "https://attacker.example",
      environment: "production",
    },
  });
  expect(result.status).toBe(400);
  expect(result.body.error.code).toBe("sif.allocation_invalid");
  expect(external.internet).not.toHaveBeenCalled();
});

it("reads an existing Yes countdown without another password grant or journal write", async () => {
  const f = await fixture();
  await f.clocks();
  const saved = await f.select("yes");
  expect(saved.status).toBe(200);
  const before = await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8");
  const preview = await f.post("preparation", {
    module: MODULE,
    proposal: { action: "selection" },
  });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect(preview.body.preparation).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T12:00:00Z"),
  });
  expect(preview.body.preparation).not.toHaveProperty("input");
  expect(await readFile(join(f.stateDir, "module-preparation-state.json"), "utf8")).toBe(before);
});
