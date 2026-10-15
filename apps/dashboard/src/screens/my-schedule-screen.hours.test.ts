import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { MyScheduleScreen } from "./my-schedule-screen.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { hoursView } from "../../test/hours-fixtures.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
  vi.restoreAllMocks();
});
async function mount(
  path = "/manage/my-schedule",
  modules: readonly string[] = ["workforce"],
  language = "en-GB",
) {
  history.replaceState(null, "", path);
  setLocale(language);
  const request = vi.fn<DashboardRequest>(
    async <T>(url: string) =>
      (url.endsWith("/inbox")
        ? {
            personId: "p1",
            revision: "r",
            prompts: [],
            items: [],
            locations: [{ id: "venue", name: "Deli", timeZone: "Europe/Madrid" }],
          }
        : hoursView({ selection: { kind: "week" } })) as T,
  );
  const api = {
    getStaffRoster: async () => [],
    listMyShifts: async () => [],
    listMySwaps: async () => [],
    listMyAbsences: async () => [],
  } as unknown as DashboardApi;
  const mounted = await mountWidget<MyScheduleScreen>("dashboard-my-schedule-screen", {
    api,
    request: request as DashboardRequest,
    modules,
    myPersonId: "p1",
  });
  return { ...mounted, request };
}
function tabs(el: MyScheduleScreen) {
  return el.shadowRoot!.querySelector("wt-tabs")!;
}
async function choose(el: MyScheduleScreen, key: string) {
  await userEvent.click(tabs(el).shadowRoot!.querySelector(`[data-key="${key}"]`)!);
  await el.updateComplete;
}
it("keeps Schedule first and lazy, opens Hours on one push and preserves unrelated query values", async () => {
  const { el, request } = await mount("/manage/my-schedule?keep=yes");
  expect(tabs(el)?.items.map((i) => [i.key, i.label])).toEqual([
    ["schedule", "Schedule"],
    ["hours", "Hours"],
  ]);
  expect(request).not.toHaveBeenCalled();
  const push = vi.spyOn(history, "pushState");
  await choose(el, "hours");
  expect(push).toHaveBeenCalledTimes(1);
  expect(location.pathname).toBe("/manage/my-schedule/view/hours");
  expect(location.search).toBe("?keep=yes");
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  history.replaceState(null, "", "/manage/my-schedule/view/schedule?keep=yes");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await el.updateComplete;
  expect(tabs(el).value).toBe("schedule");
});
it("restores a direct Hours path and Spanish tab labels", async () => {
  const { el, request } = await mount("/manage/my-schedule/view/hours", ["workforce"], "es-ES");
  expect(tabs(el)?.items.map((i) => i.label)).toEqual(["Horario", "Horas"]);
  expect(tabs(el).value).toBe("hours");
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
});
it.each(["/manage/my-schedule/view/hours", "/manage/my-schedule/view/nope"])(
  "hides disabled Hours at%s and makes no attendance read",
  async (path) => {
    const { el, request } = await mount(path, []);
    expect(el.shadowRoot!.querySelector("dashboard-my-hours-panel")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/manage/my-schedule/view/schedule");
  },
);
it("preserves a mounted schedule draft when switching to Hours and back", async () => {
  const { el } = await mount();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="abs-note"]')).not.toBeNull(),
  );
  const field = el.shadowRoot!.querySelector('[data-test="abs-note"]')!;
  field.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Family visit" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  await choose(el, "hours");
  expect(el.shadowRoot!.querySelector('[data-test="abs-note"]')).toBe(field);
  await choose(el, "schedule");
  expect((field as unknown as { value: string }).value).toBe("Family visit");
});
it("ignores a nested tab event rather than pushing an outer tab", async () => {
  const { el } = await mount();
  const push = vi.spyOn(history, "pushState");
  el.shadowRoot!.querySelector('[data-test="loading"]')?.dispatchEvent(
    new CustomEvent("wt-tab-change", { detail: { value: "hours" }, bubbles: true, composed: true }),
  );
  expect(push).not.toHaveBeenCalled();
  expect(tabs(el)?.value).toBe("schedule");
});
it("moves keyboard tabs to Hours and pushes its address once", async () => {
  const { el } = await mount();
  const push = vi.spyOn(history, "pushState");
  tabs(el).shadowRoot!.querySelector<HTMLButtonElement>('[data-key="schedule"]')!.focus();
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/my-schedule/view/hours");
  expect(push).toHaveBeenCalledTimes(1);
});
