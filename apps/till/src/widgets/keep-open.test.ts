import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import type { TillKeepOpen } from "./keep-open.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open.js";
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
const subject = {
  periodId: "lunch",
  periodName: "Lunch",
  endsAt: "14:00",
  running: true,
  extendedUntil: null,
};
const period = {
  id: "lunch",
  name: "Lunch",
  endsAt: "14:00",
  running: true,
  extendedUntil: null,
  dayEndsAt: "05:00",
  choices: ["14:15", "14:30", "05:00"],
  next: null,
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function refusal(code: string, params: object = {}) {
  return json({ error: { code, params } }, 403);
}
async function mount(
  props: Partial<TillKeepOpen> = {},
  reply: (path: string, init: RequestInit) => Response | Promise<Response> = (_p, i) =>
    i.method === "PUT" ? new Response(null, { status: 204 }) : json({ period }),
) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (p: string | URL | Request, i?: RequestInit) => {
    calls.push({
      path: String(p),
      method: i!.method!,
      body: i?.body ? JSON.parse(String(i.body)) : null,
    });
    return reply(String(p), i!);
  });
  const { el } = await mountWidget<TillKeepOpen>("till-keep-open", {
    api: new TillApi("", fetcher),
    zoneId: "zone /1",
    keepOpen: subject,
    ...props,
  });
  expect(el.shadowRoot, "the keep-open flow renders").not.toBeNull();
  return { el, calls };
}
function act(el: TillKeepOpen) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
}
async function dialog(el: TillKeepOpen) {
  await expect.poll(() => el.shadowRoot!.querySelector("till-keep-open-dialog")).not.toBeNull();
  const d = el.shadowRoot!.querySelector<TillKeepOpenDialog>("till-keep-open-dialog")!;
  await d.updateComplete;
  return d;
}
async function save(d: TillKeepOpenDialog) {
  d.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "14:30" } }),
  );
  await d.updateComplete;
  d.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
}
it("omits the control when no period can be kept open", async () => {
  const { el, calls } = await mount({ keepOpen: null });
  expect(el.shadowRoot!.querySelector("wt-button")).toBeNull();
  expect(calls).toEqual([]);
});
it("opens with a quiet button and writes the chosen period and endpoint through the real API", async () => {
  const { el, calls } = await mount();
  const b = el.shadowRoot!.querySelector("wt-button")!;
  expect([b.variant, b.textContent!.trim()]).toEqual(["secondary", "Keep Lunch open later"]);
  const events: unknown[] = [];
  el.addEventListener("keep-open-changed", (e) => events.push((e as CustomEvent).detail));
  act(el);
  const d = await dialog(el);
  await save(d);
  await expect.poll(() => events).toEqual([{ zoneId: "zone /1" }]);
  expect(calls).toEqual([
    { path: "/api/service-zones/zone%20%2F1/keep-open", method: "GET", body: null },
    {
      path: "/api/service-zones/zone%20%2F1/period-extension",
      method: "PUT",
      body: { periodId: "lunch", until: "14:30" },
    },
  ]);
  expect(el.shadowRoot!.querySelector("till-keep-open-dialog")).toBeNull();
});
it("ends the extension with a null endpoint", async () => {
  const { el, calls } = await mount(
    { keepOpen: { ...subject, extendedUntil: "14:30" } },
    (_p, i) =>
      i.method === "PUT"
        ? new Response(null, { status: 204 })
        : json({ period: { ...period, extendedUntil: "14:30" } }),
  );
  act(el);
  const d = await dialog(el);
  d.shadowRoot!.querySelector<HTMLElement>("[data-stop]")!.click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls.at(-1)!.body).toEqual({ periodId: "lunch", until: null });
});
it.each(["period_extension.invalid", "period_extension.not_allowed"])(
  "refreshes choices after %s and retains the write refusal if that read fails",
  async (code) => {
    let reads = 0;
    const { el, calls } = await mount({}, (_p, i) =>
      i.method === "PUT"
        ? refusal(code, { field: "until" })
        : ++reads === 1
          ? json({ period })
          : refusal("time_zone.unreadable"),
    );
    act(el);
    const d = await dialog(el);
    await save(d);
    await expect.poll(() => reads).toBe(2);
    await el.updateComplete;
    await d.updateComplete;
    expect(d.refusal).toBe(code);
    expect(d.refusalField).toBe("until");
    expect(d.shadowRoot!.querySelector("wt-combobox")!.value).toBe("14:30");
    d.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await expect.poll(() => calls.filter((c) => c.method === "PUT").length).toBe(2);
  },
);
it("a changed subject refreshes the editor without keeping an invalid old endpoint", async () => {
  let reads = 0;
  const { el } = await mount({}, (_p, i) =>
    i.method === "PUT"
      ? refusal("period_extension.not_allowed")
      : json({
          period:
            ++reads === 1
              ? period
              : { ...period, id: "dinner", name: "Dinner", choices: ["20:15", "05:00"] },
        }),
  );
  act(el);
  const d = await dialog(el);
  await save(d);
  await expect.poll(() => reads).toBe(2);
  await el.updateComplete;
  await d.updateComplete;
  expect(d.period!.id).toBe("dinner");
  expect(d.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
});
it.each(["pin.invalid", "pin.throttled"])(
  "retries the selected endpoint with a manager and keeps the PIN dialog after %s",
  async (code) => {
    let writes = 0;
    const { el, calls } = await mount({}, (p, i) =>
      p.endsWith("authorizers")
        ? json([{ personId: "ana", displayName: "Ana" }])
        : i.method === "PUT"
          ? ++writes === 1
            ? refusal("authorization.not_permitted")
            : writes === 2
              ? refusal(code)
              : new Response(null, { status: 204 })
          : json({ period }),
    );
    act(el);
    const d = await dialog(el);
    await save(d);
    await expect
      .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
      .not.toBeNull();
    const pin = el.shadowRoot!.querySelector("till-supervisor-override-dialog")!;
    await pin.updateComplete;
    expect(pin.approverRole).toBe("manager");
    expect(pin.authorizers).toEqual([{ personId: "ana", displayName: "Ana" }]);
    pin.dispatchEvent(
      new CustomEvent("override-confirm", { detail: { personId: "ana", pin: "1234" } }),
    );
    await expect.poll(() => pin.error).toBe(code);
    expect(el.shadowRoot!.querySelector("till-keep-open-dialog")).toBe(d);
    pin.dispatchEvent(
      new CustomEvent("override-confirm", { detail: { personId: "ana", pin: "5678" } }),
    );
    await expect.poll(() => el.shadowRoot!.querySelector("till-keep-open-dialog")).toBeNull();
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.body)).toEqual([
      { periodId: "lunch", until: "14:30" },
      { periodId: "lunch", until: "14:30", override: { personId: "ana", pin: "1234" } },
      { periodId: "lunch", until: "14:30", override: { personId: "ana", pin: "5678" } },
    ]);
  },
);
it("cancelling the PIN leaves the selected endpoint ready for retry", async () => {
  const { el } = await mount({}, (p, i) =>
    p.endsWith("authorizers")
      ? json([])
      : i.method === "PUT"
        ? refusal("authorization.not_permitted")
        : json({ period }),
  );
  act(el);
  const d = await dialog(el);
  await save(d);
  await expect
    .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
    .not.toBeNull();
  el.shadowRoot!.querySelector("till-supervisor-override-dialog")!.dispatchEvent(
    new CustomEvent("override-cancel"),
  );
  await el.updateComplete;
  await d.updateComplete;
  expect(d.busy).toBe(false);
  expect(d.shadowRoot!.querySelector("wt-combobox")!.value).toBe("14:30");
});
it("a failed initial read shows its sentence and can be retried", async () => {
  const { el, calls } = await mount({}, () => refusal("time_zone.unreadable"));
  act(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toContain("The venue's clock cannot be read");
  act(el);
  await expect.poll(() => calls.length).toBe(2);
});
it("a null read opens no editor", async () => {
  const { el } = await mount({}, () => json({ period: null }));
  act(el);
  await expect.poll(() => el.shadowRoot!.querySelector("wt-button")!.disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("till-keep-open-dialog")).toBeNull();
});
it.each(["disconnect", "zone", "period"])(
  "ignores a read that finishes after %s changes",
  async (change) => {
    let finish!: (r: Response) => void;
    const { el } = await mount({}, () => new Promise((r) => (finish = r)));
    const read = vi.spyOn(el.api!, "keepOpen");
    act(el);
    await expect.poll(() => typeof finish).toBe("function");
    if (change === "disconnect") el.remove();
    else if (change === "zone") el.zoneId = "other";
    else el.keepOpen = { ...subject, periodId: "dinner" };
    await el.updateComplete;
    finish(json({ period }));
    await read.mock.results[0]!.value;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-keep-open-dialog")).toBeNull();
  },
);
it("ignores a completed write after disconnect and prevents double submission", async () => {
  let finish!: (r: Response) => void;
  const { el, calls } = await mount({}, (_p, i) =>
    i.method === "PUT" ? new Promise((r) => (finish = r)) : json({ period }),
  );
  const write = vi.spyOn(el.api!, "keepPeriodOpen");
  act(el);
  const d = await dialog(el);
  await save(d);
  d.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  let changed = 0;
  el.addEventListener("keep-open-changed", () => changed++);
  el.remove();
  finish(new Response(null, { status: 204 }));
  await write.mock.results[0]!.value;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(changed).toBe(0);
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
});
it("a manager read finishing after the zone changes cannot reopen the old PIN step", async () => {
  let finish!: (r: Response) => void;
  const { el } = await mount({}, (path, init) =>
    path.endsWith("authorizers")
      ? new Promise((resolve) => (finish = resolve))
      : init.method === "PUT"
        ? refusal("authorization.not_permitted")
        : json({ period }),
  );
  const read = vi.spyOn(el.api!, "serviceDayAuthorizers");
  act(el);
  const d = await dialog(el);
  await save(d);
  await expect.poll(() => typeof finish).toBe("function");
  el.zoneId = "another";
  await el.updateComplete;
  finish(json([{ personId: "ana", displayName: "Ana" }]));
  await read.mock.results[0]!.value;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-supervisor-override-dialog")).toBeNull();
});
it("manager approval retains a null endpoint when ending the extension", async () => {
  let writes = 0;
  const { el, calls } = await mount({}, (path, init) =>
    path.endsWith("authorizers")
      ? json([{ personId: "ana", displayName: "Ana" }])
      : init.method === "PUT"
        ? ++writes === 1
          ? refusal("authorization.not_permitted")
          : new Response(null, { status: 204 })
        : json({ period: { ...period, extendedUntil: "14:30" } }),
  );
  act(el);
  const d = await dialog(el);
  d.shadowRoot!.querySelector<HTMLElement>("[data-stop]")!.click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
    .not.toBeNull();
  el.shadowRoot!.querySelector("till-supervisor-override-dialog")!.dispatchEvent(
    new CustomEvent("override-confirm", { detail: { personId: "ana", pin: "1234" } }),
  );
  await expect.poll(() => writes).toBe(2);
  expect(calls.at(-1)!.body).toEqual({
    periodId: "lunch",
    until: null,
    override: { personId: "ana", pin: "1234" },
  });
});

it.each(["answer", "refusal"])(
  "ignores an old %s after reconnecting the same widget",
  async (reply) => {
    let finish!: (response: Response) => void;
    let count = 0;
    const { el, calls } = await mount({}, () =>
      ++count === 1 ? new Promise((resolve) => (finish = resolve)) : json({ period }),
    );
    const read = vi.spyOn(el.api!, "keepOpen");
    act(el);
    await expect.poll(() => typeof finish).toBe("function");
    const parent = el.parentElement!;
    el.remove();
    parent.append(el);
    await el.updateComplete;
    finish(reply === "answer" ? json({ period }) : refusal("time_zone.unreadable"));
    await Promise.allSettled([read.mock.results[0]!.value]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-keep-open-dialog")).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    act(el);
    await dialog(el);
    expect(calls).toHaveLength(2);
  },
);
