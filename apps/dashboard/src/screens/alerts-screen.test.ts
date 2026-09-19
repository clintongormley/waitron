import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { LiveData } from "@waitron/dashboard-kit";
import type { AlertView, AlertsResponse, DashboardApi } from "../api/client.js";
import "./alerts-screen.js";
import type { AlertsScreen } from "./alerts-screen.js";

const open: AlertView = {
  key: "incident:i1",
  kind: "event",
  code: "payment.offline_forward_declined",
  params: { amount: "12.50", paymentRef: "pi_1" },
  severity: "error",
  since: "2026-09-14T12:00:00.000Z",
  area: "payments",
};
const handled: AlertView = {
  ...open,
  key: "incident:i2",
  handledAt: "2026-09-14T13:00:00.000Z",
  handledBy: "Marta",
};
const ongoing: AlertView = {
  key: "backup.disabled:local",
  kind: "ongoing",
  code: "backup.disabled",
  params: {},
  severity: "warning",
  since: null,
  area: "backup",
  screen: "backup",
};

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    listAlerts: vi
      .fn()
      .mockResolvedValue({ visible: true, alerts: [open, ongoing] } satisfies AlertsResponse),
    listHandledAlerts: vi
      .fn()
      .mockResolvedValue({ visible: true, alerts: [handled] } satisfies AlertsResponse),
    markIncidentHandled: vi.fn().mockResolvedValue(undefined),
    // A real LiveData: marking handled refreshes through invalidation, as in the running app.
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
}

const flush = async (el: AlertsScreen) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};
const rows = (el: AlertsScreen, test: string) =>
  el.shadowRoot!.querySelector(`[data-test=${test}]`)!.shadowRoot!.querySelectorAll("tbody tr");

