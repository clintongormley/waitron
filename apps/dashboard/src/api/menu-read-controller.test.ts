import { afterEach, expect, it, vi } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { DashboardApi, type MenuReadResult } from "./client.js";
import { MenuReadController } from "./menu-read-controller.js";

const controllers: MenuReadController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.release();
  vi.useRealTimers();
});

function setup() {
  let columns = 3;
  let refusal = false;
  const requests: Array<{ path: string; passive: boolean }> = [];
  const values: MenuReadResult[] = [];
  const errors: unknown[] = [];
  const api = new DashboardApi("", async (path, init) => {
    requests.push({ path, passive: new Headers(init.headers).get("x-waitron-live") === "1" });
    if (refusal) throw new Error("network offline");
    return Response.json({ home: { status: 200, body: { handheld: { columns } } } });
  });
  const hosts: ReactiveController[] = [];
  const host = {
    addController: (value: ReactiveController) => hosts.push(value),
  } as unknown as ReactiveControllerHost;
  const controller = new MenuReadController(
    host,
    () => api,
    (error) => errors.push(error),
  );
  controllers.push(controller);
  return {
    api,
    controller,
    hosts,
    requests,
    values,
    errors,
    columns: (value: number) => {
      columns = value;
    },
    refusal: (value: boolean) => {
      refusal = value;
    },
  };
}

it("keeps one shared menu watch when its tabs ask for the same selected parts", async () => {
  const s = setup();
  await s.controller.watch("lunch", ["structure", "home", "status"], (value) =>
    s.values.push(value),
  );
  await s.controller.watch("lunch", ["structure", "home", "status"], (value) =>
    s.values.push(value),
  );
  expect(s.requests).toEqual([
    {
      path: "/management-api/catalogues/lunch/read?part=structure&part=home&part=status",
      passive: false,
    },
  ]);
  expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 3 } } } });
});

it("shares the save refresh with an arriving notification, but still reads later remote changes", async () => {
  vi.useFakeTimers();
  const s = setup();
  const initial = s.controller.watch("lunch", ["home"], (value) => s.values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  s.columns(5);
  const refresh = s.controller.refresh();
  await vi.advanceTimersByTimeAsync(50);
  expect(s.requests).toHaveLength(1);
  s.api.liveData.invalidate([{ type: "menu_details" }]);
  await vi.advanceTimersByTimeAsync(0);
  await refresh;
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.requests).toHaveLength(2);
  expect(s.requests[1]!.passive).toBe(true);
  expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } });
  s.columns(6);
  s.api.liveData.invalidate([{ type: "menu_details" }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(s.requests).toHaveLength(3);
  await vi.waitFor(() =>
    expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 6 } } } }),
  );
});

it("reads back a successful save when the stream is silent", async () => {
  vi.useFakeTimers();
  const s = setup();
  const initial = s.controller.watch("lunch", ["home"], (value) => s.values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  s.columns(5);
  const refresh = s.controller.refresh();
  await vi.advanceTimersByTimeAsync(100);
  await refresh;
  expect(s.requests).toHaveLength(2);
  expect(s.requests[1]!.passive).toBe(true);
  expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } });
});

it("settles a refused refresh and recovers when a later read succeeds", async () => {
  vi.useFakeTimers();
  const s = setup();
  const initial = s.controller.watch("lunch", ["home"], (value) => s.values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  s.refusal(true);
  const refresh = s.controller.refresh();
  await vi.advanceTimersByTimeAsync(100);
  await refresh;
  expect(s.errors).toEqual([{ code: "connection.failed" }]);
  expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 3 } } } });
  s.refusal(false);
  s.columns(5);
  s.api.liveData.invalidate([{ type: "menu_details" }]);
  await vi.waitFor(() =>
    expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } }),
  );
});

