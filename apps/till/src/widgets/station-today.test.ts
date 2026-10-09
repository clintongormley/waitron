import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import type { TillStationToday } from "./station-today.js";
import type { TillStationTodayDialog } from "./station-today-dialog.js";
import "./station-today.js";
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
const station = {
  id: "grill",
  name: "Grill",
  isDefault: false,
  active: true,
  open: true,
  byHand: null,
  sendsTo: null,
  why: "open",
} as const;
const destinations = [
  { id: "pass", name: "Pass", isDefault: true },
  { id: "bar", name: "Bar", isDefault: false },
];
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function refused(code: string, params: object = {}) {
  return json({ error: { code, params } }, 403);
}
async function mount(
  props: Partial<TillStationToday> = {},
  reply: (path: string, init: RequestInit) => Response | Promise<Response> = () =>
    json({ destinations }),
) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
    calls.push({
      path: String(path),
      method: init!.method!,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return reply(String(path), init!);
  });
  const { el } = await mountWidget<TillStationToday>("till-station-today", {
    api: new TillApi("", fetcher),
    station,
    stations: destinations,
    ...props,
  });
  expect(el.shadowRoot, "the station status widget renders").not.toBeNull();
  return { el, calls };
}
async function dialog(el: TillStationToday) {
  await expect.poll(() => el.shadowRoot!.querySelector("till-station-today-dialog")).not.toBeNull();
  const d = el.shadowRoot!.querySelector<TillStationTodayDialog>("till-station-today-dialog")!;
  await d.updateComplete;
  return d;
}
function act(el: TillStationToday) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
}
function confirm(d: TillStationTodayDialog) {
  d.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
}
it.each([
  ["open", {}, "Open", "Close for today"],
  ["opened by hand", { byHand: "open" }, "Opened for today.", "Close for today"],
  [
    "closed by hand",
    { open: false, byHand: "closed", why: "closed_by_hand", sendsTo: "bar" },
    "Closed for today. New dishes go to Bar.",
    "Open for today",
  ],
  [
    "outside hours",
    { open: false, why: "out_of_hours", sendsTo: "bar" },
    "Closed now (outside its hours). New dishes go to Bar.",
    "Open for today",
  ],
  [
    "outside hours without a destination",
    { open: false, why: "out_of_hours" },
    "Closed now (outside its hours).",
    "Open for today",
  ],
  ["default", { isDefault: true }, "Always open: this is the default station.", null],
  ["switched off", { active: false, open: false, why: "switched_off" }, "Switched off.", null],
])("shows the %s state and the permitted action", async (_name, changes, line, action) => {
  const { el } = await mount({
    station: { ...station, ...changes } as TillStationToday["station"],
  });
  expect(el.shadowRoot!.querySelector("[data-status]")!.textContent!.trim()).toBe(line);
  expect(el.shadowRoot!.querySelector("[data-action]")?.textContent!.trim() ?? null).toBe(action);
});
it("reads destinations and closes with the default, then reports the completed write", async () => {
  const { el, calls } = await mount({}, (_path, init) =>
    init.method === "PUT" ? new Response(null, { status: 204 }) : json({ destinations }),
  );
  const heard: unknown[] = [];
  el.addEventListener("station-today-changed", (e) => heard.push((e as CustomEvent).detail));
  act(el);
  const d = await dialog(el);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-action]")!.variant,
  ).toBe("secondary");
  confirm(d);
  await expect.poll(() => heard).toEqual([{ stationId: "grill" }]);
  expect(calls).toEqual([
    { path: "/api/stations/grill/today", method: "GET", body: null },
    {
      path: "/api/stations/grill/today",
      method: "PUT",
      body: { state: "closed", sendsToStationId: "pass" },
    },
  ]);
  expect(el.shadowRoot!.querySelector("till-station-today-dialog")).toBeNull();
});
it.each(["closed", "inactive"])(
  "refreshes a %s destination refusal and allows another attempt",
  async (reason) => {
    let reads = 0;
    const { el, calls } = await mount({}, (_path, init) =>
      init.method === "PUT"
        ? refused("station.destination_invalid", { reason })
        : json({ destinations: ++reads === 1 ? destinations : [destinations[0]] }),
    );
    act(el);
    const d = await dialog(el);
    d.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "bar" } }),
    );
    await d.updateComplete;
    confirm(d);
    await expect.poll(() => reads).toBe(2);
    await el.updateComplete;
    await d.updateComplete;
    expect(d.shadowRoot!.querySelector("wt-combobox")!.value).toBe("pass");
    expect(d.shadowRoot!.querySelector("wt-combobox")!.error).toBe(
      "That station cannot take the work now. Choose another.",
    );
    confirm(d);
    await expect.poll(() => calls.filter((c) => c.method === "PUT").length).toBe(2);
    expect(calls.at(-1)!.body).toEqual({ state: "closed", sendsToStationId: "pass" });
  },
);
it.each(["pin.invalid", "pin.throttled"])(
  "asks a manager and retains the PIN step after %s",
  async (pinCode) => {
    let writes = 0;
    const { el, calls } = await mount(
      {
        station: {
          ...station,
          open: false,
          byHand: "closed",
          why: "closed_by_hand",
          sendsTo: "pass",
        },
      },
      (path, init) => {
        if (path === "/api/service-day/authorizers")
          return json([{ personId: "manager", displayName: "Ana" }]);
        if (init.method === "PUT")
          return ++writes === 1
            ? refused("authorization.not_permitted")
            : writes === 2
              ? refused(pinCode)
              : new Response(null, { status: 204 });
        return json({ destinations });
      },
    );
    let changed = 0;
    el.addEventListener("station-today-changed", () => changed++);
    act(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
      .not.toBeNull();
    const override = el.shadowRoot!.querySelector("till-supervisor-override-dialog")!;
    await override.updateComplete;
    expect(override.approverRole).toBe("manager");
    expect(override.authorizers).toEqual([{ personId: "manager", displayName: "Ana" }]);
    override.shadowRoot!.querySelector<HTMLElement>("[data-person=manager]")!.click();
    await override.updateComplete;
    const enterPin = async (pin: string) => {
      const pad = override.shadowRoot!.querySelector("till-numeric-pad")!;
      for (const digit of pin) {
        pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!.click();
        await override.updateComplete;
        await pad.updateComplete;
      }
      override.shadowRoot!.querySelector<HTMLElement>(".authorize")!.click();
    };
    await enterPin("1234");
    await expect.poll(() => override.error).toBe(pinCode);
    expect(changed).toBe(0);
    await override.updateComplete;
    expect(override.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
      pinCode === "pin.invalid" ? "Wrong PIN" : "Too many",
    );
    await enterPin("5678");
    await expect.poll(() => changed).toBe(1);
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.body)).toEqual([
      { state: "open" },
      { state: "open", override: { personId: "manager", pin: "1234" } },
      { state: "open", override: { personId: "manager", pin: "5678" } },
    ]);
  },
);
it("closing also retries its chosen destination with manager approval", async () => {
  let writes = 0;
  const { el, calls } = await mount({}, (path, init) =>
    path.endsWith("authorizers")
      ? json([{ personId: "manager", displayName: "Ana" }])
      : init.method === "PUT"
        ? ++writes === 1
          ? refused("authorization.not_permitted")
          : new Response(null, { status: 204 })
        : json({ destinations }),
  );
  act(el);
  const d = await dialog(el);
  confirm(d);
  await expect
    .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
    .not.toBeNull();
  el.shadowRoot!.querySelector("till-supervisor-override-dialog")!.dispatchEvent(
    new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "1234" } }),
  );
  await expect.poll(() => writes).toBe(2);
  expect(calls.at(-1)!.body).toEqual({
    state: "closed",
    sendsToStationId: "pass",
    override: { personId: "manager", pin: "1234" },
  });
});
it("a failed read shows a localized refusal and leaves the action ready to retry", async () => {
  const { el } = await mount({}, () => refused("time_zone.unreadable"));
  act(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toContain("The venue's clock cannot be read");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-action]")!.disabled,
  ).toBe(false);
});
it.each(["disconnect", "station switch"])(
  "ignores a late destination read after %s",
  async (mode) => {
    let resolve!: (reply: Response) => void;
    const promise = new Promise<Response>((r) => (resolve = r));
    const { el } = await mount({}, () => promise);
    act(el);
    if (mode === "disconnect") el.remove();
    else {
      el.station = { ...station, id: "bar", name: "Bar" };
      await el.updateComplete;
    }
    resolve(json({ destinations }));
    await promise;
    await el.updateComplete;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(el.shadowRoot!.querySelector("till-station-today-dialog")).toBeNull();
  },
);

