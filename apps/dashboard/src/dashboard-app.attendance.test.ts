import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import { managerHours } from "../test/manager-hours-fixtures.js";
import { hoursView } from "../test/hours-fixtures.js";
import.meta.glob("./screens/attendance-corrections-screen.ts", { eager: true });
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
async function mount(modules: string[], permissions: string[], role = "supervisor", path = "/") {
  await page.viewport(1280, 900);
  history.replaceState(null, "", path);
  const api = {
    getMe: vi.fn().mockResolvedValue({
      personId: "boss",
      role,
      email: "boss@example.com",
      locale: "en-GB",
      venueLocale: "es-ES",
      sessionDefault: "en-GB",
      venueName: "Deli",
      permissions,
      modules,
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getStaffRoster: vi.fn().mockResolvedValue([]),
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    getSalesOverview: vi.fn(() => new Promise(() => undefined)),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
  } as unknown as DashboardApi;
  const requests: string[] = [];
  const request = createRequest({
    fetchImpl: async (path) => {
      requests.push(path);
      if (path.endsWith("/me/attendance/inbox"))
        return Response.json({
          personId: "boss",
          revision: "r",
          prompts: [],
          items: [],
          locations: [{ id: "venue", name: "Deli", timeZone: "Europe/Madrid" }],
        });
      if (path.includes("/me/attendance/hours?"))
        return Response.json(hoursView({ personId: "boss", selection: { kind: "week" } }));
      if (path.endsWith("/lookups"))
        return Response.json({
          viewer: { personId: "boss", canSelfApprove: false },
          locations: [{ id: "shop", name: "Deli", timeZone: "Europe/Madrid" }],
          people: [{ personId: "worker", displayName: "Ana" }],
        });
      if (path.includes("/me/attendance/day?"))
        return Response.json({
          personId: "boss",
          locationId: "venue",
          date: "2026-01-05",
          timeZone: "Europe/Madrid",
          revision: "day-r",
          record: hoursView({ personId: "boss" }).record,
          items: [],
        });
      if (path.includes("/attendance/hours?")) return Response.json(managerHours());
      if (path.includes("/queue?")) return Response.json({ locationId: "shop", items: [] });
      throw new Error(path);
    },
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request });
  await expect
    .poll(() =>
      el.shadowRoot!.querySelector(
        role === "staff" ? "[data-test=nav-my-schedule]" : "[data-test=nav-overview]",
      ),
    )
    .not.toBeNull();
  return { el, requests };
}
it("a permitted supervisor opens the real workforce correction screen from Team", async () => {
  const { el, requests } = await mount(["workforce"], ["workforce.correct"]);
  const nav = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-time-corrections]");
  expect(nav).not.toBeNull();
  const team = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-team]")!;
  if (team.getAttribute("aria-expanded") === "false") await userEvent.click(team);
  await userEvent.click(nav!);
  const screen = el.shadowRoot!.querySelector("dashboard-attendance-corrections-screen")!;
  await expect.poll(() => screen.shadowRoot?.textContent).toContain("Time corrections");
  await expect.poll(() => requests.some((path) => path.includes("/attendance/queue?"))).toBe(true);
});
it.each([
  [[], ["workforce.correct"]],
  [["workforce"], []],
])(
  "hides corrections when the module or permission is absent: %j / %j",
  async (modules, permissions) => {
    const { el, requests } = await mount(modules, permissions);
    expect(el.shadowRoot!.querySelector("[data-test=nav-time-corrections]")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-attendance-corrections-screen")).toBeNull();
    expect(requests).toEqual([]);
  },
);
it("forwards the authenticated module snapshot and own request as a detached copy to My Schedule", async () => {
  const modules = ["workforce"];
  const { el } = await mount(modules, [], "staff");
  const nav = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-my-schedule]")!;
  await userEvent.click(nav);
  const screen = el.shadowRoot!.querySelector("dashboard-my-schedule-screen")!;
  expect(screen.modules).toEqual(["workforce"]);
  expect(screen.modules).not.toBe(modules);
  expect(screen.request).toBe(el.request);
  expect(screen.myPersonId).toBe("boss");
  modules.length = 0;
  expect(screen.modules).toEqual(["workforce"]);
});