it.each(["release", "disconnect"] as const)(
  "cancels the pending refresh and further reads on %s",
  async (action) => {
    vi.useFakeTimers();
    const s = setup();
    const initial = s.controller.watch("lunch", ["home"], (value) => s.values.push(value));
    await vi.advanceTimersByTimeAsync(0);
    await initial;
    const refresh = s.controller.refresh();
    if (action === "release") s.controller.release();
    else for (const host of s.hosts) host.hostDisconnected?.();
    await refresh;
    s.api.liveData.invalidate([{ type: "menu_details" }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.requests).toHaveLength(1);
  },
);

it("drops the old menu's pending refresh when another menu is opened", async () => {
  vi.useFakeTimers();
  const s = setup();
  const initial = s.controller.watch("lunch", ["home"], (value) => s.values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  const refresh = s.controller.refresh();
  const next = s.controller.watch("dinner", ["home"], (value) => s.values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await Promise.all([refresh, next]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.requests.map(({ path }) => path)).toEqual([
    "/management-api/catalogues/lunch/read?part=home",
    "/management-api/catalogues/dinner/read?part=home",
  ]);
});

it("does not count a read already in flight as the save's refresh", async () => {
  vi.useFakeTimers();
  const answers: Array<(response: Response) => void> = [];
  const api = new DashboardApi("", () => new Promise<Response>((resolve) => answers.push(resolve)));
  const values: MenuReadResult[] = [];
  const host = { addController: () => {} } as unknown as ReactiveControllerHost;
  const controller = new MenuReadController(
    host,
    () => api,
    () => {},
  );
  controllers.push(controller);
  const initial = controller.watch("lunch", ["home"], (value) => values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  expect(answers).toHaveLength(1);
  let refreshed = false;
  const refresh = controller.refresh().then(() => {
    refreshed = true;
  });
  answers[0]!(Response.json({ home: { status: 200, body: { handheld: { columns: 3 } } } }));
  await initial;
  expect(refreshed).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(answers).toHaveLength(2);
  answers[1]!(Response.json({ home: { status: 200, body: { handheld: { columns: 5 } } } }));
  await refresh;
  expect(values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } });
});

it("retains an invalidation arriving during the refresh's read", async () => {
  vi.useFakeTimers();
  let second!: (response: Response) => void;
  let reads = 0;
  const api = new DashboardApi("", async () => {
    reads++;
    if (reads === 2)
      return new Promise<Response>((resolve) => {
        second = resolve;
      });
    return Response.json({
      home: { status: 200, body: { handheld: { columns: reads === 1 ? 3 : 6 } } },
    });
  });
  const values: MenuReadResult[] = [];
  const host = { addController: () => {} } as unknown as ReactiveControllerHost;
  const controller = new MenuReadController(
    host,
    () => api,
    () => {},
  );
  controllers.push(controller);
  const initial = controller.watch("lunch", ["home"], (value) => values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  const refresh = controller.refresh();
  await vi.advanceTimersByTimeAsync(100);
  expect(reads).toBe(2);
  api.liveData.invalidate([{ type: "menu_details" }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(2);
  second(Response.json({ home: { status: 200, body: { handheld: { columns: 5 } } } }));
  await refresh;
  await vi.waitFor(() =>
    expect(values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 6 } } } }),
  );
  expect(reads).toBe(3);
});

it("keeps waiting for a refresh requested after an earlier read started and then refused", async () => {
  vi.useFakeTimers();
  const answers: Array<(response: Response) => void> = [];
  const api = new DashboardApi("", () => new Promise<Response>((resolve) => answers.push(resolve)));
  const host = { addController: () => {} } as unknown as ReactiveControllerHost;
  const values: MenuReadResult[] = [];
  const errors: unknown[] = [];
  const controller = new MenuReadController(
    host,
    () => api,
    (error) => errors.push(error),
  );
  controllers.push(controller);
  const initial = controller
    .watch("lunch", ["home"], (value) => values.push(value))
    .catch(() => undefined);
  await vi.advanceTimersByTimeAsync(0);
  let refreshed = false;
  const refresh = controller.refresh().then(() => {
    refreshed = true;
  });
  answers[0]!(Response.json({ error: { code: "menu.reset_required" } }, { status: 409 }));
  await initial;
  expect(errors).toEqual([{ code: "menu.reset_required", status: 409 }]);
  expect(refreshed).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  answers[1]!(Response.json({ home: { status: 200, body: { handheld: { columns: 5 } } } }));
  await refresh;
  expect(values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } });
});

it("settles a failed refresh for a second observer sharing the first observer's read", async () => {
  vi.useFakeTimers();
  const s = setup();
  const initial = s.controller.watch("lunch", ["home"], (value) => s.values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  const host = { addController: () => {} } as unknown as ReactiveControllerHost;
  const errors: unknown[] = [];
  const other = new MenuReadController(
    host,
    () => s.api,
    (error) => errors.push(error),
  );
  controllers.push(other);
  const otherValues: MenuReadResult[] = [];
  await other.watch("lunch", ["home"], (value) => otherValues.push(value));
  expect(s.requests).toHaveLength(1);
  s.refusal(true);
  let settled = false;
  void other.refresh().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(100);
  await vi.waitFor(() => expect(errors).toEqual([{ code: "connection.failed" }]));
  expect(settled).toBe(true);
  expect(otherValues.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 3 } } } });
});

