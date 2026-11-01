import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type LiveModuleOperationBridge,
  type ModuleRouteContext,
  type ModuleOperationPreparation,
  type ModuleOperationHost,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { Logger } from "@waitron/server-kit";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedLiveConflict, liveConflictNode } from "../test/live-conflict-fixture.js";
import { FISCAL_ROUTES } from "./routes.js";
import type { ConflictRef } from "./conflict-evidence.js";
import { FISCAL_OPERATIONS } from "./hour-configuration.js";
import { readHourRecoveryState } from "./hour-recovery-state.js";
import { parseConflictResult, type ConflictAllocationInput } from "./conflict-recovery-contract.js";

vi.mock("./hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "unavailable",
    reason: "tls",
  }),
}));
vi.mock("./hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const PATH = "https://box.invalid/api/module-recovery/fiscal-verifactu/conflict";
let node: LiveModuleOperationBridge["node"];
let conflict: ConflictRef;
let monotonic = 0;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:38:00Z"));
  monotonic = 0;
  node = liveConflictNode;
  conflict = await seedLiveConflict(suite.db, {
    wall: Date.now,
    monotonic: () => monotonic,
    advance(ms) {
      monotonic += ms;
      vi.setSystemTime(Date.now() + ms);
    },
  });
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  monotonic = 0;
});
afterEach(() => vi.useRealTimers());

