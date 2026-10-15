import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { attendanceEntry, attendanceItem } from "../../test/attendance-fixtures.js";
import type { AttendanceDayView } from "../api/client.js";
import type { AttendanceDayDialog } from "./attendance-day-dialog.js";
import "./attendance-day-dialog.js";

afterEach(cleanupWidgets);
function view(): AttendanceDayView {
  return {
    personId: "worker",
    locationId: "deli",
    date: "2026-10-14",
    timeZone: "Europe/Madrid",
    revision: "revision",
    record: {
      sessions: [],
      closures: [],
      closedPeriodImpacts: [],
      entries: [
        {
          entry: attendanceEntry(),
          author: { kind: "automatic", personId: null },
          effective: true,
          confirmed: true,
          confirmedByWorker: false,
          selfApproved: false,
          corrected: false,
          disputed: false,
          closedPeriodIds: [],
        },
      ],
    },
    items: [attendanceItem({ direction: "worker_request", status: "waiting-manager" })],
  };
}
async function mount(props: Partial<AttendanceDayDialog> = {}) {
  const mounted = await mountWidget<AttendanceDayDialog>("till-attendance-day-dialog", {
    open: true,
    view: view(),
    date: "2026-10-14",
    locationId: "deli",
    locations: [
      { id: "deli", name: "The deli", timeZone: "Europe/Madrid" },
      { id: "old", name: "Old location", timeZone: "Atlantic/Canary" },
    ],
    ...props,
  });
  await mounted.el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return mounted;
}
function watch(el: HTMLElement, type: string) {
  const seen: CustomEvent[] = [];
  el.addEventListener(type, (event) => seen.push(event as CustomEvent));
  return seen;
}
function button(el: AttendanceDayDialog, selector: string) {
  return el.shadowRoot!.querySelector<HTMLElement>(selector)!;
}