it("reads back without a live-data connection", async () => {
  const s = setup();
  Object.defineProperty(s.api, "liveData", { value: undefined });
  await s.controller.watch("lunch", ["home"], (value) => s.values.push(value));
  s.columns(5);
  await s.controller.refresh();
  expect(s.requests).toHaveLength(2);
  expect(s.requests[1]!.passive).toBe(true);
  expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } });
  s.refusal(true);
  await s.controller.refresh();
  expect(s.errors).toEqual([{ code: "connection.failed" }]);
});

it("does not issue a refresh before a menu is selected", async () => {
  const s = setup();
  await s.controller.refresh();
  expect(s.requests).toEqual([]);
});

it("replaces the subscription when the selected tab's parts change", async () => {
  const s = setup();
  await s.controller.watch("lunch", ["structure"], (value) => s.values.push(value));
  await s.controller.watch("lunch", ["structure", "home", "preview"], (value) =>
    s.values.push(value),
  );
  expect(s.requests.map(({ path }) => path)).toEqual([
    "/management-api/catalogues/lunch/read?part=structure",
    "/management-api/catalogues/lunch/read?part=structure&part=home&part=preview",
  ]);
  s.columns(5);
  s.api.liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() =>
    expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } }),
  );
  expect(s.requests.map(({ path }) => path).slice(2)).toEqual([
    "/management-api/catalogues/lunch/read?part=structure&part=home&part=preview",
  ]);
});

it("drops an old menu's late response after a new menu is opened", async () => {
  const answers: Array<(response: Response) => void> = [];
  const api = new DashboardApi("", () => new Promise<Response>((resolve) => answers.push(resolve)));
  const values: MenuReadResult[] = [];
  const host = { addController: () => {} } as unknown as ReactiveControllerHost;
  const controller = new MenuReadController(
    host,
    () => api,
    () => {},
  );
  controllers.push(controller);
  const initial = controller.watch("lunch", ["home"], (value) => values.push(value));
  await vi.waitFor(() => expect(answers).toHaveLength(1));
  const next = controller.watch("dinner", ["home"], (value) => values.push(value));
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  answers[1]!(Response.json({ home: { status: 200, body: { handheld: { columns: 6 } } } }));
  await next;
  answers[0]!(Response.json({ home: { status: 200, body: { handheld: { columns: 3 } } } }));
  await initial;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(values).toEqual([{ home: { status: 200, body: { handheld: { columns: 6 } } } }]);
});

it("does not replay an initial refusal when a shared watch has since recovered", async () => {
  const s = setup();
  s.refusal(true);
  await expect(
    s.controller.watch("lunch", ["home"], (value) => s.values.push(value)),
  ).rejects.toEqual({ code: "connection.failed" });
  s.refusal(false);
  s.columns(5);
  s.api.liveData.invalidate([{ type: "menu_details" }]);
  await vi.waitFor(() =>
    expect(s.values.at(-1)).toEqual({ home: { status: 200, body: { handheld: { columns: 5 } } } }),
  );
  await expect(
    s.controller.watch("lunch", ["home"], (value) => s.values.push(value)),
  ).resolves.toBeUndefined();
  expect(s.requests).toHaveLength(2);
});