function mount(
  options: {
    absent?: boolean;
    admission?: LiveModuleOperationBridge["withAdmission"];
    prepare?: (proposal: unknown) => Promise<unknown>;
    operations?: ModuleOperationPreparation;
  } = {},
) {
  const log = vi.fn<Logger>();
  const admitted = vi.fn();
  const authenticated = vi.fn();
  const preparations: unknown[] = [];
  const bridge: LiveModuleOperationBridge = {
    node,
    requireHttps(c) {
      if (c.req.header("x-test-refuse-transport"))
        throw new AppError("module.operation_invalid", { module: "fiscal-verifactu" });
    },
    client: () => ({ onBox: false }),
    withAdmission:
      options.admission ??
      (async (run) => {
        admitted();
        return run();
      }),
    async run(binding, key, _isolation, run) {
      authenticated();
      if (key !== "current-paper-key")
        throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
      return withOperationAuthority(
        binding,
        { kind: "recovery-key", nodeId: node.nodeId, eventId: binding.eventId },
        (authority) =>
          run({
            binding,
            authority,
            node,
            commit: (body) => withTransaction(suite.db, body),
            operations: options.operations ?? {
              prepare: async () => {
                throw new Error("unexpected activation");
              },
              recovery: async (_operation, proposal, client) => {
                preparations.push({ proposal, client });
                return options.prepare?.(proposal) ?? { kind: "none" };
              },
            },
          }),
      );
    },
  };
  const ctx: ModuleRouteContext = {
    db: suite.db,
    cfg: { locationId: node.locationId },
    core: {} as ModuleRouteContext["core"],
    ...(options.absent ? {} : { liveOperations: bridge }),
  };
  const app = new Hono();
  FISCAL_ROUTES.mount(app, ctx, log);
  const request = (body: unknown = {}, headers: Record<string, string> = {}) =>
    app.request(PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { app, request, log, admitted, authenticated, preparations };
}
function status(extra: Record<string, unknown> = {}) {
  return {
    recoveryKey: "current-paper-key",
    eventId: "event-1",
    oldMachineOffline: false,
    noParallelRecovery: false,
    command: { kind: "status" },
    ...extra,
  };
}

it("mounts without the drain waker and authenticates status without a management session", async () => {
  const m = mount();
  const response = await m.request(status());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    kind: "status",
    active: [
      {
        ...conflict,
        installationIdentity: expect.any(String),
        invoiceIdentity: expect.any(String),
        observedAt: "2026-10-16T11:40:00.000Z",
        cause: "fiscal.huella_divergente",
        evidence: null,
        evidenceId: null,
      },
    ],
    event: { kind: "none" },
  });
  expect(JSON.stringify(m.log.mock.calls)).not.toContain("current-paper-key");
});
it("has no executable operation when the live bridge is absent", async () => {
  expect((await mount({ absent: true }).request(status())).status).toBe(404);
});
it.each(["", "wrong-key"])(
  "a session cookie cannot replace current recovery key %j",
  async (recoveryKey) => {
    const response = await mount().request(status({ recoveryKey }), {
      cookie: "management_session=administrator",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "sif.allocation_invalid", params: { reason: "reauthentication_required" } },
    });
  },
);
it.each([
  null,
  [],
  {},
  { targetNodeId: "other" },
  { command: { kind: "status", extra: true } },
  { oldMachineOffline: null },
  { conflict: { registroId: "r", caseId: "c" } },
  { command: { kind: "activate", input: {} } },
  {
    command: {
      kind: "prepare",
      proposal: { action: "compare-clocks", browser: { challengeId: "c", instantMs: "1" } },
    },
  },
])("refuses malformed or extra wire fields before authentication %j", async (change) => {
  const m = mount();
  const response = await m.request(
    change === null || Array.isArray(change) || Object.keys(change).length === 0
      ? change
      : status(change),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "sif.allocation_invalid", params: { reason: "malformed_allocation" } },
  });
  expect(m.authenticated).not.toHaveBeenCalled();
});
it("refuses transport before parsing or authenticating", async () => {
  const m = mount();
  const response = await m.app.request(PATH, {
    method: "POST",
    headers: { "x-test-refuse-transport": "yes" },
    body: "not json",
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "module.operation_invalid" } });
  expect(m.authenticated).not.toHaveBeenCalled();
});
it("admission refuses before body parsing and authentication on an accepted transport", async () => {
  const m = mount({
    admission: async () => {
      throw new AppError("module.operation_invalid", { module: "admission" });
    },
  });
  const response = await m.app.request(PATH, {
    method: "POST",
    body: "not json",
  });
  expect(await response.json()).toMatchObject({
    error: { code: "module.operation_invalid", params: { module: "admission" } },
  });
  expect(m.authenticated).not.toHaveBeenCalled();
});
it.each(["oldMachineOffline", "noParallelRecovery"])(
  "preparation requires %s without calling the engine",
  async (field) => {
    const m = mount();
    const response = await m.request(
      status({
        conflict,
        oldMachineOffline: true,
        noParallelRecovery: true,
        [field]: false,
        command: { kind: "prepare", proposal: { action: "clock-challenge" } },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "sif.allocation_invalid",
        params: {
          reason: field === "oldMachineOffline" ? "old_machine_active" : "parallel_recovery",
        },
      },
    });
    expect(m.preparations).toEqual([]);
  },
);
it("checks the committed conflict reference before preparing a clock", async () => {
  const m = mount();
  const response = await m.request(
    status({
      conflict: { ...conflict, caseId: "wrong" },
      oldMachineOffline: true,
      noParallelRecovery: true,
      command: { kind: "prepare", proposal: { action: "clock-challenge" } },
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "sif.allocation_invalid", params: { reason: "conflict_not_active" } },
  });
  expect(m.preparations).toEqual([]);
});
it("projects only public challenge fields, using the host's client", async () => {
  const m = mount({
    prepare: async () => ({
      id: "challenge",
      boxInstantMs: 1000,
      expiresInMs: 5000,
      authority: "private",
      recoveryKey: "never serialize",
    }),
  });
  const response = await m.request(
    status({
      conflict,
      oldMachineOffline: true,
      noParallelRecovery: true,
      command: { kind: "prepare", proposal: { action: "clock-challenge" } },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    kind: "prepared",
    value: { id: "challenge", boxInstantMs: 1000, expiresInMs: 5000 },
  });
  expect(m.preparations).toEqual([
    { proposal: { action: "clock-challenge" }, client: { onBox: false } },
  ]);
});

function actualOperations() {
  let value: unknown = null;
  const history: unknown[] = [];
  const host: ModuleOperationHost = {
    environment: {},
    testClock: { wall: Date.now, monotonic: () => monotonic },
    readPublicEvidence: async () => undefined,
    withPreparationState: async (_binding, run) =>
      run({
        get value() {
          return value;
        },
        get history() {
          return history;
        },
        async replace(next) {
          value = structuredClone(next);
          history.push(structuredClone(next));
        },
      }),
    readRecoveryFacts: async (binding) => ({
      ...(await readHourRecoveryState(suite.db, node, binding, history)),
      contextKey: JSON.stringify(binding),
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
    }),
  };
  return FISCAL_OPERATIONS.configure!(host);
}
it("prepares, switches and returns the exact committed event through status and activation replay", async () => {
  const m = mount({ operations: actualOperations() });
  const answer = async (command: unknown) => {
    const response = await m.request(
      status({ conflict, oldMachineOffline: true, noParallelRecovery: true, command }),
    );
    const json: unknown = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(200);
    const parsed = parseConflictResult(json);
    expect(parsed).not.toBeNull();
    return parsed!;
  };
  const prepare = async (proposal: unknown) => {
    const result = await answer({ kind: "prepare", proposal });
    if (result.kind !== "prepared") throw new Error("not prepared");
    return result.value;
  };
  const compare = async () => {
    const challenge = await prepare({ action: "clock-challenge" });
    if (!("id" in challenge)) throw new Error("missing challenge");
    const compared = await prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
    if (!("clock" in compared)) throw new Error("missing comparison");
    return compared.id;
  };
  expect(await answer({ kind: "status" })).toMatchObject({
    kind: "status",
    event: { kind: "none" },
  });
  let comparisonId = await compare();
  expect(await prepare({ action: "preview" })).toEqual({ status: "preview", identity: "0CNQR" });
  expect(await prepare({ action: "select", comparisonId })).toMatchObject({ status: "waiting" });
  expect(await prepare({ action: "preview" })).toEqual({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T12:42:00Z"),
    remainingMs: 120000,
  });
  monotonic += 120000;
  vi.setSystemTime(Date.now() + 120000);
  comparisonId = await compare();
  expect(await prepare({ action: "preview" })).toEqual({ status: "preview", identity: "0CNQT" });
  const selected = await prepare({ action: "select", comparisonId });
  if (!("input" in selected)) throw new Error("not selected");
  const input: ConflictAllocationInput = selected.input;
  expect(await answer({ kind: "status" })).toMatchObject({
    kind: "status",
    event: { kind: "restart-required" },
  });
  const result = await answer({ kind: "activate", input });
  expect(result).toMatchObject({
    kind: "committed",
    result: {
      activationEventId: "event-1",
      series: [{ code: "A-0CNQT" }, { code: "FF-0CNQT" }, { code: "R-0CNQT" }],
    },
  });
  expect(await answer({ kind: "status" })).toEqual({ kind: "status", active: [], event: result });
  expect(await answer({ kind: "activate", input })).toEqual(result);
  expect(await answer({ kind: "prepare", proposal: { action: "clock-challenge" } })).toEqual(
    result,
  );
});
it.each([null, { invalid: true }, { id: "clock", boxInstantMs: 1, expiresInMs: 0 }])(
  "refuses malformed preparation output %j",
  async (value) => {
    const m = mount({ prepare: async () => value });
    const response = await m.request(
      status({
        conflict,
        oldMachineOffline: true,
        noParallelRecovery: true,
        command: { kind: "prepare", proposal: { action: "clock-challenge" } },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "sif.allocation_invalid", params: { reason: "event_mismatch" } },
    });
  },
);
it("refuses an absent preparation engine and malformed retained-event status", async () => {
  const missing = mount({
    operations: {
      prepare: async () => {
        throw new Error("unexpected");
      },
    },
  });
  const response = await missing.request(
    status({
      conflict,
      oldMachineOffline: true,
      noParallelRecovery: true,
      command: { kind: "prepare", proposal: { action: "preview" } },
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "sif.allocation_invalid", params: { reason: "outside_confirmation_missing" } },
  });
  const invalid = mount({ prepare: async () => ({ kind: "committed" }) });
  expect(await (await invalid.request(status({ conflict }))).json()).toMatchObject({
    error: { code: "sif.allocation_invalid", params: { reason: "event_mismatch" } },
  });
});
