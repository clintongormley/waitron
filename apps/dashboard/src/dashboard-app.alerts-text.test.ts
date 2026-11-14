import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtToast } from "@waitron/ui";
import { cleanupWidgets, mountWidget, timesAcrossLines } from "./widgets/test-helpers.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import { setLocale } from "./i18n/t.js";
import { stubShellApi, type ShellLocale } from "./testing/venue-logo-fixture.js";
import type { AlertView } from "./api/client.js";

const station: AlertView = {
  key: "incident:s1",
  kind: "event",
  code: "route.released_at_closed_station",
  params: {
    station: "Upstairs bar",
    dishes: "Mojito, Chips",
    workingOrderId: "w1",
    orderNumber: 42,
    orderLabel: "Table 3",
  },
  severity: "warning",
  since: "2026-11-14T12:00:00.000Z",
  area: "kitchen",
};
const refusals: AlertView = {
  key: "incident:r1",
  kind: "event",
  code: "fiscal.refusals_repeated",
  params: { count: 5, codigo: 4102 },
  severity: "error",
  since: "2026-11-14T12:00:00.000Z",
  area: "fiscal",
};
const clock: AlertView = {
  key: "clock.disagrees",
  kind: "ongoing",
  code: "clock.disagrees",
  params: { count: 2, deviceAt: "2026-11-14T09:40:00.000Z", boxAt: "2026-11-14T08:05:00.000Z" },
  severity: "warning",
  since: null,
  area: "box",
  screen: "box-status",
};

const initialUrl = location.href;
let before = { width: 0, height: 0 };
afterEach(async () => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
  setLocale("es-ES");
  await page.viewport(before.width, before.height);
});

async function mountShell(locale: ShellLocale, alerts: AlertView[]) {
  before = { width: window.innerWidth, height: window.innerHeight };
  setLocale(locale);
  await page.viewport(390, 844);
  await vi.waitFor(() => expect(window.innerWidth).toBe(390));
  const api = stubShellApi(true, locale);
  const listAlerts = vi.fn().mockResolvedValue({ visible: true, alerts });
  Object.assign(api, {
    listAlerts,
    listHandledAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    markIncidentHandled: vi.fn(),
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  return { el, api, listAlerts };
}

it.each(["en-GB", "es-ES"] as const)(
  "shows every line of a long alert on a phone without panning, left of its action (%s)",
  async (locale) => {
    history.replaceState(null, "", "/manage/alerts");
    const { el } = await mountShell(locale, [station, refusals]);
    const tableIn = () =>
      el
        .shadowRoot!.querySelector("dashboard-alerts-screen")
        ?.shadowRoot?.querySelector("[data-test=open-alerts-table]");
    await expect.poll(() => tableIn()?.shadowRoot?.querySelectorAll("tbody tr").length).toBe(2);
    const table = tableIn()!;
    await document.fonts.ready;
    const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    expect(scroll.scrollLeft).toBe(0);
    const box = scroll.getBoundingClientRect();
    for (const row of table.shadowRoot!.querySelectorAll("tbody tr")) {
      const message = row.querySelector<HTMLElement>('[part="alert-message"]')!;
      const action = row.lastElementChild!.querySelector("wt-button")!.getBoundingClientRect();
      expect(action.left).toBeGreaterThanOrEqual(box.left);
      expect(action.right).toBeLessThanOrEqual(box.right);
      const range = document.createRange();
      range.selectNodeContents(message);
      const lines = [...range.getClientRects()];
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line.left, message.textContent!).toBeGreaterThanOrEqual(box.left);
        expect(line.right, message.textContent!).toBeLessThanOrEqual(action.left);
      }
    }
  },
);

it.each(["en-GB", "es-ES"] as const)(
  "never splits a written time across two lines in the alert pop-up (%s)",
  async (locale) => {
    const { el, api, listAlerts } = await mountShell(locale, []);
    await expect.poll(() => listAlerts.mock.calls.length).toBeGreaterThan(0);
    listAlerts.mockResolvedValue({ visible: true, alerts: [clock] });
    api.liveData.invalidate([{ type: "incidents", id: "new" }]);
    const toast = el.shadowRoot!.querySelector<WtToast>("[data-test=alert-toast]")!;
    await vi.waitFor(() => expect(toast.open).toBe(true));
    await toast.updateComplete;
    await document.fonts.ready;
    const message = toast.shadowRoot!.querySelector(".message")!;
    let checked = 0;
    const split = new Set<string>();
    // Narrowing the pop-up a pixel at a time moves every break past both times.
    for (let width = 340; width >= 200; width -= 1) {
      toast.style.width = `${width}px`;
      const found = timesAcrossLines([message]);
      checked += found.checked;
      for (const time of found.broken) split.add(`${time} at ${width}px`);
    }
    expect(checked).toBe(2 * 141);
    expect([...split]).toEqual([]);
  },
);
