import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { HandoverIntervalsScreen } from "./handover-intervals-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("handover intervals (%s)", (theme) => {
  it("keeps empty, populated and failed states accessible, with keyboard retry", async () => {
    setLocale("en-GB");
    const list = vi
      .fn()
      .mockResolvedValueOnce({ intervals: [], timeZone: "Europe/Madrid" })
      .mockResolvedValueOnce({
        intervals: [
          {
            operationId: "op",
            inventoryReceived: true,
            sourceName: "Old box",
            destinationName: "New box",
            lastChangeAtMs: null,
            declaredAtMs: 1794304800000,
            activatedAt: "2026-11-10T10:01:00Z",
            reason: "Power failure",
          },
        ],
        timeZone: "Europe/Madrid",
      })
      .mockRejectedValueOnce({ code: "report.failed" })
      .mockResolvedValue({ intervals: [], timeZone: "Europe/Madrid" });
    const { el, host } = await mountWidget<HandoverIntervalsScreen>(
      "dashboard-handover-intervals-screen",
      { api: { listHandoverIntervals: list } as unknown as DashboardApi },
      theme,
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.loading).toBe(false),
    );
    await expectNoA11yViolations(host);
    const button = el.shadowRoot!.querySelector("wt-button")!;
    await userEvent.click(button);
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.rows).toHaveLength(1),
    );
    await expectNoA11yViolations(host);
    await userEvent.click(button);
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.errorMessage).toBeTruthy(),
    );
    await expectNoA11yViolations(host);
    button.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("wt-data-table")?.errorMessage).toBe(""),
    );
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows).toEqual([]);
  });
});
