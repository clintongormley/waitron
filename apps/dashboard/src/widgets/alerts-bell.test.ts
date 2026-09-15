import { page, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { AlertView } from "../api/client.js";
import "./alerts-bell.js";
import type { AlertsBell } from "./alerts-bell.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const event = (id: string, severity: AlertView["severity"] = "error"): AlertView => ({
  key: `incident:${id}`,
  kind: "event",
  code: "payment.offline_forward_declined",
  params: { amount: "12.50", paymentRef: `pi_${id}` },
  severity,
  since: "2026-09-14T12:00:00.000Z",
  area: "payments",
});
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
// A real ongoing check produced by a server source (feat/dashboard-alerts-ongoing): worded from its
// params and naming the screen that fixes it. The stub `ongoing` above is a bare placeholder; this
// is the first end-to-end proof that a real code's wording resolves and its "Go to" targets its own
// screen.
const jobsWaiting: AlertView = {
  key: "printer.jobs_waiting:barra",
  kind: "ongoing",
  code: "printer.jobs_waiting",
  params: { printer: "Barra", count: 2 },
  severity: "warning",
  since: "2026-09-14T12:00:00.000Z",
  area: "printing",
  screen: "printers",
};

const menu = (el: AlertsBell) => el.shadowRoot!.querySelector("wt-row-actions")!;
const popup = (el: AlertsBell) => menu(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const q = (el: AlertsBell, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const qa = (el: AlertsBell, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)];

describe("dashboard-alerts-bell", () => {
  it("counts open alerts, red when any is an error and amber otherwise, and says the count", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [event("1", "warning"), event("2", "warning")],
    });
    const badge = q(el, "wt-count-badge")!;
    expect(badge.getAttribute("tone")).toBe("warning");
    expect((badge as unknown as { count: number }).count).toBe(2);
    expect(menu(el).getAttribute("label")).toBe("Alerts, 2 open");
    el.alerts = [event("1", "warning"), event("2", "error")];
    await el.updateComplete;
    expect(badge.getAttribute("tone")).toBe("error");
  });

  it("lists at most five alerts with their wording, and always offers See all", async () => {
    setLocale("en-GB");
    const alerts = ["1", "2", "3", "4", "5", "6"].map((id) => event(id));
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts });
    expect(qa(el, "li")).toHaveLength(5);
    expect(qa(el, "li")[0]!.textContent).toContain("A card payment of 12.50 taken while offline");
    expect(q(el, "[data-test=alerts-see-all]")).not.toBeNull();
  });

  it("shows an empty message when nothing is open", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [] });
    expect(q(el, "[data-test=alerts-empty]")).not.toBeNull();
  });

  it("asks to handle an event without closing the panel", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [event("9")] });
    const handle = vi.fn();
    el.addEventListener("wt-alert-handle", handle);
    el.open();
    await userEvent.click(q(el, "[data-test=alert-handle]")!);
    expect(handle.mock.calls[0]![0].detail).toEqual({ incidentId: "9", key: "incident:9" });
    expect(popup(el).matches(":popover-open")).toBe(true);
  });

  it("shows loading only on the Mark handled button of the alert being handled", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [event("1"), event("2"), event("3")],
      busyKey: "incident:2",
    });
    const loading = qa(el, "[data-test=alert-handle]").map((b) => b.hasAttribute("loading"));
    expect(loading).toEqual([false, true, false]);
  });

  it("offers Go to only for an ongoing alert whose screen the session may open, and closes", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [ongoing],
      canOpen: () => false,
    });
    expect(q(el, "[data-test=alert-go-to]")).toBeNull();
    el.canOpen = (screen) => screen === "backup";
    await el.updateComplete;
    const goTo = vi.fn();
    el.addEventListener("wt-alert-go-to", goTo);
    el.open();
    await userEvent.click(q(el, "[data-test=alert-go-to]")!);
    expect(goTo.mock.calls[0]![0].detail).toEqual({ screen: "backup" });
    expect(popup(el).matches(":popover-open")).toBe(false);
  });

  it("renders a real ongoing check's wording and a Go to for its own screen, gated on permission", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [jobsWaiting],
      canOpen: () => false,
    });
    const item = qa(el, "li")[0]!.textContent!;
    // Real wording from its params, not the generic fallback or the raw code.
    expect(item).toContain("print job(s) are stuck at");
    expect(item).toContain("Barra");
    expect(item).not.toContain("Something needs attention");
    expect(item).not.toContain("printer.jobs_waiting");
    // Without the screen's permission there is no way to reach it.
    expect(q(el, "[data-test=alert-go-to]")).toBeNull();

    el.canOpen = (screen) => screen === "printers";
    await el.updateComplete;
    const goTo = q(el, "[data-test=alert-go-to]")!;
    expect(goTo.textContent).toContain("Printers");
    const emitted = vi.fn();
    el.addEventListener("wt-alert-go-to", emitted);
    el.open();
    await userEvent.click(goTo);
    expect(emitted.mock.calls[0]![0].detail).toEqual({ screen: "printers" });
  });

  it("See all asks for the screen and closes the panel", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [event("1")] });
    const seeAll = vi.fn();
    el.addEventListener("wt-alerts-see-all", seeAll);
    el.open();
    await userEvent.click(q(el, "[data-test=alerts-see-all]")!);
    expect(seeAll).toHaveBeenCalledOnce();
    expect(popup(el).matches(":popover-open")).toBe(false);
  });

  it("focusPanel moves keyboard focus to the panel's first button", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [event("1")] });
    el.open();
    el.focusPanel();
    expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=alert-handle]"));
  });

  it("focusPanel reaches See all when no alert has a button", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [] });
    el.open();
    el.focusPanel();
    expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=alerts-see-all]"));
  });

  it("shows a generic sentence and the raw code for an alert with no wording", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [{ ...event("1"), code: "mystery.thing" }],
    });
    const item = qa(el, "li")[0]!.textContent!;
    expect(item).toContain("Something needs attention");
    expect(item).toContain("mystery.thing");
  });

  it("opens full width at phone width", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(400, 800);
    try {
      const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
        alerts: [event("1")],
      });
      el.open();
      const rect = popup(el).getBoundingClientRect();
      expect(rect.width).toBeGreaterThanOrEqual(400 - 2 * 8 - 1);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(400);
    } finally {
      await page.viewport(width, height);
    }
  });

  it("opens about 44 characters wide on a desktop screen", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1280, 800);
    try {
      const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
        alerts: [event("1")],
      });
      el.open();
      // A probe in the same font as the panel says what 44ch is here.
      const probe = document.createElement("div");
      probe.style.width = "44ch";
      menu(el).shadowRoot!.append(probe);
      const expected = probe.getBoundingClientRect().width;
      probe.remove();
      expect(popup(el).getBoundingClientRect().width).toBeCloseTo(expected, 0);
    } finally {
      await page.viewport(width, height);
    }
  });

  // 44ch is wider than a 400px viewport, so the test above passes on the viewport cap alone; this one
  // needs the rule that fills the width wherever the shell shows its sidebar as a drawer.
  it("opens full width on a narrow screen wider than the panel", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(600, 800);
    try {
      const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
        alerts: [event("1")],
      });
      el.open();
      expect(popup(el).getBoundingClientRect().width).toBeGreaterThanOrEqual(600 - 2 * 8 - 1);
    } finally {
      await page.viewport(width, height);
    }
  });
});
