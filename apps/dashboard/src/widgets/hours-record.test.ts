import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { hoursView, hoursWithPending } from "../../test/hours-fixtures.js";
import type { HoursRecord } from "./hours-record.js";
const modules = import.meta.glob<typeof import("./hours-record.js")>("./hours-record.ts");
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
async function mount(view = hoursView(), dayActionLabel = "") {
  const load = modules["./hours-record.ts"];
  expect(load, "shared hours record").toBeTypeOf("function");
  await load!();
  setLocale("en-GB");
  return mountWidget<HoursRecord>("dashboard-hours-record", { view, dayActionLabel });
}
it("shows authoritative completed totals, stored full times and an empty calendar day", async () => {
  const { el } = await mount();
  const root = el.shadowRoot!;
  expect(root.querySelector("[data-total]")!.textContent).toContain("8 h 00 min");
  expect(root.querySelector('[data-day="2026-01-05"]')!.textContent).toContain(
    "2026-01-05 10:00 +01:00",
  );
  expect(root.querySelector('[data-day="2026-01-05"]')!.textContent).toContain(
    "2026-01-05 18:00 +01:00",
  );
  expect(root.querySelector('[data-day="2026-01-06"]')!.textContent).toContain("No recorded times");
  expect(root.textContent).toContain("This automatic finish already counts");
  expect(root.querySelector("[data-fix]")).toBeNull();
});
it("offers a calendar-day event only with a supplied action label", async () => {
  const { el, host } = await mount(hoursView(), "Fix my hours");
  const seen: CustomEvent[] = [];
  host.addEventListener("hours-day", (e) => seen.push(e as CustomEvent));
  await userEvent.click(el.shadowRoot!.querySelector('[data-fix="2026-01-06"]')!);
  expect(seen.map((e) => [e.detail, e.bubbles, e.composed])).toEqual([
    [{ date: "2026-01-06", locationId: "venue" }, true, true],
  ]);
});
it("keeps pending outside the selected week and preserves480 until the server publishes540", async () => {
  const { el } = await mount(hoursWithPending());
  const root = el.shadowRoot!;
  expect(root.textContent).toContain("Waiting for a manager");
  expect(root.textContent).toContain("Finished the stock count");
  expect(root.textContent).toContain("2026-10-13 17:00 +02:00");
  expect(root.textContent).toContain("2026-10-13 18:00 +02:00");
  expect(root.querySelector("[data-total]")!.textContent).toContain("8 h 00 min");
  el.view = hoursView({
    workedMinutes: 540,
    pending: { prompts: [], items: [], automaticEntryIds: [] },
  });
  await el.updateComplete;
  expect(root.querySelector("[data-total]")!.textContent).toContain("9 h 00 min");
  expect(root.textContent).not.toContain("Waiting for a manager");
});
it("separates open break, worker acknowledgement, frozen month and later impact", async () => {
  const view = hoursView();
  view.openShifts = [
    {
      start: { ...view.record.entries[0]!.entry, entryKind: "in" },
      breakStart: {
        ...view.record.entries[0]!.entry,
        entryKind: "break_start",
        offsetMinutes: 120,
      },
    },
  ];
  view.record.entries[0]!.confirmedByWorker = true;
  view.record.entries[0]!.selfApproved = true;
  view.record.entries[0]!.disputed = true;
  view.record.entries[0]!.corrected = true;
  view.closures = [
    {
      closureId: "frozen",
      period: { start: "2026-01-01", end: "2026-02-01" },
      clock: view.clock,
      scheduledCloseAt: "2026-02-01T04:00Z",
      closedAt: "2026-02-01T04:00Z",
      closureHash: "stored",
      frozenWorkedMinutes: 480,
    },
  ];
  view.record.closedPeriodImpacts = [
    {
      closureId: "frozen",
      personId: "p1",
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ];
  const { el } = await mount(view);
  const root = el.shadowRoot!;
  expect(root.querySelector("[data-open-shift]")!.textContent).toContain("2026-01-05 19:00 +02:00");
  expect(root.textContent).toContain("Confirmed by the worker");
  expect(root.textContent).toContain("Self-approved by an admin");
  expect(root.textContent).toContain("Disputed");
  expect(root.textContent).toContain("Corrected");
  expect(root.querySelector("[data-closure]")!.textContent).toContain("2026-01-31");
  expect(root.querySelector("[data-closure]")!.textContent).toContain("8 h 00 min");
  expect(root.querySelector("[data-impact]")!.textContent).toContain("+1 h 00 min");
});
it("does not describe a replaced automatic finish as still counted", async () => {
  const view = hoursView({ pending: { prompts: [], items: [], automaticEntryIds: [] } });
  view.record.entries[0]!.effective = false;
  const { el } = await mount(view);
  expect(el.shadowRoot!.textContent).not.toContain("This automatic finish already counts");
});
