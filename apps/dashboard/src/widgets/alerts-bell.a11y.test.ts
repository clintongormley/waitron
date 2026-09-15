import { afterEach, describe, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { AlertView } from "../api/client.js";
import "./alerts-bell.js";
import type { AlertsBell } from "./alerts-bell.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const alerts: AlertView[] = [
  {
    key: "incident:1",
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

describe.each(["light", "dark"] as const)("dashboard-alerts-bell a11y (%s theme)", (theme) => {
  it("closed and open with alerts", async () => {
    const { el, host } = await mountWidget<AlertsBell>(
      "dashboard-alerts-bell",
      { alerts, canOpen: () => true },
      theme,
    );
    await expectNoA11yViolations(host);
    el.open();
    await expectNoA11yViolations(host);
  });

  it("open and empty, and open with an error message", async () => {
    const { el, host } = await mountWidget<AlertsBell>(
      "dashboard-alerts-bell",
      { alerts: [], error: "alert.not_found" },
      theme,
    );
    el.open();
    await expectNoA11yViolations(host);
  });
});
