import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillKeepOpen } from "./keep-open.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open.js";
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const zone = {
  id: "terrace",
  name: "Terrace",
  endsAt: "22:00",
  running: true,
  extendedUntil: null,
  dayEndsAt: "05:00",
  choices: ["22:15", "22:30"],
  next: null,
};
const summary = {
  zoneId: "terrace",
  zoneName: "Terrace",
  closesAt: "22:00",
  running: true,
  extendedUntil: null,
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function mount(
  reply: (path: string, init: RequestInit) => Response | Promise<Response> = (_p, i) =>
    i.method === "PUT" ? new Response(null, { status: 204 }) : json({ period: null, zone }),
) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const { el } = await mountWidget<TillKeepOpen>("till-keep-open", {
    api: new TillApi(
      "",
      vi.fn(async (p: string | URL | Request, i?: RequestInit) => {
        calls.push({
          path: String(p),
          method: i!.method!,
          body: i?.body ? JSON.parse(String(i.body)) : null,
        });
        return reply(String(p), i!);
      }),
    ),
    zoneId: "terrace",
    subject: "zone",
    zoneKeepOpen: summary,
  } as Partial<TillKeepOpen>);
  return { el, calls };
}
async function open(el: TillKeepOpen) {
  expect(
    el.shadowRoot!.querySelector("[data-action]"),
    "a closing zone has a recovery control",
  ).not.toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
  await expect.poll(() => el.shadowRoot!.querySelector("till-keep-open-dialog")).not.toBeNull();
  const d = el.shadowRoot!.querySelector<TillKeepOpenDialog>("till-keep-open-dialog")!;
  await d.updateComplete;
  return d;
}
async function save(d: TillKeepOpenDialog) {
  d.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "22:30" } }),
  );
  await d.updateComplete;
  d.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
}
it("reads the zone subject and writes a zone endpoint without a period id", async () => {
  const { el, calls } = await mount();
  const heard: unknown[] = [];
  el.addEventListener("keep-open-changed", (e) => heard.push((e as CustomEvent).detail));
  const d = await open(el);
  expect(el.shadowRoot!.querySelector("[data-action]")!.textContent!.trim()).toBe(
    "Keep Terrace open later",
  );
  expect(d.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Keep Terrace open later today");
  expect(d.shadowRoot!.querySelector("[data-ends]")!.textContent!.trim()).toBe(
    "Terrace closes at 22:00 today.",
  );
  expect(d.shadowRoot!.querySelector("[data-submit]")!.getAttribute("disabled")).not.toBeNull();
  await save(d);
  await expect.poll(() => heard).toEqual([{ zoneId: "terrace" }]);
  expect(calls).toEqual([
    { path: "/api/service-zones/terrace/keep-open", method: "GET", body: null },
    { path: "/api/service-zones/terrace/zone-extension", method: "PUT", body: { until: "22:30" } },
  ]);
  expect(el.shadowRoot!.querySelector("till-keep-open-dialog")).toBeNull();
});
it("retains a zone endpoint through manager approval", async () => {
  let writes = 0;
  const { el, calls } = await mount((p, i) =>
    p.endsWith("authorizers")
      ? json([{ personId: "ana", displayName: "Ana" }])
      : i.method === "PUT"
        ? ++writes === 1
          ? json({ error: { code: "authorization.not_permitted", params: {} } }, 403)
          : new Response(null, { status: 204 })
        : json({ period: null, zone }),
  );
  await save(await open(el));
  await expect
    .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
    .not.toBeNull();
  el.shadowRoot!.querySelector("till-supervisor-override-dialog")!.dispatchEvent(
    new CustomEvent("override-confirm", { detail: { personId: "ana", pin: "1234" } }),
  );
  await expect.poll(() => writes).toBe(2);
  expect(calls.filter((c) => c.method === "PUT")).toEqual([
    { path: "/api/service-zones/terrace/zone-extension", method: "PUT", body: { until: "22:30" } },
    {
      path: "/api/service-zones/terrace/zone-extension",
      method: "PUT",
      body: { until: "22:30", override: { personId: "ana", pin: "1234" } },
    },
  ]);
});
it("ends the zone extension with a null endpoint", async () => {
  const { el, calls } = await mount((_p, i) =>
    i.method === "PUT"
      ? new Response(null, { status: 204 })
      : json({ period: null, zone: { ...zone, extendedUntil: "22:30" } }),
  );
  const d = await open(el);
  d.shadowRoot!.querySelector<HTMLElement>("[data-stop]")!.click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]!.body).toEqual({ until: null });
});
it.each(["zone_extension.invalid", "zone_extension.not_allowed"])(
  "refreshes zone choices after %s without replacing the refusal",
  async (code) => {
    let reads = 0;
    const { el } = await mount((_p, i) =>
      i.method === "PUT"
        ? json({ error: { code, params: { field: "until" } } }, 409)
        : ++reads === 1
          ? json({ period: null, zone })
          : json({ period: null, zone: { ...zone, choices: ["22:15"] } }),
    );
    const d = await open(el);
    await save(d);
    await expect.poll(() => reads).toBe(2);
    await el.updateComplete;
    await d.updateComplete;
    expect(d.refusal).toBe(code);
    expect(d.selected).toBe("");
    expect(d.shadowRoot!.querySelector("wt-combobox")!.error).not.toBe("");
  },
);
it("ignores zone choices that finish after switching the subject", async () => {
  let finish!: (r: Response) => void;
  const { el } = await mount(() => new Promise((r) => (finish = r)));
  expect(el.shadowRoot!.querySelector("[data-action]")).not.toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  Object.assign(el, {
    subject: "period",
    keepOpen: {
      periodId: "dinner",
      periodName: "Dinner",
      endsAt: "23:00",
      running: true,
      extendedUntil: null,
    },
  });
  await el.updateComplete;
  finish(json({ period: null, zone }));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-keep-open-dialog")).toBeNull();
});
it("uses Spanish zone wording for a closed zone", async () => {
  setLocale("es");
  const { el } = await mount(() =>
    json({ period: null, zone: { ...zone, name: "Terraza", running: false } }),
  );
  Object.assign(el, { zoneKeepOpen: { ...summary, zoneName: "Terraza", running: false } });
  await el.updateComplete;
  const d = await open(el);
  expect(el.shadowRoot!.querySelector("[data-action]")!.textContent!.trim()).toBe(
    "Ampliar el horario de Terraza",
  );
  expect(d.shadowRoot!.querySelector("[data-ends]")!.textContent!.trim()).toBe(
    "Terraza está cerrada ahora.",
  );
});
