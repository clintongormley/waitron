import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { HandoverReportWarning } from "./handover-report-warning.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("handover report warning (%s)", (theme) => {
  it("keeps unconfirmed, refreshing and failed messages accessible", async () => {
    let answer!: (value: unknown) => void;
    let refuse!: (reason: unknown) => void;
    const list = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    );
    const { el, host } = await mountWidget<HandoverReportWarning>(
      "dashboard-handover-report-warning",
      {
        api: { listHandoverIntervals: list } as unknown as DashboardApi,
      },
      theme,
    );
    answer({
      intervals: [
        {
          operationId: "takeover",
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
    });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("a")).not.toBeNull());
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
    expect(el.shadowRoot!.querySelector("wt-button")!.disabled).toBe(true);
    await expectNoA11yViolations(host);
    refuse({ code: "report.failed" });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain(t("handover_warning.unavailable")),
    );
    expect(el.shadowRoot!.querySelector("wt-button")!.disabled).toBe(false);
    await expectNoA11yViolations(host);
  });
});