it("duplicate action presses share one read and a removed widget cannot report a late write", async () => {
  let resolveRead!: (reply: Response) => void;
  let resolveWrite!: (reply: Response) => void;
  const read = new Promise<Response>((r) => (resolveRead = r));
  const write = new Promise<Response>((r) => (resolveWrite = r));
  const { el, calls } = await mount({}, (_path, init) => (init.method === "PUT" ? write : read));
  let changed = 0;
  el.addEventListener("station-today-changed", () => changed++);
  act(el);
  act(el);
  expect(calls.length).toBe(1);
  resolveRead(json({ destinations }));
  const d = await dialog(el);
  confirm(d);
  confirm(d);
  expect(calls.length).toBe(2);
  el.remove();
  resolveWrite(new Response(null, { status: 204 }));
  await write;
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  expect(changed).toBe(0);
});
it("cancelling manager approval returns to the destination draft without another write", async () => {
  const { el, calls } = await mount({}, (path, init) =>
    path.endsWith("authorizers")
      ? json([{ personId: "manager", displayName: "Ana" }])
      : init.method === "PUT"
        ? refused("authorization.not_permitted")
        : json({ destinations }),
  );
  act(el);
  const d = await dialog(el);
  d.selected = "bar";
  await d.updateComplete;
  confirm(d);
  await expect
    .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
    .not.toBeNull();
  el.shadowRoot!.querySelector("till-supervisor-override-dialog")!.dispatchEvent(
    new CustomEvent("override-cancel"),
  );
  await el.updateComplete;
  await d.updateComplete;
  expect(el.shadowRoot!.querySelector("till-supervisor-override-dialog")).toBeNull();
  expect(d.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
  expect(d.busy).toBe(false);
  expect(calls.filter((c) => c.method === "PUT").length).toBe(1);
});
it("an authorizer read failure returns a localized refusal without hiding the close draft", async () => {
  const { el } = await mount({}, (path, init) =>
    path.endsWith("authorizers")
      ? refused("time_zone.unreadable")
      : init.method === "PUT"
        ? refused("authorization.not_permitted")
        : json({ destinations }),
  );
  act(el);
  const d = await dialog(el);
  confirm(d);
  await expect.poll(() => d.refusal).toBe("time_zone.unreadable");
  expect(d.busy).toBe(false);
  expect(d.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
    "The venue's clock cannot be read",
  );
});

const managers = [{ personId: "manager", displayName: "Ana" }];
async function pinStep(el: TillStationToday) {
  await expect
    .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
    .not.toBeNull();
  const pin = el.shadowRoot!.querySelector("till-supervisor-override-dialog")!;
  await pin.updateComplete;
  expect(pin.authorizers).toEqual(managers);
  return pin;
}
it.each(["open", "closed"] as const)(
  "device %s requires a manager before its first write",
  async (state) => {
    const { el, calls } = await mount(
      { deviceMode: true, station: { ...station, open: state === "closed" } },
      (_path, init) =>
        init.method === "PUT"
          ? new Response(null, { status: 204 })
          : json({ destinations, authorizers: managers }),
    );
    let changed = 0;
    el.addEventListener("station-today-changed", () => changed++);
    act(el);
    if (state === "closed") confirm(await dialog(el));
    const pin = await pinStep(el);
    expect(calls).toEqual([
      { path: "/api/device/stations/grill/today", method: "GET", body: null },
    ]);
    pin.dispatchEvent(
      new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "1234" } }),
    );
    await expect.poll(() => changed).toBe(1);
    expect(calls.at(-1)).toEqual({
      path: "/api/device/stations/grill/today",
      method: "PUT",
      body: {
        state,
        ...(state === "closed" ? { sendsToStationId: "pass" } : {}),
        authorizer: { personId: "manager", pin: "1234" },
      },
    });
  },
);
it.each(["pin.invalid", "pin.throttled"])(
  "device retains its PIN and destination after %s",
  async (code) => {
    let writes = 0;
    const { el, calls } = await mount({ deviceMode: true }, (_path, init) =>
      init.method === "PUT"
        ? ++writes === 1
          ? refused(code)
          : new Response(null, { status: 204 })
        : json({ destinations, authorizers: managers }),
    );
    act(el);
    const close = await dialog(el);
    close
      .shadowRoot!.querySelector("wt-combobox")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
    await close.updateComplete;
    confirm(close);
    const pin = await pinStep(el);
    pin.dispatchEvent(
      new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "1234" } }),
    );
    await expect.poll(() => pin.error).toBe(code);
    expect(el.shadowRoot!.querySelector("till-station-today-dialog")).toBe(close);
    expect(close.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
    pin.dispatchEvent(
      new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "5678" } }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
      .toBeNull();
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.body)).toEqual([
      {
        state: "closed",
        sendsToStationId: "bar",
        authorizer: { personId: "manager", pin: "1234" },
      },
      {
        state: "closed",
        sendsToStationId: "bar",
        authorizer: { personId: "manager", pin: "5678" },
      },
    ]);
  },
);
it("device forbidden-station read shows its sentence and permits retry", async () => {
  const { el, calls } = await mount({ deviceMode: true }, () =>
    refused("device.forbidden_station"),
  );
  act(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toContain("This device cannot use that station");
  expect(calls[0]!.path).toBe("/api/device/stations/grill/today");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-action]")!.disabled,
  ).toBe(false);
});
it("cancelling a device opening PIN writes nothing and the next press asks again", async () => {
  const { el, calls } = await mount(
    { deviceMode: true, station: { ...station, open: false } },
    () => json({ destinations, authorizers: managers }),
  );
  act(el);
  (await pinStep(el)).dispatchEvent(new CustomEvent("override-cancel"));
  await el.updateComplete;
  expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  act(el);
  await pinStep(el);
  expect(calls.map((c) => c.path)).toEqual([
    "/api/device/stations/grill/today",
    "/api/device/stations/grill/today",
  ]);
});

