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
