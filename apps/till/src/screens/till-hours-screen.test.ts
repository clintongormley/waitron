import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { mountWidget, cleanupWidgets } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { hoursView, hoursWithPending } from "../../test/hours-fixtures.js";
import { attendanceItem, attendancePrompt } from "../../test/attendance-fixtures.js";
import type { TillHoursScreen } from "./till-hours-screen.js";
const modules = import.meta.glob<typeof import("./till-hours-screen.js")>("./till-hours-screen.ts");
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
async function mount(props: Partial<TillHoursScreen> = {}) {
  const load = modules["./till-hours-screen.ts"];
  expect(load, "My hours screen").toBeTypeOf("function");
  await load!();
  setLocale("en-GB");
  return mountWidget<TillHoursScreen>("till-hours-screen", {
    view: hoursView(),
    locations: [
      { id: "venue", name: "Deli", timeZone: "Europe/Madrid" },
      { id: "old", name: "Old workplace", timeZone: "UTC" },
    ],
    ...props,
  });
}
it("shows calendar days, stored full start/end times and completed totals without elapsed guessing", async () => {
  const { el } = await mount();
  const root = el.shadowRoot!;
  expect(root.textContent).toContain("My hours");
  expect(root.querySelector("[data-total]")!.textContent).toContain("8 h 00 min");
  expect(root.querySelector('[data-day="2026-01-05"]')!.textContent).toContain(
    "2026-01-05 10:00 +01:00",
  );
  expect(root.querySelector('[data-day="2026-01-05"]')!.textContent).toContain(
    "2026-01-05 18:00 +01:00",
  );
  expect(root.querySelector('[data-day="2026-01-06"]')!.textContent).toContain("No recorded times");
  expect(root.textContent).toContain("This automatic finish already counts");
});
it("pending retimes leave480 counted and show both original and requested history", async () => {
  const { el } = await mount({ view: hoursWithPending() });
  expect(el.shadowRoot!.querySelector("[data-total]")!.textContent).toContain("8 h 00 min");
  expect(el.shadowRoot!.textContent).toContain("Waiting for a manager");
  expect(el.shadowRoot!.textContent).toContain("Finished the stock count");
  expect(el.shadowRoot!.textContent).toContain("2026-10-13 17:00 +02:00");
  expect(el.shadowRoot!.textContent).toContain("2026-10-13 18:00 +02:00");
  const next = hoursView({ workedMinutes: 540 });
  next.pending = { prompts: [], items: [], automaticEntryIds: [] };
  el.view = next;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-total]")!.textContent).toContain("9 h 00 min");
  expect(el.shadowRoot!.textContent).not.toContain("Waiting for a manager");
});
it("an open break stays separate from totals and retains its stored offset", async () => {
  const view = hoursView({
    workedMinutes: 0,
    days: [],
    record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
    pending: { prompts: [], items: [], automaticEntryIds: [] },
  });
  view.openShifts = [
    {
      start: { ...hoursView().record.entries[0]!.entry, entryKind: "in" },
      breakStart: {
        ...hoursView().record.entries[0]!.entry,
        entryKind: "break_start",
        offsetMinutes: 120,
      },
    },
  ];
  const { el } = await mount({ view });
  expect(el.shadowRoot!.querySelector("[data-total]")!.textContent).toContain("0 h 00 min");
  expect(el.shadowRoot!.querySelector("[data-open-shift]")!.textContent).toContain("On a break");
  expect(el.shadowRoot!.querySelector("[data-open-shift]")!.textContent).toContain(
    "2026-01-05 19:00 +02:00",
  );
});
it("labels the full frozen month, its480 minutes, the late+60 and stored self-approval separately", async () => {
  const view = hoursView({ workedMinutes: 540 });
  view.closures = [
    {
      closureId: "closed",
      period: { start: "2026-01-01", end: "2026-02-01" },
      clock: view.clock,
      scheduledCloseAt: "2026-02-01T04:00:00Z",
      closedAt: "2026-02-01T04:00:00Z",
      closureHash: "stored",
      frozenWorkedMinutes: 480,
    },
  ];
  view.record.closedPeriodImpacts = [
    {
      closureId: "closed",
      personId: "p1",
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ];
  view.record.entries[0]!.selfApproved = true;
  view.record.entries[0]!.corrected = true;
  view.record.entries[0]!.disputed = true;
  const { el } = await mount({ view });
  const root = el.shadowRoot!;
  expect(root.querySelector('[data-closure="closed"]')!.textContent).toContain("2026-01-01");
  expect(root.querySelector('[data-closure="closed"]')!.textContent).toContain("2026-01-31");
  expect(root.querySelector('[data-closure="closed"]')!.textContent).toContain("8 h 00 min");
  expect(root.querySelector('[data-impact="closed"]')!.textContent).toContain("+1 h 00 min");
  expect(root.textContent).toContain("Self-approved by an admin");
  expect(root.textContent).toContain("Corrected");
  expect(root.textContent).toContain("Disputed");
});
it("emits calendar day and current prompt ids once across its shadow root", async () => {
  const { el, host } = await mount();
  const seen: { name: string; detail: unknown }[] = [];
  for (const name of ["hours-day", "hours-prompt", "hours-refresh", "back"])
    host.addEventListener(name, (event) =>
      seen.push({ name, detail: (event as CustomEvent).detail }),
    );
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-fix="2026-01-05"]')!);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>('[data-prompt-action="confirm"]')!,
  );
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-refresh]")!);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-back]")!);
  expect(seen).toEqual([
    { name: "hours-day", detail: { date: "2026-01-05", locationId: "venue" } },
    { name: "hours-prompt", detail: { promptId: "question", action: "confirm" } },
    { name: "hours-refresh", detail: null },
    { name: "back", detail: null },
  ]);
});
it("selectors emit only admitted locations and use calendar arithmetic for the next window", async () => {
  const { el } = await mount();
  const select = vi.fn();
  el.addEventListener("hours-select", select);
  el.shadowRoot!.querySelector('[name="hoursLocation"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "not-offered" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(select).not.toHaveBeenCalled();
  el.shadowRoot!.querySelector('[name="hoursLocation"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "old" }, bubbles: true, composed: true }),
  );
  expect((select.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    locationId: "old",
    selection: { kind: "week", date: "2026-01-05" },
  });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-next]")!);
  expect((select.mock.calls[1]![0] as CustomEvent).detail).toEqual({
    locationId: "old",
    selection: { kind: "week", date: "2026-01-12" },
  });
});
it("loading and refusal states expose Retry without rendering a raw code or enabling stale actions", async () => {
  const { el } = await mount({ view: null, reading: true });
  expect(el.shadowRoot!.textContent).toContain("Reading your hours");
  el.reading = false;
  el.error = "Check your connection and try again.";
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("Check your connection");
  expect(el.shadowRoot!.querySelector("[data-refresh]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-prompt-action]")).toBeNull();
});
it("an automatic end replaced by an approved correction is labelled historical rather than counted", async () => {
  const view = hoursView({ pending: { prompts: [], items: [], automaticEntryIds: [] } });
  view.record.entries[0]!.effective = false;
  view.record.entries[0]!.corrected = true;
  const { el } = await mount({ view });
  expect(el.shadowRoot!.textContent).toContain("Automatic");
  expect(el.shadowRoot!.textContent).not.toContain("This automatic finish already counts");
});
it("a blocked attendance response disables day and prompt actions while preserving Back", async () => {
  const { el } = await mount({ blocked: true });
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-fix]")!.disabled,
  ).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-prompt-action]")!
      .disabled,
  ).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-back]")!.disabled,
  ).toBe(false);
});
it("month navigation crosses a year boundary from the first day rather than overflowing the selected date", async () => {
  const { el } = await mount();
  const seen: unknown[] = [];
  el.addEventListener("hours-select", (event) => seen.push((event as CustomEvent).detail));
  const change = (name: string, value: string) =>
    el
      .shadowRoot!.querySelector(`[name="${name}"]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  change("hoursDate", "2026-01-31");
  change("hoursWindow", "month");
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-previous]")!);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-next]")!);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-next]")!);
  expect(seen).toEqual([
    { locationId: "venue", selection: { kind: "week", date: "2026-01-31" } },
    { locationId: "venue", selection: { kind: "month", date: "2026-01-31" } },
    { locationId: "venue", selection: { kind: "month", date: "2025-12-01" } },
    { locationId: "venue", selection: { kind: "month", date: "2026-01-01" } },
    { locationId: "venue", selection: { kind: "month", date: "2026-02-01" } },
  ]);
});
it("refuses malformed dates, impossible dates and unsupported windows without replacing the last valid selection", async () => {
  const { el } = await mount();
  const seen: unknown[] = [];
  el.addEventListener("hours-select", (event) => seen.push((event as CustomEvent).detail));
  for (const [name, value] of [
    ["hoursDate", "tomorrow"],
    ["hoursDate", "2026-02-30"],
    ["hoursWindow", "year"],
  ])
    el.shadowRoot!.querySelector(`[name="${name}"]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  expect(seen).toEqual([]);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-next]")!);
  expect(seen).toEqual([{ locationId: "venue", selection: { kind: "week", date: "2026-01-12" } }]);
});
it("a proposal can be accepted only when ready, while disagreement and missing-time edits keep their prompt identities", async () => {
  const item = attendanceItem({ personId: "p1", locationId: "venue", readyToApply: false });
  const proposal = attendancePrompt({
    id: "proposal-prompt",
    personId: "p1",
    locationId: "venue",
    kind: "proposal",
    itemId: item.id,
    questionId: null,
    history: item.history,
  });
  const missing = attendancePrompt({
    id: "missing-prompt",
    personId: "p1",
    locationId: "venue",
    kind: "missing-times",
  });
  const view = hoursView({
    pending: { prompts: [proposal, missing], items: [item], automaticEntryIds: [] },
  });
  const { el, host } = await mount({ view });
  const seen: unknown[] = [];
  host.addEventListener("hours-prompt", (event) => seen.push((event as CustomEvent).detail));
  const action = (key: string) =>
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      `[data-prompt-action="${key}"]`,
    )!;
  expect(action("accept").disabled).toBe(true);
  await userEvent.click(action("disagree"));
  await userEvent.click(action("edit"));
  el.view = { ...view, pending: { ...view.pending, items: [{ ...item, readyToApply: true }] } };
  await el.updateComplete;
  expect(action("accept").disabled).toBe(false);
  await userEvent.click(action("accept"));
  expect(seen).toEqual([
    { promptId: "proposal-prompt", action: "disagree" },
    { promptId: "missing-prompt", action: "edit" },
    { promptId: "proposal-prompt", action: "accept" },
  ]);
});
