import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  CORE_MIGRATIONS,
  openVenueDatabase,
  runMigrations,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { HandoverBinding } from "@waitron/handover";
import { NODE_MIGRATIONS, readHandoverOperation, readHandoverRestriction } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import {
  backgroundDuties,
  stopBackgroundDuties,
  type BackgroundDutyHandles,
} from "./background-duties.js";
import { closeListener } from "./close-listener.js";
import { createHandoverGate } from "./handover-gate.js";
import {
  HANDOVER_ADMITTED_WORK_LIMIT_MS,
  STEPDOWN_ALLOWED,
  stepDown,
  type StepDownDeps,
} from "./handover-stepdown.js";
import { beginHandover } from "./handover-store.js";
import { runLoop } from "./loop.js";
import { SHUTDOWN_DEADLINE_MS } from "./run-server.js";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const DESTINATION = "22222222-2222-4222-8222-222222222222";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const BINDING: HandoverBinding = {
  operationId: OP,
  scenario: "controlled",
  venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
  sourceNodeId: SOURCE,
  destinationNodeId: DESTINATION,
  membership: { term: 3, digest: "a".repeat(64) },
};

const ABORTS = [
  "controller",
  "pendingCardController",
  "cloudController",
  "invoiceEmailController",
  "attendanceController",
  "certificateReminderController",
  "tenderRefundController",
] as const;
const LOOPS = [
  "pendingCardLoop",
  "tenderRefundLoop",
  "attendanceLoop",
  "attendanceEmailLoop",
  "certificateReminderLoop",
  "invoiceEmailLoop",
  "cloudWorker",
  "cloudSnapshots",
  "suggestionLoop",
  "loop",
  "tunnelWorker",
] as const;
const STOPPERS = [
  "certificateDiagnosis",
  "menuActivation",
  "appendOnlyWatch",
  "freeSpaceWatch",
  "boxEmails",
  "backupSupervisor",
  "demoPrinterLoop",
  "clockWatch",
  "streamHost",
] as const;
const AT_STEPDOWN = [
  "certificateDiagnosis",
  "menuActivation",
  "boxEmails",
  "demoPrinterLoop",
  "clockWatch",
];

/** Stand-in duties that record, by table name, each stop or wait as it is called. */
function fakeDuties(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const controllers: Record<string, AbortController> = {};
  for (const name of [...ABORTS, "tunnelController"]) controllers[name] = new AbortController();
  controllers.tunnelController!.signal.addEventListener("abort", () =>
    calls.push("tunnelController"),
  );
  const handles: Record<string, unknown> = { ...controllers };
  for (const name of STOPPERS) {
    handles[name] = {
      stop: () => {
        calls.push(name);
        return Promise.resolve();
      },
    };
  }
  for (const name of LOOPS) {
    Object.defineProperty(handles, name, {
      enumerable: true,
      configurable: true,
      get: () => {
        calls.push(name);
        return Promise.resolve();
      },
    });
  }
  handles.unsubscribeFromChanges = () => calls.push("unsubscribeFromChanges");
  handles.stopSealingNodeCommits = () => calls.push("stopSealingNodeCommits");
  handles.sealedState = {
    settled: () => {
      calls.push("sealedState");
      return Promise.resolve();
    },
  };
  handles.liveEvents = { close: () => calls.push("liveEvents") };
  for (const [name, value] of Object.entries(overrides)) {
    Object.defineProperty(handles, name, { enumerable: true, value });
  }
  const duties = backgroundDuties(handles as unknown as BackgroundDutyHandles);
  return { calls, controllers, duties };
}

function hold() {
  let release!: () => void;
  const wait = new Promise<void>((done) => (release = done));
  return { release, wait };
}

interface Rig {
  app: Hono;
  deps: StepDownDeps;
  calls: string[];
  controllers: Record<string, AbortController>;
  restart: ReturnType<typeof vi.fn>;
  logs: { event: string; fields?: Record<string, unknown> }[];
  /** `calls.length` at the moment `stepDown` resolved inside the route. */
  atAnswer: { calls: number | null };
}

