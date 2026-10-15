import type { AttendanceExportDialog } from "./attendance-export-dialog.js";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createRequest, LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { hoursView } from "../../test/hours-fixtures.js";
import { change, click, deferred } from "../../test/manager-hours-fixtures.js";
import "./my-hours-panel.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale(locale);
});
async function mount(available = true, theme?: "light" | "dark") {
  setLocale("en-GB");
  const reads: { path: string; passive: string | null }[] = [];
  const data = {
    locations: [
      { id: "venue", name: "Deli", timeZone: "Europe/Madrid" },
      { id: "old", name: "Former workplace", timeZone: "UTC" },
    ],
    available,
  };
  const file = deferred<Blob>();
  const request = createRequest({
    fetchImpl: async (path, init) => {
      reads.push({ path, passive: new Headers(init.headers).get("x-waitron-live") });
      if (path.includes("export-options"))
        return Response.json({ available: data.available, canExportAll: false });
      if (path.includes("/export?")) return new Response(await file.promise);
      if (path.endsWith("/inbox"))
        return Response.json({
          personId: "p1",
          revision: "r",
          locations: data.locations,
          items: [],
          prompts: [],
        });
      const q = new URL(path, location.origin).searchParams;
      return Response.json(
        hoursView({ locationId: q.get("locationId")!, selection: { kind: "week" } }),
      );
    },
  });
  const liveData = new LiveData();
  const m = await mountWidget<HTMLElementTagNameMap["dashboard-my-hours-panel"]>(
    "dashboard-my-hours-panel",
    { request, personId: "p1", active: true, liveData },
    theme,
  );
  const root = m.el.shadowRoot!;
  await expect.poll(() => root.querySelector("dashboard-hours-record")?.view).toBeTruthy();
  await expect.poll(() => reads.some((r) => r.path.includes("export-options"))).toBe(true);
  return { ...m, root, reads, data, file, liveData };
}
async function open(root: ShadowRoot) {
  await expect.poll(() => root.querySelector("[data-export]")).toBeTruthy();
  await click(root, "[data-export]");
  const dialog = root.querySelector<AttendanceExportDialog>("dashboard-attendance-export-dialog")!;
  await expect
    .poll(
      () =>
        dialog.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=export-download]",
        )?.disabled,
    )
    .toBe(false);
  return dialog;
}
it("exports the displayed own range with an editable start, no roster or person query, and passive availability", async () => {
  const m = await mount();
  const dialog = await open(m.root);
  expect(dialog.mode).toBe("own");
  expect(dialog.people).toEqual([]);
  expect(dialog.period).toEqual({ start: "2026-01-05", end: "2026-01-12" });
  expect(dialog.shadowRoot!.querySelector('[name="exportPerson"]')).toBeNull();
  await change(dialog.shadowRoot!, "exportFrom", "2020-01-01");
  const downloaded = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await click(dialog.shadowRoot!, "[data-test=export-download]");
  await expect.poll(() => m.reads.some((r) => r.path.includes("/export?"))).toBe(true);
  const read = m.reads.find((r) => r.path.includes("/export?"))!;
  expect(read.path).toBe(
    "/management-api/me/attendance/export?locationId=venue&from=2020-01-01&before=2026-01-12&format=pdf&audience=standard&locale=en",
  );
  expect(read.passive).toBeNull();
  expect(
    m.reads.filter((r) => r.path.includes("export-options")).every((r) => r.passive === "1"),
  ).toBe(true);
  expect(m.reads.some((r) => r.path.includes("lookups"))).toBe(false);
  m.file.resolve(new Blob(["own record"]));
  await expect.poll(() => anchor.mock.calls.length).toBe(1);
  expect(downloaded).toHaveBeenCalledTimes(1);
});
it("hides export with no enabled provider while Hours remains readable", async () => {
  const m = await mount(false);
  await new Promise(requestAnimationFrame);
  expect(m.root.querySelector("[data-export]")).toBeNull();
  expect(m.root.querySelector("dashboard-hours-record")!.view!.workedMinutes).toBe(480);
});
it("retains an edited range across a live Hours refresh", async () => {
  const m = await mount();
  const dialog = await open(m.root);
  await change(dialog.shadowRoot!, "exportFrom", "2020-01-01");
  m.liveData.invalidate([{ type: "time_entries" }]);
  await expect
    .poll(() => m.reads.filter((r) => r.path.includes("/hours?")).length)
    .toBeGreaterThan(1);
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="exportFrom"]')!
      .value,
  ).toBe("2020-01-01");
});
it.each(["inactive", "person", "location-removed", "disconnect"])(
  "retires a held download after %s",
  async (kind) => {
    const m = await mount();
    const dialog = await open(m.root);
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const created = vi.spyOn(URL, "createObjectURL");
    await click(dialog.shadowRoot!, "[data-test=export-download]");
    await expect.poll(() => m.reads.some((r) => r.path.includes("/export?"))).toBe(true);
    if (kind === "inactive") m.el.active = false;
    else if (kind === "person") {
      m.el.personId = "p2";
      m.el.active = false;
    } else if (kind === "disconnect") m.el.remove();
    else {
      m.data.locations = [];
      m.liveData.invalidate([{ type: "time_entries" }]);
      await expect.poll(() => m.root.querySelector("dashboard-hours-record")?.view).toBeFalsy();
    }
    await m.el.updateComplete;
    m.file.resolve(new Blob(["retired record"]));
    await new Promise(requestAnimationFrame);
    expect(anchor).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  },
);
it("reads availability for the newly selected historical workplace", async () => {
  const m = await mount();
  await change(m.root, "hoursLocation", "old");
  await expect
    .poll(() => m.reads.some((r) => r.path.endsWith("export-options?locationId=old")))
    .toBe(true);
  const dialog = await open(m.root);
  expect(dialog.locationId).toBe("old");
  await userEvent.keyboard("{Escape}");
});

it.each(["light", "dark"] as const)(
  "own export attached to Hours has accessible controls in %s",
  async (theme) => {
    const m = await mount(true, theme);
    await open(m.root);
    await expectNoA11yViolations(m.host);
  },
);
