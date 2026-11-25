import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { hoursView, hoursWithPending } from "../../test/hours-fixtures.js";
import { attendanceEntry, attendancePrompt } from "../../test/attendance-fixtures.js";
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
it("shows authoritative completed totals, readable shift times and an empty calendar day", async () => {
  const { el } = await mount();
  const root = el.shadowRoot!;
  expect(root.querySelector("[data-total]")!.textContent).toContain("8 h 00 min");
  expect(root.querySelector('[data-day="2026-01-05"]')!.textContent).toContain(
    "Mon 5 Jan, 10:00–18:00",
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
    [{ date: "2026-01-06" }, true, true],
  ]);
});
it("heads a pending question card by its work day alone", async () => {
  const { el } = await mount(hoursView());
  const headings = [...el.shadowRoot!.querySelectorAll("section article h3")];
  expect(headings.map((h) => h.textContent!.trim())).toEqual(["Mon 5 Jan"]);
  expect(el.shadowRoot!.querySelector("section")!.textContent).not.toContain("The deli");
});
it("draws no heading on a pending proposal card without a work day", async () => {
  const view = hoursView();
  view.pending = {
    ...view.pending,
    prompts: [attendancePrompt({ personId: "p1", kind: "proposal", businessDay: null })],
    automaticEntryIds: [],
  };
  const { el } = await mount(view);
  expect(el.shadowRoot!.querySelectorAll("section article")).toHaveLength(1);
  expect(el.shadowRoot!.querySelector("section article h3")).toBeNull();
});
it("keeps pending outside the selected week and preserves480 until the server publishes540", async () => {
  const { el } = await mount(hoursWithPending());
  const root = el.shadowRoot!;
  expect(root.textContent).toContain("Waiting for a manager");
  expect(root.textContent).toContain("Finished the stock count");
  expect(root.textContent).toContain("Tue 13 Oct, 17:00");
  expect(root.textContent).toContain("Tue 13 Oct, 18:00");
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
  expect(root.querySelector("[data-open-shift]")!.textContent).toContain("Mon 5 Jan, 19:00");
  expect(root.textContent).toContain("Confirmed by the worker");
  expect(root.textContent).toContain("Self-approved by an admin");
  expect(root.textContent).toContain("Disputed");
  expect(root.textContent).toContain("Corrected");
  const closed = root.querySelector("[data-closure]")!;
  expect(closed.querySelector("h2")!.textContent!.trim()).toBe("January 2026 is closed");
  expect([...closed.querySelectorAll("dt, dd")].map((el) => el.textContent!.trim())).toEqual([
    "Closed total",
    "8 h 00 min",
    "Closed on",
    "1 Feb 2026, 05:00",
  ]);
  expect(closed.textContent).not.toContain(view.clock.timeZone);
  const impact = root.querySelector("[data-impact]")!;
  expect([...impact.querySelectorAll("dt, dd")].map((el) => el.textContent!.trim())).toEqual([
    "Closed total",
    "8 h 00 min",
    "Now",
    "9 h 00 min",
    "Difference",
    "+1 h 00 min",
  ]);
});
it("does not describe a replaced automatic finish as still counted", async () => {
  const view = hoursView({ pending: { prompts: [], items: [], automaticEntryIds: [] } });
  view.record.entries[0]!.effective = false;
  const { el } = await mount(view);
  expect(el.shadowRoot!.textContent).not.toContain("This automatic finish already counts");
});

it.each([
  ["en-GB", "Sun 25 Oct", "Mon 26 Oct"],
  ["es-ES", "dom 25 oct", "lun 26 oct"],
])(
  "shows both offsets of a repeated hour and spells out the next date in %s",
  async (language, day, nextDay) => {
    const view = hoursView();
    const shift = view.days[0]!.sessions[0]!;
    view.days = [
      {
        date: "2026-10-25",
        workedMinutes: 120,
        sessions: [
          {
            ...shift,
            workDate: "2026-10-25",
            startedAt: "2026-10-25T00:30:00Z",
            endedAt: "2026-10-25T01:30:00Z",
            startOffsetMinutes: 120,
            endOffsetMinutes: 60,
          },
          {
            ...shift,
            workDate: "2026-10-25",
            startedAt: "2026-10-25T22:00:00Z",
            endedAt: "2026-10-26T00:00:00Z",
            startOffsetMinutes: 60,
            endOffsetMinutes: 60,
          },
        ],
      },
    ];
    const { el } = await mount(view);
    setLocale(language);
    await el.updateComplete;
    const text = el.shadowRoot!.querySelector("[data-day]")!.textContent;
    expect(text).toContain(`${day}, 02:30 +02:00–02:30 +01:00`);
    expect(text).toContain(`${day}, 23:00–${nextDay}, 01:00`);
  },
);

it("places the missing-time question inside its open-shift card", async () => {
  const view = hoursView();
  const start = attendanceEntry({ entryKind: "in" });
  view.period = { start: "2026-01-01", end: "2026-02-01" };
  view.openShifts = [{ start, breakStart: null, questionId: "missing" }];
  view.pending.prompts = [
    attendancePrompt({ id: "missing", kind: "missing-times", history: [start] }),
  ];
  const { el } = await mount(view);
  el.manager = true;
  await el.updateComplete;
  const root = el.shadowRoot!;
  expect(root.querySelector("[data-open-shift] time")?.getAttribute("datetime")).toBe(
    start.eventAt,
  );
  expect(root.querySelector("[data-open-shift]")?.textContent).toContain("Waiting for an answer");
  expect(root.querySelectorAll("section article h3")).toHaveLength(0);
});

it("includes the year for older pending work shown beside the selected week", async () => {
  const view = hoursView();
  const entry = attendanceEntry({ eventAt: "2025-01-05T09:00:00.000Z", offsetMinutes: 60 });
  view.pending.prompts = [attendancePrompt({ businessDay: "2025-01-05", history: [entry] })];
  const { el } = await mount(view);
  const card = el.shadowRoot!.querySelector("section article")!;
  expect(card.querySelector("h3")!.textContent).toContain("5 Jan 2025");
  expect(card.querySelector("time")!.textContent).toContain("5 Jan 2025, 10:00");
});

it.each(["en-GB", "es-ES"] as const)(
  "explains credited breaks beside completed time in %s",
  async (language) => {
    const { el } = await mount();
    setLocale(language);
    await el.updateComplete;
    const total = el.shadowRoot!.querySelector("[data-total]")!;
    expect(total.nextElementSibling?.textContent?.trim()).toBe(t("hours.paidBreakNote"));
    expect(total.textContent).toContain("8 h 00 min");
  },
);
