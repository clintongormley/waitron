import { afterEach, describe, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StationHealthSnapshot } from "./routing-client.js";
import "./station-health-table.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("station health (%s)", (theme) => {
  it.each(["empty", "screen"])("checks %s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("prep-station-health-table");
    const snapshot: StationHealthSnapshot = {
      capturedAt: "2026-10-05T12:00:00Z",
      outputsDown: { printersDown: [], screensDark: [] },
      stations:
        state === "empty"
          ? []
          : [
              {
                id: "bar",
                name: "Bar",
                hasScreen: true,
                waiting: 1,
                preparing: 0,
                ready: 0,
                oldestMinutes: 12,
                late: { warm: 0, overdue: 1, forgotten: 0 },
                items: [
                  {
                    id: "soup",
                    name: "Soup",
                    orderId: "o1",
                    orderNumber: 7,
                    label: null,
                    tableNames: ["Table 5"],
                    state: "queued",
                    queuedAt: "2026-10-05T11:48:00Z",
                    remainingQuantity: "1.000",
                    band: "overdue",
                  },
                ],
              },
            ],
    };
    el.snapshot = snapshot;
    el.today = { bar: "Always open" };
    host.append(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expectNoA11yViolations(host);
  });
});