function rig(
  node: NodeDatabase,
  options: {
    duties?: ReturnType<typeof fakeDuties>;
    onAnswer?: (c: Context) => Promise<void> | void;
    close?: (deps: StepDownDeps) => Promise<void>;
  } = {},
): Rig {
  const { calls, controllers, duties } = options.duties ?? fakeDuties();
  const gate = createHandoverGate();
  const restart = vi.fn();
  const logs: Rig["logs"] = [];
  const deps: StepDownDeps = {
    node,
    nodeId: SOURCE,
    gate,
    duties,
    close: () => (options.close ? options.close(deps) : stopBackgroundDuties(duties)),
    restart,
    log: (_level, event, fields) => logs.push({ event, fields }),
  };
  const atAnswer: Rig["atAnswer"] = { calls: null };
  const app = new Hono();
  app.onError((_error, c) => c.json({ failed: true }, 500));
  app.use("*", gate.middleware);
  app.post("/stepdown", async (c) => {
    const result = await stepDown(deps, { binding: BINDING, kind: "handed-over", self: c });
    atAnswer.calls = calls.length;
    await options.onAnswer?.(c);
    return c.json(result);
  });
  return { app, deps, calls, controllers, restart, logs, atAnswer };
}

describe("a stepdown", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
  const begin = () => beginHandover({ node: suite.node, nodeId: SOURCE }, BINDING, "source");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the caller of the stepdown receives its full answer body", async () => {
    await begin();
    let server: ReturnType<typeof serve> | undefined;
    const r = rig(suite.node, {
      close: async (deps) => {
        await stopBackgroundDuties(deps.duties);
        await closeListener(server!);
      },
    });
    const port = await new Promise<number>((resolve) => {
      server = serve({ fetch: r.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) =>
        resolve(info.port),
      );
    });
    const response = await fetch(`http://127.0.0.1:${port}/stepdown`, { method: "POST" });
    expect(await response.json()).toEqual({ restarting: true, replayed: false });
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
  });

  it("the restriction is on disk before the answer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "waitron-stepdown-"));
    const store = await openVenueDatabase(directory);
    try {
      await runMigrations(store.node, NODE_MIGRATIONS);
      await beginHandover({ node: store.node, nodeId: SOURCE }, BINDING, "source");
      let seen: Awaited<ReturnType<typeof readHandoverRestriction>> | undefined;
      let state: string | undefined;
      const r = rig(store.node, {
        onAnswer: async () => {
          const second = await openVenueDatabase(directory, { exclusive: false });
          try {
            seen = await readHandoverRestriction(second.node, SOURCE);
            state = (await readHandoverOperation(second.node, SOURCE, OP))?.state;
          } finally {
            await second.close();
          }
        },
      });
      await r.app.request("/stepdown", { method: "POST" });
      expect(seen).toMatchObject({
        nodeId: SOURCE,
        operationId: OP,
        kind: "handed-over",
        successorNodeId: DESTINATION,
        membershipTerm: 3,
      });
      expect(state).toBe("source_stepped_down");
      await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("every abort and every atStepdown stop has taken effect when stepDown resolves", async () => {
    await begin();
    let aborted: string[] = [];
    let stopped: string[] = [];
    const r = rig(suite.node, {
      onAnswer: () => {
        aborted = ABORTS.filter((name) => r.controllers[name]!.signal.aborted);
        stopped = [...r.calls];
      },
    });
    await r.app.request("/stepdown", { method: "POST" });
    expect(aborted).toEqual([...ABORTS]);
    expect(stopped).toEqual(AT_STEPDOWN);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
  });

  it("the five early stops' source text sets the stop flag before the first await", async () => {
    // Reads the source as text: calling a stop inside the request is safe only while its first
    // effect comes before its first await, so a reordering of any of these fails here.
    const files = [
      "fiscal-certificate-diagnosis-runner.ts",
      "menu-activation.ts",
      "box-alert-email.ts",
      "demo-printer.ts",
      "clock-watch.ts",
    ];
    for (const file of files) {
      const text = await readFile(join(import.meta.dirname, file), "utf8");
      const starts = [...text.matchAll(/(async stop\(\) \{|stop: async \(\) => \{)\n/g)];
      expect(starts, file).toHaveLength(1);
      const body = text.slice(starts[0]!.index + starts[0]![0].length);
      expect(body.split("\n")[0]!.trim(), file).toBe("stopped = true;");
    }
  });

  it("backups and Litestream are not stopped before the answer", async () => {
    await begin();
    let before: string[] = [];
    const r = rig(suite.node, { onAnswer: () => void (before = [...r.calls]) });
    await r.app.request("/stepdown", { method: "POST" });
    expect(before).not.toContain("backupSupervisor");
    expect(before).not.toContain("streamHost");
    await vi.waitFor(() => expect(r.calls).toContain("streamHost"));
  });

  it("after the answer the close runs in the table's order, Litestream last", async () => {
    await begin();
    const r = rig(suite.node);
    await r.app.request("/stepdown", { method: "POST" });
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    const after = r.calls.slice(r.atAnswer.calls!);
    expect(after).toEqual(
      r.deps.duties.closers.filter((c) => c.atStepdown !== true).map((c) => c.name),
    );
    expect(after.at(-1)).toBe("streamHost");
  });

  it("each stop runs exactly once across the stepdown and the close", async () => {
    await begin();
    const r = rig(suite.node);
    await r.app.request("/stepdown", { method: "POST" });
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    const names = r.deps.duties.closers.map((c) => c.name);
    expect([...r.calls].sort()).toEqual([...names].sort());
  });

  it("every closer is either atStepdown or carries a reason", () => {
    const { duties } = fakeDuties();
    for (const closer of duties.closers) {
      expect(closer.atStepdown === true || (closer.reason ?? "") !== "", closer.name).toBe(true);
      expect(closer.atStepdown === true && closer.reason !== undefined, closer.name).toBe(false);
    }
    expect(duties.closers.filter((c) => c.atStepdown === true).map((c) => c.name)).toEqual(
      AT_STEPDOWN,
    );
  });

  it("no named duty starts a new pass after the stepdown began", async () => {
    await begin();
    const controller = new AbortController();
    const passes: number[] = [];
    const sleeping = hold();
    let asleep = false;
    const loop = runLoop({
      pass: () => {
        passes.push(Date.now());
        return Promise.resolve({ nextDueAt: null } as never);
      },
      now: () => new Date(),
      // The first sleep ends when the test says; any later one ends at the abort.
      sleep: async (_ms, signal) => {
        if (!asleep) {
          asleep = true;
          await sleeping.wait;
          return;
        }
        if (!signal.aborted) {
          await new Promise((done) => signal.addEventListener("abort", done, { once: true }));
        }
      },
      signal: controller.signal,
      minTickMs: 0,
      maxTickMs: 0,
      log: () => {},
    });
    await vi.waitFor(() => expect(asleep).toBe(true));
    expect(passes).toHaveLength(1);
    const duties = fakeDuties({ controller, loop });
    // The loop's sleep ends as the restriction's write begins, after the duties were told to stop.
    const node = hookedNode(suite.node, async () => {
      sleeping.release();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const r = rig(node, { duties });
    await r.app.request("/stepdown", { method: "POST" });
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    await loop;
    expect(passes).toHaveLength(1);
  });

  it("a throw while signalling still schedules the restart", async () => {
    await begin();
    const duties = fakeDuties({
      cloudController: {
        abort: () => {
          throw new Error("abort failed");
        },
      },
    });
    const r = rig(suite.node, { duties });
    const response = await r.app.request("/stepdown", { method: "POST" });
    expect(response.status).toBe(500);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    expect(r.deps.gate.isClosed()).toBe(true);
    // The duties after the one that threw were still told.
    expect(r.controllers.tenderRefundController!.signal.aborted).toBe(true);
    expect(await readHandoverRestriction(suite.node, SOURCE)).not.toBeNull();
  });

  it("an early stop that throws does not keep the others from being told", async () => {
    await begin();
    const duties = fakeDuties({
      menuActivation: {
        stop: () => {
          throw new Error("stop failed");
        },
      },
    });
    const r = rig(suite.node, { duties });
    const response = await r.app.request("/stepdown", { method: "POST" });
    expect(response.status).toBe(500);
    expect(r.calls.slice(0, 4)).toEqual([
      "certificateDiagnosis",
      "boxEmails",
      "demoPrinterLoop",
      "clockWatch",
    ]);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
  });

  it("a close that fails is logged and the box still restarts", async () => {
    await begin();
    // An early stop that fails later: its failure surfaces in the close, never as unhandled.
    const duties = fakeDuties({ clockWatch: { stop: () => Promise.reject(new Error("failed")) } });
    const r = rig(suite.node, { duties });
    await r.app.request("/stepdown", { method: "POST" });
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    expect(r.logs.map((l) => l.event)).toContain("handover.stepdown_close_failed");
    expect(r.calls.at(-1)).toBe("streamHost");
  });

  it("a request still running at the limit is cut and logged by route, and the stepdown proceeds", async () => {
    await begin();
    const r = rig(suite.node);
    r.app.get("/slow", async (c) => {
      await new Promise(() => {});
      return c.json({});
    });
    void r.app.request("/slow?x=1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await r.app.request("/stepdown", { method: "POST" });
    await vi.advanceTimersByTimeAsync(HANDOVER_ADMITTED_WORK_LIMIT_MS - 1);
    expect(r.restart).not.toHaveBeenCalled();
    expect(r.calls).not.toContain("streamHost");
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    expect(r.logs.filter((l) => l.event === "handover.admitted_work_cut")).toEqual([
      { event: "handover.admitted_work_cut", fields: { method: "GET", path: "/slow" } },
    ]);
    expect(r.calls.at(-1)).toBe("streamHost");
  });

  it("a close that never settles still restarts once the shutdown deadline passes", async () => {
    await begin();
    const r = rig(suite.node, { close: () => new Promise(() => {}) });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await r.app.request("/stepdown", { method: "POST" });
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(r.restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.restart).toHaveBeenCalledTimes(1);
    expect(r.logs).toContainEqual({
      event: "handover.stepdown_close_timeout",
      fields: { deadlineMs: SHUTDOWN_DEADLINE_MS },
    });
  });

  it("a close that finishes inside the deadline clears the deadline's timer and restarts once", async () => {
    await begin();
    const r = rig(suite.node);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await r.app.request("/stepdown", { method: "POST" });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.restart).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS + 1);
    expect(r.restart).toHaveBeenCalledTimes(1);
    expect(r.logs.map((l) => l.event)).not.toContain("handover.stepdown_close_timeout");
  });

  it("two calls at once for the same binding step down once", async () => {
    await begin();
    const r = rig(suite.node);
    const close = vi.spyOn(r.deps.gate, "close");
    let self: Context | undefined;
    r.app.post("/twice", async (c) => {
      self = c;
      const both = await Promise.all([
        stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: c }),
        stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: c }),
      ]);
      return c.json(both);
    });
    const response = await r.app.request("/twice", { method: "POST" });
    expect(self).toBeDefined();
    expect((await response.json()) as unknown[]).toEqual(
      expect.arrayContaining([
        { restarting: true, replayed: false },
        { restarting: true, replayed: true },
      ]),
    );
    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.restart).toHaveBeenCalledTimes(1);
    const names = r.deps.duties.closers.map((c) => c.name);
    expect([...r.calls].sort()).toEqual([...names].sort());
  });

  it("waits 180 seconds for admitted work", () => {
    expect(HANDOVER_ADMITTED_WORK_LIMIT_MS).toBe(180_000);
  });

  it("a second call for the same binding answers replayed and does not restart twice", async () => {
    await begin();
    let self: Context | undefined;
    const r = rig(suite.node, { onAnswer: (c) => void (self = c) });
    await r.app.request("/stepdown", { method: "POST" });
    const second = await stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: self! });
    expect(second).toEqual({ restarting: true, replayed: true });
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.restart).toHaveBeenCalledTimes(1);
    expect(r.calls.filter((name) => name === "streamHost")).toHaveLength(1);
  });

  it("a second call for another binding is refused and changes nothing", async () => {
    await begin();
    let self: Context | undefined;
    const r = rig(suite.node, { onAnswer: (c) => void (self = c) });
    await r.app.request("/stepdown", { method: "POST" });
    const error = await captureError(() =>
      stepDown(r.deps, {
        binding: { ...BINDING, destinationNodeId: "33333333-3333-4333-8333-333333333333" },
        kind: "handed-over",
        self: self!,
      }),
    );
    expect((error as AppError).code).toBe("handover.operation_conflict");
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    expect((await readHandoverRestriction(suite.node, SOURCE))?.successorNodeId).toBe(DESTINATION);
  });

  it("a second supersession naming another successor is refused and changes nothing", async () => {
    const r = rig(suite.node);
    const superseded = (destinationNodeId: string) => ({
      binding: { ...BINDING, scenario: "emergency" as const, destinationNodeId },
      kind: "superseded" as const,
    });
    let error: unknown;
    r.app.post("/superseded-twice", async (c) => {
      await stepDown(r.deps, { ...superseded(DESTINATION), self: c });
      error = await captureError(() =>
        stepDown(r.deps, { ...superseded("33333333-3333-4333-8333-333333333333"), self: c }),
      );
      return c.body(null);
    });
    await r.app.request("/superseded-twice", { method: "POST" });
    expect((error as AppError | undefined)?.code).toBe("handover.restriction_conflict");
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    expect((await readHandoverRestriction(suite.node, SOURCE))?.successorNodeId).toBe(DESTINATION);
  });

  describe("a first call whose binding is not the one the operation was begun with", () => {
    const cases = [
      [
        "another destination",
        { ...BINDING, destinationNodeId: "33333333-3333-4333-8333-333333333333" },
      ],
      [
        "another membership digest",
        { ...BINDING, membership: { term: 3, digest: "b".repeat(64) } },
      ],
    ] as const;

    it.each(cases)("naming %s is refused and changes nothing", async (_name, binding) => {
      await begin();
      const before = await readHandoverOperation(suite.node, SOURCE, OP);
      const r = rig(suite.node);
      let error: unknown;
      r.app.post("/other", async (c) => {
        error = await captureError(() =>
          stepDown(r.deps, { binding, kind: "handed-over", self: c }),
        );
        return c.body(null);
      });
      await r.app.request("/other", { method: "POST" });
      expect((error as AppError | undefined)?.code).toBe("handover.operation_conflict");
      expect(await readHandoverRestriction(suite.node, SOURCE)).toBeNull();
      expect(await readHandoverOperation(suite.node, SOURCE, OP)).toEqual(before);
      expect(r.deps.gate.isClosed()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(r.restart).not.toHaveBeenCalled();
      expect(r.calls).toEqual([]);
    });

    it("control: the binding the operation was begun with steps down", async () => {
      await begin();
      const r = rig(suite.node);
      let result: unknown;
      r.app.post("/same", async (c) => {
        result = await stepDown(r.deps, { binding: { ...BINDING }, kind: "handed-over", self: c });
        return c.body(null);
      });
      await r.app.request("/same", { method: "POST" });
      expect(result).toEqual({ restarting: true, replayed: false });
      expect((await readHandoverOperation(suite.node, SOURCE, OP))?.state).toBe(
        "source_stepped_down",
      );
      await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    });
  });

  it("a superseded box records its restriction without moving an operation", async () => {
    let self: Context | undefined;
    const r = rig(suite.node);
    r.app.post("/superseded", async (c) => {
      self = c;
      return c.json(
        await stepDown(r.deps, {
          binding: { ...BINDING, scenario: "emergency" },
          kind: "superseded",
          self: c,
        }),
      );
    });
    const response = await r.app.request("/superseded", { method: "POST" });
    expect(await response.json()).toEqual({ restarting: true, replayed: false });
    expect(self).toBeDefined();
    expect(await readHandoverRestriction(suite.node, SOURCE)).toMatchObject({
      kind: "superseded",
      successorNodeId: DESTINATION,
    });
    expect(await readHandoverOperation(suite.node, SOURCE, OP)).toBeNull();
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
  });

  it("lets through only what a stepped-down box still answers", () => {
    const app = new Hono();
    const seen: Record<string, boolean> = {};
    app.all("*", (c) => {
      seen[`${c.req.method} ${c.req.path}`] = STEPDOWN_ALLOWED(c);
      return c.body(null);
    });
    const asks = [
      ["GET", "/health", true],
      ["GET", "/api/node", true],
      ["POST", "/api/node/peer-status", true],
      ["GET", `/api/node/handover/${OP}`, true],
      ["POST", "/health", false],
      ["GET", "/api/node/handover", false],
      ["GET", `/api/node/handover/${OP}/extra`, false],
      ["POST", "/api/till/sales", false],
      ["GET", "/management-api/me", false],
    ] as const;
    return Promise.all(asks.map(([method, path]) => app.request(path, { method }))).then(() => {
      for (const [method, path, allowed] of asks) {
        expect(seen[`${method} ${path}`], `${method} ${path}`).toBe(allowed);
      }
    });
  });
});

