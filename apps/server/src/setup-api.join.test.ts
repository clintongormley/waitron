import { mkdtempSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import type { BoxJoinAttempt, JoinAttemptState, JoinedBox } from "./box-join-attempt.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { createSetupOperationStore, type SetupOperationStore } from "./setup-operation.js";

const PRIMARY_URL = "https://main.deli.test:8443";
const TIME_LEFT_MS = 900_000;

/** Stands in for the attempt, whose own behaviour `box-join-attempt.test.ts` covers. */
function fakeAttempt() {
  let state: JoinAttemptState | null = null;
  let joined: JoinedBox | null = null;
  let started = 0;
  let gate: Promise<void> | undefined;
  let running: Promise<unknown> | null = null;
  const open = async (primaryUrl: string) => {
    await gate;
    started += 1;
    const code = String(100000 + started);
    state = { state: "waiting", code, primaryUrl, timeLeftMs: TIME_LEFT_MS, confirmed: false };
    return { code, timeLeftMs: TIME_LEFT_MS };
  };
  const attempt = {
    start: vi.fn(async (primaryUrl: string) => {
      const opening = open(primaryUrl);
      running = opening;
      try {
        return await opening;
      } finally {
        running = null;
      }
    }),
    // As the real attempt does, a cancel during a start waits for it and then ends it.
    cancel: vi.fn(async () => {
      await running?.catch(() => {});
      state = null;
      joined = null;
    }),
    confirm: vi.fn(async () => {
      if (state?.state === "waiting") state = { ...state, confirmed: true };
    }),
    current: () => state,
    joined: () => joined,
  } satisfies BoxJoinAttempt;
  /** Holds the next start until the returned function is called. */
  const hold = () => {
    let release = () => {};
    gate = new Promise((resolve) => (release = resolve));
    return () => {
      gate = undefined;
      release();
    };
  };
  const approve = (box: JoinedBox) => {
    state = { state: "approved", code: String(100000 + started) };
    joined = box;
  };
  return { attempt, hold, approve, set: (next: JoinAttemptState | null) => (state = next) };
}

type Env = { incoming: { socket: unknown } };

describe("the setup page's join routes", () => {
  let socket: TLSSocket;
  let secure: Env;
  let fake: ReturnType<typeof fakeAttempt>;
  let app: Hono;

  const mount = (deps: Partial<SetupDeps> = {}) => {
    app = new Hono();
    mountSetup(app, { environment: "preproduction", joinAttempt: fake.attempt, ...deps }, () => {});
  };

  beforeEach(() => {
    vi.useFakeTimers();
    socket = new TLSSocket(new Socket());
    secure = { incoming: { socket } };
    fake = fakeAttempt();
    mount();
  });
  afterEach(() => {
    socket.destroy();
    vi.useRealTimers();
  });

  function send(
    method: "GET" | "POST",
    path: string,
    options: { handle?: string; headers?: Record<string, string>; env?: Env } = {},
  ) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.handle !== undefined) headers["x-waitron-join-handle"] = options.handle;
    if (path === "start") headers["content-type"] = "application/json";
    return app.request(
      `https://box.test/setup-api/join${path === "" ? "" : `/${path}`}`,
      {
        method,
        headers,
        ...(path === "start" ? { body: JSON.stringify({ primaryUrl: PRIMARY_URL }) } : {}),
      },
      options.env ?? secure,
    );
  }
  const read = async (handle?: string) => (await send("GET", "", { handle })).json();
  const start = (handle?: string) => send("POST", "start", { handle });
  const cancel = (handle?: string) => send("POST", "cancel", { handle });
  const confirm = (handle?: string) => send("POST", "confirm", { handle });
  async function started(): Promise<string> {
    const response = await start();
    expect(response.status).toBe(200);
    return ((await response.json()) as { handle: string }).handle;
  }
  async function refusal(response: Response) {
    return { status: response.status, code: ((await response.json()) as never)["error"]["code"] };
  }

  it("shows the code only to the page holding the current handle", async () => {
    expect(await read()).toEqual({ state: "none" });
    const response = await start();
    const answer = (await response.json()) as Record<string, unknown>;
    expect(answer).toEqual({
      code: "100001",
      timeLeftMs: TIME_LEFT_MS,
      handle: expect.stringMatching(/^[\w-]{43}$/),
    });
    expect(fake.attempt.start).toHaveBeenCalledWith(PRIMARY_URL);
    expect(await read(answer.handle as string)).toEqual({
      state: "waiting",
      code: "100001",
      primaryUrl: PRIMARY_URL,
      timeLeftMs: TIME_LEFT_MS,
      confirmed: false,
    });
    expect(await read()).toEqual({ state: "elsewhere" });
    expect(await read("")).toEqual({ state: "elsewhere" });
  });

  it("tells a page whose join another page cancelled and started again that it was replaced", async () => {
    const first = await started();
    vi.advanceTimersByTime(15_000);
    expect((await cancel()).status).toBe(204);
    expect(await read(first)).toEqual({ state: "replaced" });
    const second = await started();
    expect(await read(first)).toEqual({ state: "replaced" });
    expect(await read(second)).toMatchObject({ state: "waiting", code: "100002" });
  });

  it.each(["cancel", "start"] as const)(
    "refuses a %s without the handle while the holding tab read the state in the last 15 seconds",
    async (action) => {
      const handle = await started();
      fake.set({ state: "ended", reason: "dismissed" });
      vi.advanceTimersByTime(10_000);
      await read(handle);
      vi.advanceTimersByTime(14_999);
      const refused = action === "cancel" ? await cancel() : await start();
      expect(await refusal(refused)).toEqual({ status: 409, code: "mirror.join_in_use" });
      expect(fake.attempt.cancel).not.toHaveBeenCalled();
      expect(fake.attempt.start).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1);
      const allowed = action === "cancel" ? await cancel() : await start();
      expect(allowed.status).toBe(action === "cancel" ? 204 : 200);
      expect(await read(handle)).toEqual({ state: "replaced" });
    },
  );

  it("refuses a cancel or start without the handle for as long as a start runs", async () => {
    const release = fake.hold();
    const starting = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.attempt.start).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    const refused = [cancel(), start()];
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.attempt.cancel).not.toHaveBeenCalled();
    expect(fake.attempt.start).toHaveBeenCalledOnce();
    release();
    expect(await Promise.all((await Promise.all(refused)).map(refusal))).toEqual([
      { status: 409, code: "mirror.join_in_use" },
      { status: 409, code: "mirror.join_in_use" },
    ]);
    const { handle } = (await (await starting).json()) as { handle: string };
    expect((await cancel(handle)).status).toBe(204);
    expect(fake.attempt.cancel).toHaveBeenCalledOnce();
  });

  it("leaves the previous handle current when a start fails", async () => {
    const handle = await started();
    fake.set({ state: "ended", reason: "dismissed" });
    fake.attempt.start.mockRejectedValueOnce(new AppError("mirror.bundle_fetch_failed", {}));
    const failed = await refusal(await start(handle));
    expect(failed).toEqual({ status: 502, code: "mirror.bundle_fetch_failed" });
    expect(await read(handle)).toEqual({ state: "ended", reason: "dismissed" });
    expect((await cancel(handle)).status).toBe(204);
    expect(fake.attempt.cancel).toHaveBeenCalledOnce();
  });

  it("answers none to the holding tab while its own cancel is under way", async () => {
    const handle = await started();
    let finish = () => {};
    fake.attempt.cancel.mockImplementationOnce(async () => {
      fake.set(null);
      await new Promise<void>((resolve) => (finish = resolve));
    });
    const cancelling = cancel(handle);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.attempt.cancel).toHaveBeenCalledOnce();
    expect(await read(handle)).toEqual({ state: "none" });
    finish();
    expect((await cancelling).status).toBe(204);
  });

  it("keeps the holder a start set while the same page's earlier cancel was still under way", async () => {
    const first = await started();
    let finish = () => {};
    fake.attempt.cancel.mockImplementationOnce(async () => {
      fake.set(null);
      await new Promise<void>((resolve) => (finish = resolve));
    });
    const cancelling = cancel(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.attempt.cancel).toHaveBeenCalledOnce();
    const response = await start(first);
    expect(response.status).toBe(200);
    const { handle: second } = (await response.json()) as { handle: string };
    finish();
    expect((await cancelling).status).toBe(204);
    expect(await read(second)).toMatchObject({ state: "waiting", code: "100002" });
    expect(await refusal(await cancel())).toEqual({ status: 409, code: "mirror.join_in_use" });
  });

  it("cancels with the current handle while its tab is live", async () => {
    const handle = await started();
    await read(handle);
    expect((await cancel(handle)).status).toBe(204);
    expect(fake.attempt.cancel).toHaveBeenCalledOnce();
    expect(await read()).toEqual({ state: "none" });
  });

  it("sends the Yes with the current handle while its tab is live", async () => {
    const handle = await started();
    await read(handle);
    expect((await confirm(handle)).status).toBe(204);
    expect(fake.attempt.confirm).toHaveBeenCalledOnce();
    expect(await read(handle)).toMatchObject({ state: "waiting", confirmed: true });
  });

  it("refuses a Yes without the handle while the holding tab read the state in the last 15 seconds", async () => {
    const handle = await started();
    vi.advanceTimersByTime(10_000);
    await read(handle);
    vi.advanceTimersByTime(14_999);
    expect(await refusal(await confirm())).toEqual({ status: 409, code: "mirror.join_in_use" });
    expect(fake.attempt.confirm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect((await confirm()).status).toBe(204);
    expect(fake.attempt.confirm).toHaveBeenCalledOnce();
  });

  it("passes on a Yes the attempt could not send, or has no waiting join for", async () => {
    const handle = await started();
    fake.attempt.confirm.mockRejectedValueOnce(new AppError("mirror.bundle_fetch_failed", {}));
    expect(await refusal(await confirm(handle))).toEqual({
      status: 502,
      code: "mirror.bundle_fetch_failed",
    });
    fake.attempt.confirm.mockRejectedValueOnce(
      new AppError("setup.request_invalid", { field: "join" }),
    );
    expect(await refusal(await confirm(handle))).toEqual({
      status: 400,
      code: "setup.request_invalid",
    });
    expect(await read(handle)).toMatchObject({ state: "waiting", confirmed: false });
  });

  it.each([
    ["GET", ""],
    ["POST", "start"],
    ["POST", "cancel"],
    ["POST", "confirm"],
  ] as const)("refuses %s %s from another page or over plain http", async (method, path) => {
    const handle = await started();
    fake.attempt.start.mockClear();
    const refusals = [
      await send(method, path, { handle, env: { incoming: { socket: new Socket() } } }),
      await send(method, path, { handle, headers: { origin: "https://other.test" } }),
      await send(method, path, { handle, headers: { "sec-fetch-site": "cross-site" } }),
    ];
    expect(await Promise.all(refusals.map(refusal))).toEqual([
      { status: 403, code: "setup.connection_insecure" },
      { status: 403, code: "setup.owner_required" },
      { status: 403, code: "setup.owner_required" },
    ]);
    expect(fake.attempt.start).not.toHaveBeenCalled();
    expect(fake.attempt.cancel).not.toHaveBeenCalled();
    expect(fake.attempt.confirm).not.toHaveBeenCalled();
  });

  it("takes plain http from the box itself", async () => {
    const loopback = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
    expect(await (await send("GET", "", { env: loopback })).json()).toEqual({ state: "none" });
  });

  it("never answers a state read with the handle", async () => {
    const handle = await started();
    const states: JoinAttemptState[] = [
      {
        state: "waiting",
        code: "100001",
        primaryUrl: PRIMARY_URL,
        timeLeftMs: TIME_LEFT_MS,
        confirmed: true,
      },
      { state: "approved", code: "100001" },
      { state: "ended", reason: "dismissed" },
      { state: "failed", error: "mirror.join_not_found" },
    ];
    for (const state of states) {
      fake.set(state);
      for (const sent of [handle, undefined, "another"]) {
        const text = await (await send("GET", "", { handle: sent })).text();
        expect(text).not.toContain(handle);
      }
    }
  });

  it("passes on a cancel the main box refuses while it approves, keeping the page's handle", async () => {
    const handle = await started();
    await read(handle);
    fake.attempt.cancel.mockRejectedValueOnce(new AppError("mirror.join_approving", {}));
    expect(await refusal(await cancel(handle))).toEqual({
      status: 409,
      code: "mirror.join_approving",
    });
    expect(await read(handle)).toMatchObject({ state: "waiting" });
  });

  it("passes the attempt's refusals to the page", async () => {
    fake.attempt.start.mockRejectedValueOnce(new AppError("mirror.join_waiting", {}));
    expect(await refusal(await start())).toEqual({ status: 409, code: "mirror.join_waiting" });
    const retryAt = "2026-11-21T10:01:00.000Z";
    fake.attempt.start.mockRejectedValueOnce(
      new AppError("mirror.join_full", { limit: "recent", retryAt, max: 6, minutes: 15 }),
    );
    const full = await start();
    expect(full.status).toBe(429);
    expect(await full.json()).toEqual({
      error: {
        code: "mirror.join_full",
        params: { limit: "recent", retryAt, max: 6, minutes: 15 },
      },
    });
    expect(await read()).toEqual({ state: "none" });
  });

  it.each([
    ["adopt", "venue_committed", "setup.adopt_incomplete"],
    ["provision", "started", "setup.already_provisioning"],
  ])("refuses a start while a %s is %s on this box", async (kind, phase, code) => {
    const operations = {
      read: async () => ({ id: "op-1", kind, phase }),
    } as unknown as SetupOperationStore;
    mount({ operations });
    expect(await refusal(await start())).toEqual({ status: 409, code });
    expect(fake.attempt.start).not.toHaveBeenCalled();
  });

  it("holds no other setup request back while a start waits on the main box", async () => {
    const coordinator = createFirstSetupCoordinator();
    const assertOtherAllowed = vi.fn(async () => {});
    mount({ firstSetup: { coordinator, assertOtherAllowed } });
    const release = fake.hold();
    const starting = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.attempt.start).toHaveBeenCalledOnce();
    expect(await coordinator.run(async () => "ran")).toBe("ran");
    expect(assertOtherAllowed).toHaveBeenCalledOnce();
    release();
    expect((await starting).status).toBe(200);
  });

  it("still refuses a start while another first setup is under way", async () => {
    mount({
      firstSetup: {
        coordinator: createFirstSetupCoordinator(),
        assertOtherAllowed: async () => {
          throw new AppError("setup.attempt_conflict", {});
        },
      },
    });
    expect(await refusal(await start())).toEqual({ status: 409, code: "setup.attempt_conflict" });
    expect(fake.attempt.start).not.toHaveBeenCalled();
  });

  const JOINED = {
    identity: { nodeId: "aaaa0000-0000-4000-8000-000000000000" },
    storeUrl: "https://box-aaaa.waitron.local:7600",
  } as unknown as JoinedBox;
  const ADOPTED = { breakGlassSecret: "the-server-key", breakGlassKeyName: "Spare key" };

  function mountAdopt(deps: Partial<SetupDeps> = {}) {
    const adoptJoined = vi.fn<NonNullable<SetupDeps["adoptJoined"]>>(async () => ADOPTED);
    const requestRestart = vi.fn();
    const stageReset = vi.fn<NonNullable<SetupDeps["stageReset"]>>(async () => {});
    mount({ adoptJoined, requestRestart, stageReset, ...deps });
    return { adoptJoined, requestRestart, stageReset };
  }
  function post(
    path: "adopt" | "reset-incomplete-adopt",
    options: { handle?: string; headers?: Record<string, string>; env?: Env; body?: string } = {},
  ) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.handle !== undefined) headers["x-waitron-join-handle"] = options.handle;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    return app.request(
      `https://box.test/setup-api/${path}`,
      { method: "POST", headers, ...(options.body === undefined ? {} : { body: options.body }) },
      options.env ?? secure,
    );
  }

  it("finishes an approved join for the page holding its handle, and only once", async () => {
    const { adoptJoined, requestRestart } = mountAdopt();
    const handle = await started();
    fake.approve(JOINED);
    const response = await post("adopt", { handle });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adopted: true, ...ADOPTED, restarting: true });
    expect(adoptJoined).toHaveBeenCalledWith(JOINED, expect.anything());
    await vi.advanceTimersByTimeAsync(0);
    expect(requestRestart).toHaveBeenCalledOnce();
    expect(await refusal(await post("adopt", { handle }))).toEqual({
      status: 409,
      code: "setup.already_provisioning",
    });
    expect(adoptJoined).toHaveBeenCalledOnce();
  });

  it.each([
    ["no handle", undefined],
    ["another handle", "another"],
  ])("refuses to finish a join for a page with %s", async (_label, handle) => {
    const { adoptJoined } = mountAdopt();
    await started();
    fake.approve(JOINED);
    expect(await refusal(await post("adopt", { handle }))).toEqual({
      status: 409,
      code: "mirror.join_handle_invalid",
    });
    expect(adoptJoined).not.toHaveBeenCalled();
  });

  it("refuses to finish a join the main box has not approved, and finishes it once approved", async () => {
    const { adoptJoined } = mountAdopt();
    const handle = await started();
    expect(await refusal(await post("adopt", { handle }))).toEqual({
      status: 400,
      code: "setup.request_invalid",
    });
    expect(adoptJoined).not.toHaveBeenCalled();
    fake.approve(JOINED);
    expect((await post("adopt", { handle })).status).toBe(200);
  });

  it.each(["adopt", "reset-incomplete-adopt"] as const)(
    "refuses %s from another page or over plain http",
    async (path) => {
      const operations = { read: async () => null } as unknown as SetupOperationStore;
      const { adoptJoined, stageReset } = mountAdopt({ operations });
      const handle = await started();
      fake.approve(JOINED);
      const refusals = [
        await post(path, { handle, env: { incoming: { socket: new Socket() } } }),
        await post(path, { handle, headers: { origin: "https://other.test" } }),
      ];
      expect(await Promise.all(refusals.map(refusal))).toEqual([
        { status: 403, code: "setup.connection_insecure" },
        { status: 403, code: "setup.owner_required" },
      ]);
      expect(adoptJoined).not.toHaveBeenCalled();
      expect(stageReset).not.toHaveBeenCalled();
    },
  );

  it("records no reset proof for a join stopped after its first write, refuses its resend, and resets with no body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-join-adopt-"));
    try {
      const operations = createSetupOperationStore(dir);
      const { adoptJoined, stageReset, requestRestart } = mountAdopt({ operations });
      adoptJoined.mockImplementationOnce(async (_joined, hooks) => {
        await hooks.beforeFirstWrite("preproduction");
        throw new AppError("mirror.bundle_fetch_failed", {});
      });
      const handle = await started();
      fake.approve(JOINED);
      expect((await post("adopt", { handle })).status).toBe(502);
      const record = await operations.read();
      expect(record).toMatchObject({ kind: "adopt", phase: "venue_committed" });
      expect(record?.data).toEqual({ environment: "preproduction" });

      expect(await refusal(await post("adopt", { handle }))).toEqual({
        status: 409,
        code: "setup.adopt_incomplete",
      });
      expect(adoptJoined).toHaveBeenCalledOnce();

      const reset = await post("reset-incomplete-adopt");
      expect(reset.status).toBe(202);
      expect(await reset.json()).toEqual({ resetStaged: true, restarting: true });
      expect(stageReset).toHaveBeenCalledWith(record?.id);
      await vi.advanceTimersByTimeAsync(0);
      expect(requestRestart).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers a stopped join's resend the same whether its body is empty or {}", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-setup-join-adopt-"));
    try {
      const operations = createSetupOperationStore(dir);
      const { adoptJoined } = mountAdopt({ operations });
      adoptJoined.mockImplementationOnce(async (_joined, hooks) => {
        await hooks.beforeFirstWrite("preproduction");
        throw new AppError("mirror.bundle_fetch_failed", {});
      });
      const handle = await started();
      fake.approve(JOINED);
      expect((await post("adopt", { handle })).status).toBe(502);

      const resends = [
        await post("adopt", { handle, body: "{}" }),
        await post("adopt", { handle }),
      ];
      expect(await Promise.all(resends.map(refusal))).toEqual([
        { status: 409, code: "setup.adopt_incomplete" },
        { status: 409, code: "setup.adopt_incomplete" },
      ]);
      expect(adoptJoined).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