it("keeps a dirty schedule draft across the Hours tab and still protects an actual page departure", async () => {
  const { el } = await mount(["workforce"], [], "staff");
  const screen = el.shadowRoot!.querySelector("dashboard-my-schedule-screen")!;
  await expect
    .poll(() => screen.shadowRoot!.querySelector('[data-test="abs-note"]'))
    .not.toBeNull();
  const note = screen.shadowRoot!.querySelector('[data-test="abs-note"]')!;
  note.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Family visit" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  await userEvent.click(tabs.shadowRoot!.querySelector('[data-key="hours"]')!);
  await expect.poll(() => location.pathname).toBe("/manage/my-schedule/view/hours");
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")?.open).not.toBe(true);
  expect(screen.shadowRoot!.querySelector('[data-test="abs-note"]')).toBe(note);
  expect((note as unknown as { value: string }).value).toBe("Family visit");
  await userEvent.click(el.shadowRoot!.querySelector('[data-test="nav-orders"]')!);
  await expect.poll(() => el.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
});

it("lets a supervisor open their own Hours without workforce.correct", async () => {
  const { el, requests } = await mount(
    ["workforce"],
    [],
    "supervisor",
    "/manage/my-schedule/view/hours",
  );
  await expect
    .poll(() => el.shadowRoot!.querySelector("dashboard-my-schedule-screen"))
    .not.toBeNull();
  await expect.poll(() => requests.some((p) => p.includes("/me/attendance/hours?"))).toBe(true);
  expect(requests.every((p) => !p.includes("/attendance/queue?"))).toBe(true);
});

it("Back from Hours protects a dirty own request while retaining the hidden schedule forms", async () => {
  const { el } = await mount(["workforce"], [], "staff");
  const screen = el.shadowRoot!.querySelector("dashboard-my-schedule-screen")!;
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  await userEvent.click(tabs.shadowRoot!.querySelector('[data-key="hours"]')!);
  const panel = screen.shadowRoot!.querySelector("dashboard-my-hours-panel")!;
  await expect
    .poll(() => panel.shadowRoot!.querySelector("dashboard-hours-record")?.view)
    .toBeTruthy();
  const record = panel.shadowRoot!.querySelector("dashboard-hours-record")!;
  await userEvent.click(record.shadowRoot!.querySelector('[data-fix="2026-01-05"]')!);
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-retime]")).toBeTruthy();
  await userEvent.click(panel.shadowRoot!.querySelector("[data-retime]")!);
  const editor = panel.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!;
  await editor.updateComplete;
  const field = editor.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  const reason = field.shadowRoot!.querySelector("textarea")!;
  await userEvent.fill(page.elementLocator(reason), "Worked later");
  await editor.updateComplete;
  history.back();
  await expect.poll(() => el.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  el.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "keep" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => el.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(false);
  expect(location.pathname).toBe("/manage/my-schedule/view/hours");
  expect(reason.value).toBe("Worked later");
  expect(editor.open).toBe(true);
  history.back();
  await expect.poll(() => el.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  el.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => location.pathname).toBe("/manage/my-schedule");
  await panel.updateComplete;
  expect(panel.shadowRoot!.querySelector("dashboard-hours-record")).toBeNull();
  expect(screen.shadowRoot!.querySelector('[data-test="abs-note"]')).not.toBeNull();
});

it("opens contributed manager Hours directly while preserving the Time corrections route", async () => {
  const { el, requests } = await mount(
    ["workforce"],
    ["workforce.correct"],
    "supervisor",
    "/manage/hours",
  );
  const nav = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-hours]");
  expect(nav).toBeTruthy();
  await expect
    .poll(
      () =>
        el
          .shadowRoot!.querySelector("dashboard-attendance-corrections-screen")
          ?.shadowRoot?.querySelector("dashboard-hours-record")?.view,
    )
    .toBeTruthy();
  expect(location.pathname).toBe("/manage/hours");
  expect(requests.some((path) => path.includes("/attendance/hours?"))).toBe(true);
  expect(requests.some((path) => path.includes("/attendance/queue?"))).toBe(false);
  setLocale("es-ES");
  await el.updateComplete;
  expect(nav!.textContent).toContain("Horas");
  const team = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-team]")!;
  if (team.getAttribute("aria-expanded") === "false") await userEvent.click(team);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-time-corrections]")!,
  );
  await expect.poll(() => location.pathname).toBe("/manage/time-corrections");
  await expect.poll(() => requests.some((path) => path.includes("/attendance/queue?"))).toBe(true);
  expect(el.shadowRoot!.querySelector("dashboard-attendance-corrections-screen")?.mode).toBe(
    "corrections",
  );
});
it.each([
  [[], ["workforce.correct"]],
  [["workforce"], []],
])(
  "hides manager Hours without enabled workforce and authority: %j / %j",
  async (modules, permissions) => {
    const { el, requests } = await mount(modules, permissions, "supervisor", "/manage/hours");
    expect(el.shadowRoot!.querySelector("[data-test=nav-hours]")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-attendance-corrections-screen")).toBeNull();
    expect(requests).toEqual([]);
  },
);