it.each([
  { snapshotSequence: 0, snapshotEpoch: "server", wantReads: 3 },
  { snapshotSequence: 1, snapshotEpoch: "server", wantReads: 2 },
  { snapshotSequence: 100, snapshotEpoch: "previous-server", wantReads: 3 },
  { snapshotSequence: 2, snapshotEpoch: "server", wantReads: 2 },
])(
  "checks the earlier snapshot $snapshotEpoch/$snapshotSequence against the completed write",
  async ({ snapshotSequence, snapshotEpoch, wantReads }) => {
    vi.useFakeTimers();
    let sequence = 0;
    let epoch = "server";
    let writesDone!: (response: Response) => void;
    const paths: string[] = [];
    const api = new DashboardApi("", async (path, init) => {
      if (init.method !== "GET")
        return new Promise<Response>((resolve) => {
          writesDone = resolve;
        });
      paths.push(path);
      return Response.json({
        revision: { epoch, sequence },
        home: { status: 200, body: { handheld: { columns: sequence === 0 ? 3 : 5 } } },
      });
    });
    const values: MenuReadResult[] = [];
    const host = { addController: () => {} } as unknown as ReactiveControllerHost;
    const controller = new MenuReadController(
      host,
      () => api,
      () => {},
    );
    controllers.push(controller);
    const initial = controller.watch("lunch", ["home"], (value) => values.push(value));
    await vi.advanceTimersByTimeAsync(0);
    await initial;
    const write = api.setHomeDisplay("lunch", "handheld", { columns: 5 });
    sequence = snapshotSequence;
    epoch = snapshotEpoch;
    api.liveData.invalidate([{ type: "menu_details" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(paths).toHaveLength(2);
    sequence = 1;
    epoch = "server";
    writesDone(
      new Response(null, {
        status: 204,
        headers: { "x-waitron-menu-revision": JSON.stringify({ epoch: "server", sequence: 1 }) },
      }),
    );
    await write;
    const refresh = controller.refresh(true);
    await vi.advanceTimersByTimeAsync(200);
    await refresh;
    expect(paths).toHaveLength(wantReads);
    expect(values.at(-1)).toMatchObject({
      home: { status: 200, body: { handheld: { columns: 5 } } },
    });
    sequence = 2;
    api.liveData.invalidate([{ type: "menu_details" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(paths).toHaveLength(wantReads + 1);
    await vi.waitFor(() =>
      expect(values.at(-1)).toMatchObject({ revision: { epoch: "server", sequence: 2 } }),
    );
  },
);

it("forces a manual refresh even when its snapshot includes the latest successful write", async () => {
  vi.useFakeTimers();
  let columns = 3;
  const values: MenuReadResult[] = [];
  const reads: string[] = [];
  const api = new DashboardApi("", async (path, init) => {
    const revision = { epoch: "server", sequence: 1 };
    if (init.method !== "GET")
      return new Response(null, {
        status: 204,
        headers: { "x-waitron-menu-revision": JSON.stringify(revision) },
      });
    reads.push(path);
    return Response.json({
      revision,
      home: { status: 200, body: { handheld: { columns } } },
    });
  });
  const host = { addController: () => {} } as unknown as ReactiveControllerHost;
  const controller = new MenuReadController(
    host,
    () => api,
    () => {},
  );
  controllers.push(controller);
  const initial = controller.watch("lunch", ["home"], (value) => values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  await api.setHomeDisplay("lunch", "handheld", { columns: 3 });
  await controller.refresh(true);
  expect(reads).toHaveLength(1);
  columns = 5;
  const forced = controller.refresh(false);
  await vi.advanceTimersByTimeAsync(100);
  await forced;
  expect(reads).toHaveLength(2);
  expect(values.at(-1)).toMatchObject({ home: { body: { handheld: { columns: 5 } } } });
});

it("reads the newer save back when an older save response arrives last", async () => {
  vi.useFakeTimers();
  let sequence = 5;
  const answers: Array<(response: Response) => void> = [];
  const reads: string[] = [];
  const values: MenuReadResult[] = [];
  const api = new DashboardApi("", async (path, init) => {
    if (init.method !== "GET") return new Promise<Response>((resolve) => answers.push(resolve));
    reads.push(path);
    return Response.json({
      revision: { epoch: "server", sequence },
      home: { status: 200, body: { handheld: { columns: sequence === 5 ? 3 : 5 } } },
    });
  });
  const host = { addController: () => {} } as unknown as ReactiveControllerHost;
  const controller = new MenuReadController(
    host,
    () => api,
    () => {},
  );
  controllers.push(controller);
  const initial = controller.watch("lunch", ["home"], (value) => values.push(value));
  await vi.advanceTimersByTimeAsync(0);
  await initial;
  const older = api.setHomeDisplay("lunch", "handheld", { columns: 3 });
  const newer = api.setHomeDisplay("lunch", "handheld", { columns: 5 });
  expect(answers).toHaveLength(2);
  answers[1]!(
    new Response(null, {
      status: 204,
      headers: { "x-waitron-menu-revision": JSON.stringify({ epoch: "server", sequence: 6 }) },
    }),
  );
  await newer;
  answers[0]!(
    new Response(null, {
      status: 204,
      headers: { "x-waitron-menu-revision": JSON.stringify({ epoch: "server", sequence: 5 }) },
    }),
  );
  await older;
  sequence = 6;
  const refreshed = controller.refresh(true);
  await vi.advanceTimersByTimeAsync(100);
  await refreshed;
  expect(reads).toHaveLength(2);
  expect(values.at(-1)).toMatchObject({ home: { body: { handheld: { columns: 5 } } } });
});