beforeEach(() => {
  setLocale("en-GB");
  history.replaceState(null, "", "/manage/alerts");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("dashboard-alerts-screen", () => {
  it("shows open alerts on the Open tab, with wording, and records the tab in the URL", async () => {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: stubApi() });
    await flush(el);
    expect(rows(el, "open-alerts-table")).toHaveLength(2);
    expect(rows(el, "open-alerts-table")[0]!.textContent).toContain(
      "A card payment of 12.50 taken while offline",
    );
    expect(location.pathname).toBe("/manage/alerts/view/open");
  });

  it("switches to Handled and shows who handled it", async () => {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: stubApi() });
    await flush(el);
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    const handledTab = [...tabs.shadowRoot!.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (t) => t.textContent!.includes("Handled"),
    )!;
    await userEvent.click(handledTab);
    await flush(el);
    expect(location.pathname).toBe("/manage/alerts/view/handled");
    const text = rows(el, "handled-alerts-table")[0]!.textContent!;
    expect(text).toContain("Marta");
  });

  it("refreshes who handled an alert when a person changes", async () => {
    const renamed: AlertView = { ...handled, handledBy: "Marta Ruiz" };
    const api = stubApi({
      listHandledAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [handled] })
        .mockResolvedValue({ visible: true, alerts: [renamed] }),
    });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(rows(el, "handled-alerts-table")[0]!.textContent).toContain("Marta");
    api.liveData.invalidate([{ type: "persons", id: "p1" }]);
    await vi.waitFor(() =>
      expect(rows(el, "handled-alerts-table")[0]!.textContent).toContain("Marta Ruiz"),
    );
  });

  it("opens on the Handled tab from the URL", async () => {
    history.replaceState(null, "", "/manage/alerts/view/handled");
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("handled");
  });

  it("marking an event handled moves it from Open to Handled", async () => {
    const nowHandled: AlertView = {
      ...open,
      handledAt: "2026-09-14T14:00:00.000Z",
      handledBy: "Ana",
    };
    const api = stubApi({
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [open, ongoing] })
        .mockResolvedValue({ visible: true, alerts: [ongoing] }),
      listHandledAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [handled] })
        .mockResolvedValue({ visible: true, alerts: [nowHandled, handled] }),
    });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    const button = rows(el, "open-alerts-table")[0]!.querySelector<HTMLElement>(
      "[data-test=alert-handle]",
    )!;
    await userEvent.click(button);
    expect(api.markIncidentHandled).toHaveBeenCalledWith("i1");
    await vi.waitFor(() => expect(rows(el, "open-alerts-table")).toHaveLength(1));
    await vi.waitFor(() => expect(rows(el, "handled-alerts-table")).toHaveLength(2));
    expect(rows(el, "handled-alerts-table")[0]!.textContent).toContain("Ana");
  });

  it("shows the error when marking handled fails and keeps the alert listed", async () => {
    const api = stubApi({
      markIncidentHandled: vi.fn().mockRejectedValue({ code: "alert.not_found" }),
    });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    await userEvent.click(
      rows(el, "open-alerts-table")[0]!.querySelector<HTMLElement>("[data-test=alert-handle]")!,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-error]")!.textContent).toContain(
      "This alert no longer exists",
    );
    expect(rows(el, "open-alerts-table")).toHaveLength(2);
  });

  it("offers Go to only for a screen the session may open", async () => {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", {
      api: stubApi(),
      canOpen: (screen: string) => screen === "backup",
    });
    await flush(el);
    const goTo = vi.fn();
    el.addEventListener("wt-alert-go-to", goTo);
    const button = el
      .shadowRoot!.querySelector("[data-test=open-alerts-table]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=alert-go-to]")!;
    await userEvent.click(button);
    expect(goTo.mock.calls[0]![0].detail).toEqual({ screen: "backup" });
  });

  it("offers no Go to for a screen the session may not open", async () => {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", {
      api: stubApi(),
      canOpen: () => false,
    });
    await flush(el);
    expect(rows(el, "open-alerts-table")).toHaveLength(2);
    expect(
      el
        .shadowRoot!.querySelector("[data-test=open-alerts-table]")!
        .shadowRoot!.querySelector("[data-test=alert-go-to]"),
    ).toBeNull();
  });

  it("shows the Open tab for an unknown view and corrects the URL in place", async () => {
    history.replaceState(null, "", "/manage/alerts/view/bogus");
    const before = history.length;
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("open");
    expect(location.pathname).toBe("/manage/alerts/view/open");
    expect(history.length).toBe(before);
  });

  it("keeps the load error shown while Handled fails, even after Open refreshes", async () => {
    const listAlerts = vi.fn().mockResolvedValue({ visible: true, alerts: [open, ongoing] });
    const api = stubApi({
      listAlerts,
      // The retry never settles, so only Open's refresh can change what the screen shows.
      listHandledAlerts: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockReturnValue(new Promise(() => {})),
    });
    history.replaceState(null, "", "/manage/alerts/view/handled");
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-load-error]")).not.toBeNull();
    api.liveData.invalidate([{ type: "incidents" }]);
    await vi.waitFor(() => expect(listAlerts).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-load-error]")).not.toBeNull();
  });

  it("shows the loading message on Handled until its own read arrives", async () => {
    const api = stubApi({ listHandledAlerts: vi.fn().mockReturnValue(new Promise(() => {})) });
    history.replaceState(null, "", "/manage/alerts/view/handled");
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(rows(el, "open-alerts-table")).toHaveLength(2);
    const handledTable = el.shadowRoot!.querySelector("[data-test=handled-alerts-table]")!;
    expect(handledTable.shadowRoot!.textContent).toContain("Loading alerts…");
    expect(handledTable.shadowRoot!.textContent).not.toContain("Nothing was handled");
  });

  it("shows no empty message under the load error when a list has never loaded", async () => {
    const api = stubApi({
      listAlerts: vi.fn().mockRejectedValue({ code: "server.internal" }),
      listHandledAlerts: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-load-error]")).not.toBeNull();
    const text = (test: string) =>
      el.shadowRoot!.querySelector(`[data-test=${test}]`)!.shadowRoot!.textContent!;
    expect(text("handled-alerts-table")).not.toContain("Nothing was handled");
    expect(text("open-alerts-table")).not.toContain("Nothing needs attention");
  });

  it("keeps the empty message after a list that loaded empty fails to refresh", async () => {
    const api = stubApi({
      listHandledAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [] })
        .mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    api.liveData.invalidate([{ type: "incidents" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=alerts-load-error]")).not.toBeNull(),
    );
    await flush(el);
    const handledTable = el.shadowRoot!.querySelector("[data-test=handled-alerts-table]")!;
    expect(handledTable.shadowRoot!.textContent).toContain("Nothing was handled");
  });

  it("says so when the session may see no alerts", async () => {
    const api = stubApi({ listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }) });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-no-access]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
  });

  it("shows a load error", async () => {
    const api = stubApi({ listAlerts: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-load-error]")!.textContent).toContain(
      "Alerts could not be loaded",
    );
    expect(el.shadowRoot!.querySelector("[data-test=alerts-error]")).toBeNull();
  });

  it("wraps long wording so a desktop-width screen keeps Mark handled in view", async () => {
    const [width, height] = [window.innerWidth, window.innerHeight];
    await page.viewport(1280, 900);
    try {
      const long: AlertView = {
        ...open,
        code: "fiscal.registro_rechazado",
        params: {
          mensaje: "El NIF del destinatario no está identificado en el censo",
          codigo: 4102,
        },
        area: "fiscal",
      };
      const api = stubApi({
        listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [long] }),
      });
      const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
      await flush(el);
      const button = rows(el, "open-alerts-table")[0]!.querySelector<HTMLElement>(
        "[data-test=alert-handle]",
      )!;
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
        el.getBoundingClientRect().right,
      );
    } finally {
      await page.viewport(width, height);
    }
  });
});