/** `node` with `onWrite` run as each write transaction begins, before its body. */
function hookedNode(node: NodeDatabase, onWrite: () => Promise<void> | void): NodeDatabase {
  return new Proxy(node, {
    get: (target, key) => {
      if (key === "withWriteLock") {
        return async <T>(fn: () => Promise<T>) => {
          await onWrite();
          return target.withWriteLock(fn);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("a stepdown stops the background work before it writes", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
  const begin = () => beginHandover({ node: suite.node, nodeId: SOURCE }, BINDING, "source");

  it("a drain that would claim as the write begins sees its stop and claims nothing", async () => {
    await begin();
    const duties = fakeDuties();
    const claims: string[] = [];
    const node = hookedNode(suite.node, () => {
      // The drain checks its signal before each claim.
      if (!duties.controllers.controller!.signal.aborted) claims.push("claimed");
    });
    const r = rig(node, { duties });
    const response = await r.app.request("/stepdown", { method: "POST" });
    expect(await response.json()).toEqual({ restarting: true, replayed: false });
    expect(claims).toEqual([]);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
  });

  it("a write that fails is the caller's answer, writes no restriction, and restarts the box", async () => {
    await begin();
    const before = await readHandoverOperation(suite.node, SOURCE, OP);
    const failure = new Error("the write failed");
    const r = rig(
      hookedNode(suite.node, () => {
        throw failure;
      }),
    );
    let error: unknown;
    r.app.post("/failing", async (c) => {
      error = await captureError(() =>
        stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: c }),
      );
      return c.body(null);
    });
    await r.app.request("/failing", { method: "POST" });
    expect(error).toBe(failure);
    expect(r.controllers.controller!.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    expect(await readHandoverRestriction(suite.node, SOURCE)).toBeNull();
    expect(await readHandoverOperation(suite.node, SOURCE, OP)).toEqual(before);
  });

  it("a replay while the write is in flight answers replayed only once the write commits", async () => {
    await begin();
    const writing = hold();
    let held = false;
    const r = rig(
      hookedNode(suite.node, async () => {
        if (held) return;
        held = true;
        await writing.wait;
      }),
    );
    const close = vi.spyOn(r.deps.gate, "close");
    let self: Context | undefined;
    let replaySettled = false;
    let first: Promise<unknown> | undefined;
    let replay: Promise<unknown> | undefined;
    r.app.post("/replay", async (c) => {
      self = c;
      first = stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: c });
      await vi.waitFor(() => expect(held).toBe(true));
      replay = stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: c }).finally(
        () => (replaySettled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(replaySettled).toBe(false);
      expect(await readHandoverRestriction(suite.node, SOURCE)).toBeNull();
      writing.release();
      const answers = await Promise.all([first, replay]);
      return c.json({ answers, restriction: await readHandoverRestriction(suite.node, SOURCE) });
    });
    const response = await r.app.request("/replay", { method: "POST" });
    const body = (await response.json()) as { answers: unknown[]; restriction: unknown };
    expect(self).toBeDefined();
    expect(body.answers).toEqual([
      { restarting: true, replayed: false },
      { restarting: true, replayed: true },
    ]);
    expect(body.restriction).toMatchObject({ operationId: OP, successorNodeId: DESTINATION });
    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.restart).toHaveBeenCalledTimes(1);
  });

  it("a supersession naming another successor while the first one's write is in flight is refused once it commits", async () => {
    const writing = hold();
    let held = false;
    const r = rig(
      hookedNode(suite.node, async () => {
        if (held) return;
        held = true;
        await writing.wait;
      }),
    );
    const superseded = (destinationNodeId: string) => ({
      binding: { ...BINDING, scenario: "emergency" as const, destinationNodeId },
      kind: "superseded" as const,
    });
    let outcomes: unknown[] = [];
    r.app.post("/superseded-in-flight", async (c) => {
      const first = stepDown(r.deps, { ...superseded(DESTINATION), self: c });
      await vi.waitFor(() => expect(held).toBe(true));
      const second = captureError(() =>
        stepDown(r.deps, { ...superseded("33333333-3333-4333-8333-333333333333"), self: c }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      writing.release();
      outcomes = await Promise.all([first, second]);
      return c.body(null);
    });
    await r.app.request("/superseded-in-flight", { method: "POST" });
    expect(outcomes[0]).toEqual({ restarting: true, replayed: false });
    expect((outcomes[1] as AppError | undefined)?.code).toBe("handover.restriction_conflict");
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    expect((await readHandoverRestriction(suite.node, SOURCE))?.successorNodeId).toBe(DESTINATION);
  });

  it("a replay while the write is in flight gets the write's refusal when the write fails", async () => {
    await begin();
    const writing = hold();
    const failure = new Error("the write failed");
    let writes = 0;
    const r = rig(
      hookedNode(suite.node, async () => {
        writes += 1;
        await writing.wait;
        throw failure;
      }),
    );
    const close = vi.spyOn(r.deps.gate, "close");
    let errors: unknown[] = [];
    r.app.post("/replay-fails", async (c) => {
      const first = captureError(() =>
        stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: c }),
      );
      await vi.waitFor(() => expect(writes).toBe(1));
      const replay = captureError(() =>
        stepDown(r.deps, { binding: BINDING, kind: "handed-over", self: c }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      writing.release();
      errors = await Promise.all([first, replay]);
      return c.body(null);
    });
    await r.app.request("/replay-fails", { method: "POST" });
    expect(errors).toEqual([failure, failure]);
    expect(writes).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(r.restart).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.restart).toHaveBeenCalledTimes(1);
    expect(await readHandoverRestriction(suite.node, SOURCE)).toBeNull();
  });
});
