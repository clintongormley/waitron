import { afterEach, describe, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { AlertView, DashboardApi } from "../api/client.js";
import "./alerts-screen.js";
import type { AlertsScreen } from "./alerts-screen.js";

afterEach(cleanupWidgets);

const alerts: AlertView[] = [
  {
    key: "incident:i1",
    kind: "event",
    code: "fiscal.registro_rechazado",
    params: { mensaje: "NIF", codigo: 4102 },
    severity: "error",
    since: "2026-09-14T12:00:00.000Z",
    area: "fiscal",
  },
  {
    key: "backup.disabled:local",
    kind: "ongoing",
    code: "backup.disabled",
    params: {},
    severity: "warning",
    since: null,
    area: "backup",
    screen: "backup",
  },
];
const handled: AlertView[] = [
  { ...alerts[0]!, key: "incident:i2", handledAt: "2026-09-14T13:00:00.000Z", handledBy: null },
];

const api = (visible = true) =>
  ({
    listAlerts: vi.fn().mockResolvedValue({ visible, alerts: visible ? alerts : [] }),
    listHandledAlerts: vi.fn().mockResolvedValue({ visible, alerts: visible ? handled : [] }),
    markIncidentHandled: vi.fn(),
    liveData: new LiveData(),
  }) as unknown as DashboardApi;

const settle = async (el: AlertsScreen) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

describe.each(["light", "dark"] as const)("dashboard-alerts-screen a11y (%s theme)", (theme) => {
  it("the Open tab with alerts", async () => {
    history.replaceState(null, "", "/manage/alerts/view/open");
    const { el, host } = await mountWidget<AlertsScreen>(
      "dashboard-alerts-screen",
      { api: api(), canOpen: () => true },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });

  it("the Handled tab", async () => {
    history.replaceState(null, "", "/manage/alerts/view/handled");
    const { el, host } = await mountWidget<AlertsScreen>(
      "dashboard-alerts-screen",
      { api: api() },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });

  it("no access", async () => {
    const { el, host } = await mountWidget<AlertsScreen>(
      "dashboard-alerts-screen",
      { api: api(false) },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });
});
