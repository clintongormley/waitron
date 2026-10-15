import type { AttendanceExportDialog } from "../widgets/attendance-export-dialog.js";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  change,
  click,
  mountManagerHours,
  openDay,
  record,
} from "../../test/manager-hours-fixtures.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale(locale);
});
async function open(theme?: "light" | "dark") {
  setLocale("en-GB");
  const m = await mountManagerHours({
    live: true,
    theme,
    exportOptions: { available: true, canExportAll: true },
  });
  await record(m.root);
  await expect.poll(() => m.root.querySelector("[data-export]")).toBeTruthy();
  await click(m.root, "[data-export]");
  const dialog = m.root.querySelector<AttendanceExportDialog>(
    "dashboard-attendance-export-dialog",
  )!;
  await expect
    .poll(
      () =>
        dialog.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=export-download]",
        )?.disabled,
    )
    .toBe(false);
  return { ...m, dialog };
}
it("starts with the chosen person and period, and downloads Everyone as representatives CSV", async () => {
  const m = await open();
  expect(m.dialog.mode).toBe("manager");
  expect(m.dialog.personId).toBe("worker");
  expect(m.dialog.period).toEqual({ start: "2026-01-01", end: "2026-02-01" });
  expect(m.dialog.people.map((p) => p.personId)).toEqual(["worker", "retained"]);
  await change(m.dialog.shadowRoot!, "exportPerson", "");
  await change(m.dialog.shadowRoot!, "exportAudience", "representatives");
  await change(m.dialog.shadowRoot!, "exportFormat", "csv");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:manager");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await click(m.dialog.shadowRoot!, "[data-test=export-download]");
  await expect.poll(() => anchor.mock.calls.length).toBe(1);
  expect(m.reads.find((r) => r.path.includes("/export?"))).toEqual({
    path: "/management-api/attendance/export?locationId=shop&from=2026-01-01&before=2026-02-01&format=csv&audience=representatives&locale=en",
    passive: null,
  });
  expect(
    m.reads.filter((r) => r.path.includes("export-options")).every((r) => r.passive === "1"),
  ).toBe(true);
});
it.each([
  { available: false, canExportAll: false },
  { available: true, canExportAll: false },
])(
  "keeps supervisor Hours and corrections usable but hides manager export with %o",
  async (exportOptions) => {
    const m = await mountManagerHours({ exportOptions });
    await record(m.root);
    await expect.poll(() => m.reads.some((r) => r.path.includes("export-options"))).toBe(true);
    await new Promise(requestAnimationFrame);
    expect(m.root.querySelector("[data-export]")).toBeNull();
    await openDay(m.root);
    expect(m.root.querySelector("[data-add-shift]")).toBeTruthy();
  },
);
it("does not offer export on Time corrections or change its existing queue", async () => {
  const m = await open();
  m.el.mode = "corrections";
  await m.el.updateComplete;
  await expect.poll(() => m.reads.some((r) => r.path.includes("/queue?"))).toBe(true);
  expect(m.root.querySelector("[data-export]")).toBeNull();
  expect(
    m.root.querySelector<AttendanceExportDialog>("dashboard-attendance-export-dialog")?.open,
  ).toBeFalsy();
  expect(m.root.querySelector("h1")!.textContent).toBe("Time corrections");
});
it("retains a dirty export across live Hours updates and retires it on a replacement session", async () => {
  const m = await open();
  await change(m.dialog.shadowRoot!, "exportFrom", "2020-01-01");
  m.data.hours.people[0]!.hours.workedMinutes = 540;
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await expect
    .poll(() => m.root.querySelector("dashboard-hours-record")?.view?.workedMinutes)
    .toBe(540);
  await m.dialog.updateComplete;
  expect(m.dialog.open).toBe(true);
  expect(
    m.dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="exportFrom"]')!
      .value,
  ).toBe("2020-01-01");
  const { createRequest } = await import("@waitron/dashboard-kit");
  m.el.request = createRequest({
    fetchImpl: async () => Response.json({ error: { code: "permission.denied" } }, { status: 403 }),
  });
  await m.el.updateComplete;
  await expect.poll(() => m.dialog.open).toBe(false);
  expect(m.root.querySelector("[data-export]")).toBeNull();
});
it("keeps an existing proposal draft when export is requested behind the modal", async () => {
  const m = await open();
  m.dialog.open = false;
  m.dialog.dispatchEvent(new CustomEvent("export-close"));
  await m.el.updateComplete;
  await openDay(m.root);
  await click(m.root, "[data-retime]");
  const editor = m.root.querySelector("dashboard-attendance-proposal-dialog")!;
  await editor.updateComplete;
  await change(editor.shadowRoot!, "attendanceReason", "Keep this proposal");
  m.root.querySelector<HTMLElement>("[data-export]")!.click();
  await m.el.updateComplete;
  expect(editor.open).toBe(true);
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-textarea"]>(
      '[name="attendanceReason"]',
    )!.value,
  ).toBe("Keep this proposal");
  expect(m.dialog.open).toBe(false);
});
it("retries a failed availability read through Hours Refresh without losing the Hours view", async () => {
  const m = await open();
  const request = m.el.request;
  let attempts = 0;
  m.el.request = (path, ...args) => {
    if (path.includes("export-options") && attempts++ === 0)
      return Promise.reject({ code: "connection.lost" });
    return request(path, ...args);
  };
  await expect.poll(() => m.root.querySelector("[data-export-error]")).toBeTruthy();
  expect(m.root.querySelector("dashboard-hours-record")?.view).toBeTruthy();
  await click(m.root, "[data-hours-refresh]");
  await expect.poll(() => m.root.querySelector("[data-export]")).toBeTruthy();
  expect(m.root.querySelector("[data-export-error]")).toBeNull();
});

it.each(["light", "dark"] as const)(
  "manager export attached to Hours has accessible controls in %s",
  async (theme) => {
    const m = await open(theme);
    await expectNoA11yViolations(m.host);
  },
);