it("device refreshes refused destinations through its own route and asks for a fresh PIN", async () => {
  let reads = 0;
  const { el, calls } = await mount({ deviceMode: true }, (_path, init) =>
    init.method === "PUT"
      ? refused("station.destination_invalid")
      : json({
          destinations: ++reads === 1 ? destinations : [destinations[0]],
          authorizers: managers,
        }),
  );
  act(el);
  const close = await dialog(el);
  close
    .shadowRoot!.querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
  await close.updateComplete;
  confirm(close);
  (await pinStep(el)).dispatchEvent(
    new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "1234" } }),
  );
  await expect.poll(() => reads).toBe(2);
  await close.updateComplete;
  expect(close.shadowRoot!.querySelector("wt-combobox")!.value).toBe("pass");
  expect(close.refusal).toBe("station.destination_invalid");
  confirm(close);
  await pinStep(el);
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  expect(calls.map((c) => c.path)).toEqual([
    "/api/device/stations/grill/today",
    "/api/device/stations/grill/today",
    "/api/device/stations/grill/today",
  ]);
});
it.each(["disconnect", "station switch"])(
  "device opening ignores a late manager read after %s",
  async (mode) => {
    let resolve!: (reply: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    const { el, calls } = await mount(
      { deviceMode: true, station: { ...station, open: false } },
      () => pending,
    );
    act(el);
    if (mode === "disconnect") el.remove();
    else {
      el.station = { ...station, id: "bar" };
      await el.updateComplete;
    }
    resolve(json({ destinations, authorizers: managers }));
    await pending;
    await el.updateComplete;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(el.shadowRoot!.querySelector("till-supervisor-override-dialog")).toBeNull();
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  },
);

it("device permission refusal refreshes its managers without a session request", async () => {
  let reads = 0;
  const newManager = [{ personId: "other", displayName: "Luis" }];
  const { el, calls } = await mount(
    { deviceMode: true, station: { ...station, open: false } },
    (path, init) =>
      path === "/api/service-day/authorizers"
        ? json(newManager)
        : init.method === "PUT"
          ? refused("authorization.not_permitted")
          : json({ destinations, authorizers: ++reads === 1 ? managers : newManager }),
  );
  act(el);
  (await pinStep(el)).dispatchEvent(
    new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "1234" } }),
  );
  await expect
    .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog")?.authorizers)
    .toEqual(newManager);
  expect(calls.map((c) => c.path)).toEqual([
    "/api/device/stations/grill/today",
    "/api/device/stations/grill/today",
    "/api/device/stations/grill/today",
  ]);
});

it.each(["answer", "refusal"])(
  "ignores an old %s after reconnecting the same widget",
  async (reply) => {
    let finish!: (response: Response) => void;
    let count = 0;
    const { el, calls } = await mount({}, () =>
      ++count === 1 ? new Promise((resolve) => (finish = resolve)) : json({ destinations }),
    );
    const read = vi.spyOn(el.api!, "stationToday");
    act(el);
    await expect.poll(() => typeof finish).toBe("function");
    const parent = el.parentElement!;
    el.remove();
    parent.append(el);
    await el.updateComplete;
    finish(reply === "answer" ? json({ destinations }) : refused("time_zone.unreadable"));
    await Promise.allSettled([read.mock.results[0]!.value]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-station-today-dialog")).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    act(el);
    await dialog(el);
    expect(calls).toHaveLength(2);
  },
);