describe("chosen-day attendance detail", () => {
  it("uncertain day actions offer separate receipt reads and explicit response retries", async () => {
    const { el } = await mount({ blocked: true, canRetry: true, error: "The answer was lost." });
    const reads = watch(el, "retry-attendance");
    const retries = watch(el, "retry-attendance-command");
    const fixes = watch(el, "fix-entry");
    expect(button(el, "[data-fix-entry]").hasAttribute("disabled")).toBe(true);
    await userEvent.click(button(el, "[data-retry]"));
    await userEvent.click(button(el, "[data-retry-command]"));
    expect(reads.map((event) => [event.bubbles, event.composed])).toEqual([[true, true]]);
    expect(retries.map((event) => [event.bubbles, event.composed])).toEqual([[true, true]]);
    expect(fixes).toEqual([]);
    el.reading = true;
    await el.updateComplete;
    expect(button(el, "[data-retry]").hasAttribute("disabled")).toBe(true);
    expect(button(el, "[data-retry-command]").hasAttribute("disabled")).toBe(true);
    button(el, "[data-retry]").click();
    button(el, "[data-retry-command]").click();
    expect(reads).toHaveLength(1);
    expect(retries).toHaveLength(1);
    el.reading = false;
    el.busy = true;
    await el.updateComplete;
    button(el, "[data-retry]").click();
    expect(reads).toHaveLength(1);
    const retry = button(el, "[data-retry-command]");
    el.remove();
    retry.click();
    expect(retries).toHaveLength(1);
  });

  it("shows effective stored times and their automatic/worker confirmation separately", async () => {
    const { el } = await mount();
    const time = el.shadowRoot!.querySelector("[data-effective] time")!;
    expect(time.textContent).toBe("2026-10-14 01:30 +02:00");
    expect(time.getAttribute("datetime")).toBe("2026-10-13T23:30:00.000Z");
    expect(el.shadowRoot!.textContent).toContain(
      "This automatic finish already counts towards your hours.",
    );
    expect(el.shadowRoot!.textContent).not.toContain("Confirmed by the worker");
    const next = view();
    next.record.entries[0]!.confirmedByWorker = true;
    el.view = next;
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("Confirmed by the worker");
  });

  it("retimes the effective event and offers explicit missing-event and complementary-pair targets", async () => {
    const { el } = await mount();
    const fixes = watch(el, "fix-entry");
    await userEvent.click(button(el, "[data-fix-entry]"));
    await userEvent.click(button(el, '[data-add-kind="in"]'));
    await userEvent.click(button(el, '[data-add-pair="shift"]'));
    await userEvent.click(button(el, '[data-add-pair="break"]'));
    expect(fixes.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [{ target: { entryId: "automatic-out" } }, true, true],
      [{ target: { missingKind: "in" } }, true, true],
      [{ targets: [{ missingKind: "in" }, { missingKind: "out" }] }, true, true],
      [{ targets: [{ missingKind: "break_start" }, { missingKind: "break_end" }] }, true, true],
    ]);
  });

  it("pending worker requests can be approved or declined by an explicitly selected PIN approver", async () => {
    const { el } = await mount();
    const decisions = watch(el, "decide-item");
    expect(el.shadowRoot!.textContent).toContain("Waiting for a manager");
    await userEvent.click(button(el, "[data-approve]"));
    await userEvent.click(button(el, "[data-decline]"));
    expect(decisions.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [{ itemId: "proposal", action: "approve" }, true, true],
      [{ itemId: "proposal", action: "decline" }, true, true],
    ]);
    const next = view();
    next.items[0]!.readyToApply = false;
    el.view = next;
    await el.updateComplete;
    expect(button(el, "[data-approve]").hasAttribute("disabled")).toBe(true);
    expect(button(el, "[data-decline]").hasAttribute("disabled")).toBe(false);
  });

  it("terminal/disputed/proposed history stays visible without manager settlement buttons", async () => {
    const data = view();
    data.items = [
      attendanceItem({ status: "disputed" }),
      attendanceItem({ id: "other", status: "approved", selfApproved: true }),
      attendanceItem({ id: "waiting", status: "waiting-worker" }),
    ];
    const { el } = await mount({ view: data });
    expect(el.shadowRoot!.textContent).toContain("Disputed — both versions stay on record");
    expect(el.shadowRoot!.textContent).toContain("Self-approved by an admin");
    expect(el.shadowRoot!.textContent).toContain("Waiting for the worker");
    expect(el.shadowRoot!.querySelector("[data-approve]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-decline]")).toBeNull();
    expect(
      [...el.shadowRoot!.querySelectorAll("[data-item] time")].map((t) => t.textContent),
    ).toContain("2026-10-13 17:00 +02:00");
    expect(el.shadowRoot!.textContent).toContain("Finished the stock count");
  });

  it("date and location selectors request the exact selection and hide stale actions immediately", async () => {
    const { el } = await mount();
    const days = watch(el, "attendance-day");
    const date = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
      "wt-input[name=attendanceDay]",
    )!;
    await date.updateComplete;
    await userEvent.fill(
      page.elementLocator(date.shadowRoot!.querySelector("input")!),
      "2026-10-15",
    );
    await el.updateComplete;
    expect(days.map((event) => event.detail)).toEqual([{ date: "2026-10-15", locationId: "deli" }]);
    expect(el.shadowRoot!.querySelector("[data-fix-entry]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-approve]")).toBeNull();
    const location = el.shadowRoot!.querySelector<import("@waitron/ui").WtCombobox>(
      "wt-combobox[name=attendanceLocation]",
    )!;
    await location.updateComplete;
    await userEvent.click(location.shadowRoot!.querySelector<HTMLElement>("button.trigger")!);
    await userEvent.click(
      [...location.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find((option) =>
        option.textContent!.includes("Old location"),
      )!,
    );
    expect(days.map((event) => event.detail)).toEqual([
      { date: "2026-10-15", locationId: "deli" },
      { date: "2026-10-15", locationId: "old" },
    ]);
  });

  it("a successful read can show no entries and still offer missing times", async () => {
    const data = view();
    data.record.entries = [];
    data.items = [];
    const { el } = await mount({ view: data });
    expect(el.shadowRoot!.textContent).toContain("No recorded times on this date.");
    expect(button(el, '[data-add-pair="shift"]').hasAttribute("disabled")).toBe(false);
  });

  it("loading/unknown day prevents writes, while a request refusal alone does not", async () => {
    const { el } = await mount({ reading: true });
    expect(el.shadowRoot!.querySelector("[data-fix-entry]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-approve]")).toBeNull();
    el.reading = false;
    el.error = "A manager could not approve the request";
    await el.updateComplete;
    expect(button(el, "[data-approve]").hasAttribute("disabled")).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=status]")!.textContent).toBe(
      "A manager could not approve the request",
    );
    el.busy = true;
    await el.updateComplete;
    expect(button(el, "[data-approve]").hasAttribute("disabled")).toBe(true);
  });

  it("Cancel closes without a save and detached controls cannot fix or decide", async () => {
    const { el } = await mount();
    const closes = watch(el, "attendance-day-close");
    const fixes = watch(el, "fix-entry");
    const fix = button(el, "[data-fix-entry]");
    const closed = new Promise((resolve) =>
      el.addEventListener("attendance-day-close", resolve, { once: true }),
    );
    await userEvent.click(button(el, "[data-close]"));
    await closed;
    expect(closes).toHaveLength(1);
    expect(fixes).toEqual([]);
    el.remove();
    fix.click();
    expect(fixes).toEqual([]);
  });
});
