import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { HolidayFact } from "../hours-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import {
  frame,
  grid,
  painterModel,
  part,
  settle,
  specialDayApi,
  storedDay,
  type SpecialDayAnswers,
  type Write,
} from "../testing/special-day-painter-fixture.js";
import "./special-day-painter.js";

let painter: SpecialDayPainter | undefined;
beforeEach(() => setLocale("en"));
afterEach(() => {
  painter?.remove();
  painter = undefined;
  setLocale("en");
});

interface Options extends SpecialDayAnswers {
  specialDayId?: string | null;
  date?: string | null;
  holidays?: readonly HolidayFact[];
  readOnly?: boolean;
}
async function mount(options: Options = {}) {
  const writes: Write[] = [];
  const events: { type: string; detail: unknown }[] = [];
  painter = document.createElement("special-day-painter");
  painter.api = specialDayApi(writes, { days: { sd1: storedDay() }, ...options });
  painter.model = painterModel();
  painter.specialDayId = options.specialDayId === undefined ? "sd1" : options.specialDayId;
  painter.date = options.date ?? null;
  painter.holidays = options.holidays ?? [];
  painter.readOnly = options.readOnly ?? false;
  painter.open = true;
  for (const type of ["special-day-saved", "special-day-deleted", "painter-close"])
    painter.addEventListener(type, (event) =>
      events.push({ type, detail: (event as CustomEvent).detail }),
    );
  applyTokens(painter);
  document.body.append(painter);
  await loaded(painter);
  return { painter, writes, events };
}
async function loaded(el: SpecialDayPainter) {
  await settle(el);
  await expect.poll(() => part(el, "loading")).toBeNull();
  await settle(el);
}
const holiday = (date: string, name: string): HolidayFact => ({
  id: `h-${date}`,
  date,
  name,
  scope: "national",
  sourceId: "es",
});
const chips = (el: SpecialDayPainter) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=date-chip]")].map(
    (chip) => chip.dataset.date,
  );
const tick = (el: SpecialDayPainter, date: string) =>
  el.shadowRoot!.querySelector<HTMLInputElement>(`input[name="closed.${date}"]`)!;
const saveButton = (el: SpecialDayPainter) =>
  frame(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
async function typeName(el: SpecialDayPainter, value: string) {
  el.shadowRoot!.querySelector("wt-input[name=name]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function addDates(el: SpecialDayPainter, dates: string[]) {
  if (!el.shadowRoot!.querySelector("add-dates-calendar")) {
    part(el, "add-dates")!.click();
    await settle(el);
  }
  el.shadowRoot!.querySelector("add-dates-calendar")!.dispatchEvent(
    new CustomEvent("add-dates", { detail: { dates }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function save(el: SpecialDayPainter, writes: Write[]) {
  const before = writes.length;
  saveButton(el).click();
  await expect.poll(() => writes.length).toBe(before + 1);
  await expect.poll(() => frame(el).busy).toBe(false);
  await settle(el);
}

describe("a stored special day", () => {
  it("opens on its stored facts: name, a chip and a column per date, and each date's Closed tick", async () => {
    const { painter } = await mount();
    expect(frame(painter).heading).toBe("Christmas dinners");
    expect(
      painter.shadowRoot!.querySelector<HTMLElement & { value: string }>("wt-input[name=name]")!
        .value,
    ).toBe("Christmas dinners");
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-25"]);
    expect(grid(painter).columns).toEqual([
      { key: "2026-12-14", label: "Mon 14 Dec" },
      { key: "2026-12-15", label: "Tue 15 Dec" },
      { key: "2026-12-25", label: "Fri 25 Dec" },
    ]);
    expect([tick(painter, "2026-12-14").checked, tick(painter, "2026-12-25").checked]).toEqual([
      false,
      true,
    ]);
    expect(tick(painter, "2026-12-14").closest("label")!.slot).toBe("column-head-2026-12-14");
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("labels its columns in the dashboard's language and never with the business-day window", async () => {
    setLocale("es");
    const { painter } = await mount();
    const labels = grid(painter).columns.map(({ label }) => label);
    expect(labels[0]).toMatch(/^lun\.? 14 dic/);
    const headings = [...grid(painter).shadowRoot!.querySelectorAll(".heading")].map(
      (heading) => heading.textContent ?? "",
    );
    expect(headings.some((text) => text.includes("→"))).toBe(false);
    expect(labels.some((text) => text.includes("→"))).toBe(false);
  });

  it("a change of special day reseeds from the new one, and a read that lands late is dropped", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const other = storedDay({
      id: "sd2",
      name: "Fair week",
      dates: [{ date: "2027-04-20", closedAllDay: false }],
    });
    const { painter } = await mount({ days: { sd1: storedDay(), sd2: other } });
    await typeName(painter, "Edited");
    const api = painter.api.specialDays;
    const read = api.readSpecialDay.bind(api);
    api.readSpecialDay = async (id, options) => {
      const detail = await read(id, options);
      if (id === "sd1") await slow;
      return detail;
    };
    painter.specialDayId = "sd1";
    painter.specialDayId = "sd2";
    await loaded(painter);
    expect(frame(painter).heading).toBe("Fair week");
    expect(chips(painter)).toEqual(["2027-04-20"]);
    expect(saveButton(painter).disabled).toBe(true);
    painter.specialDayId = "sd1";
    await settle(painter);
    painter.specialDayId = "sd2";
    await loaded(painter);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle(painter);
    expect(frame(painter).heading).toBe("Fair week");
  });

  it("a read that fails says so beside Save and offers nothing to save", async () => {
    const { painter } = await mount({ specialDayId: "gone" });
    expect(frame(painter).refusal).toBe("This special day could not be loaded.");
    expect(saveButton(painter).disabled).toBe(true);
  });
});

describe("a new special day", () => {
  it("starts on the date it was opened on, with no name, and offers no Delete", async () => {
    const { painter } = await mount({ specialDayId: null, date: "2026-12-24" });
    expect(frame(painter).heading).toBe("New special day");
    expect(chips(painter)).toEqual(["2026-12-24"]);
    expect(grid(painter).columns.map(({ key }) => key)).toEqual(["2026-12-24"]);
    expect(part(painter, "delete")).toBeNull();
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("starts with no dates when opened on none", async () => {
    const { painter } = await mount({ specialDayId: null });
    expect(chips(painter)).toEqual([]);
    expect(grid(painter).columns).toEqual([]);
  });
});

describe("dates", () => {
  it("adds the calendar's dates once each, in order, and a chip's remove takes its date and column away", async () => {
    const { painter } = await mount();
    await addDates(painter, ["2026-12-31", "2026-12-10", "2026-12-14"]);
    expect(chips(painter)).toEqual([
      "2026-12-10",
      "2026-12-14",
      "2026-12-15",
      "2026-12-25",
      "2026-12-31",
    ]);
    expect(grid(painter).columns.map(({ key }) => key)).toEqual(chips(painter));
    expect(painter.shadowRoot!.querySelector("add-dates-calendar")!.selected).toEqual(
      chips(painter),
    );
    painter
      .shadowRoot!.querySelector<HTMLElement>(
        '[data-test=date-chip][data-date="2026-12-15"] [data-test=remove-date]',
      )!
      .click();
    await settle(painter);
    expect(chips(painter)).toEqual(["2026-12-10", "2026-12-14", "2026-12-25", "2026-12-31"]);
    expect(grid(painter).columns.map(({ key }) => key)).not.toContain("2026-12-15");
  });

  it("the calendar opens on the first date's month and marks dates other special days hold, not this one's", async () => {
    const { painter } = await mount({
      taken: [
        { date: "2026-12-14", id: "sd1", name: "Christmas dinners" },
        { date: "2026-12-31", id: "sd9", name: "New Year" },
      ],
    });
    part(painter, "add-dates")!.click();
    await settle(painter);
    const calendar = painter.shadowRoot!.querySelector("add-dates-calendar")!;
    expect(calendar.month).toBe("2026-12");
    await expect.poll(() => [...calendar.taken]).toEqual([["2026-12-31", "New Year"]]);
    calendar.dispatchEvent(
      new CustomEvent("month-change", {
        detail: { month: "2027-01" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(painter);
    expect(calendar.month).toBe("2027-01");
    await expect.poll(() => calendar.taken.size).toBe(0);
    part(painter, "add-dates")!.click();
    await settle(painter);
    expect(painter.shadowRoot!.querySelector("add-dates-calendar")).toBeNull();
  });

  it("a date's Closed tick changes that date alone", async () => {
    const { painter, writes } = await mount();
    tick(painter, "2026-12-15").click();
    await settle(painter);
    expect([
      tick(painter, "2026-12-14").checked,
      tick(painter, "2026-12-15").checked,
      tick(painter, "2026-12-25").checked,
    ]).toEqual([false, true, true]);
    await save(painter, writes);
    expect((writes[0]!.body as { dates: unknown }).dates).toEqual([
      { date: "2026-12-14", closedAllDay: false },
      { date: "2026-12-15", closedAllDay: true },
      { date: "2026-12-25", closedAllDay: true },
    ]);
  });

  it("read-only, the ticks, the name, the dates and Every year cannot change and there is no Delete", async () => {
    const { painter } = await mount({ readOnly: true });
    expect(tick(painter, "2026-12-14").disabled).toBe(true);
    expect(
      painter.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("wt-input[name=name]")!
        .disabled,
    ).toBe(true);
    expect(part(painter, "add-dates")).toBeNull();
    expect(part(painter, "remove-date")).toBeNull();
    expect(
      [
        ...painter.shadowRoot!.querySelectorAll<HTMLInputElement>("input[name=repeatsYearly]"),
      ].every((input) => input.disabled),
    ).toBe(true);
    expect(part(painter, "delete")).toBeNull();
  });
});

describe("Every year", () => {
  const note = (el: SpecialDayPainter) => part(el, "holiday-note");

  it("shows the holiday note for a stored date saved on a holiday, and not once that date is removed", async () => {
    const { painter } = await mount();
    expect(note(painter)!.textContent!.trim()).toBe(
      "Every year follows the holiday's name to its date each year.",
    );
    painter
      .shadowRoot!.querySelector<HTMLElement>(
        '[data-test=date-chip][data-date="2026-12-25"] [data-test=remove-date]',
      )!
      .click();
    await settle(painter);
    expect(note(painter)).toBeNull();
  });

  it("shows it for a new date on a public holiday, and not for an ordinary one", async () => {
    const holidays = [holiday("2026-12-08", "Inmaculada Concepción")];
    const { painter } = await mount({ specialDayId: null, date: "2026-12-07", holidays });
    expect(note(painter)).toBeNull();
    await addDates(painter, ["2026-12-08"]);
    expect(note(painter)).not.toBeNull();
  });

  it("No and Yes set whether it repeats; Yes on 29 February warns it repeats only in leap years", async () => {
    const { painter, writes } = await mount({ specialDayId: null, date: "2028-02-29" });
    const choice = (value: string) =>
      painter.shadowRoot!.querySelector<HTMLInputElement>(
        `input[name=repeatsYearly][value=${value}]`,
      )!;
    expect(choice("no").checked).toBe(true);
    expect(part(painter, "leap-note")).toBeNull();
    choice("yes").click();
    await settle(painter);
    expect(part(painter, "leap-note")!.textContent!.trim()).toBe("Repeats only in leap years");
    await typeName(painter, "Leap");
    await save(painter, writes);
    expect((writes[0]!.body as { repeatsYearly: boolean }).repeatsYearly).toBe(true);
  });

  it("explains that the season shows through", async () => {
    const { painter } = await mount();
    expect(part(painter, "explain")!.textContent).toContain("season");
  });
});

describe("Delete", () => {
  const dialog = (el: SpecialDayPainter) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
      "wt-dialog[data-test=delete-special-day]",
    );

  it("asks first; Cancel keeps it; confirming deletes it once with the revision, says so, and closes", async () => {
    const { painter, writes, events } = await mount();
    part(painter, "delete")!.click();
    await settle(painter);
    expect(dialog(painter)!.open).toBe(true);
    expect(dialog(painter)!.textContent).toContain("Delete Christmas dinners?");
    part(painter, "cancel-delete")!.click();
    await settle(painter);
    expect(dialog(painter)).toBeNull();
    expect(writes).toEqual([]);
    part(painter, "delete")!.click();
    await settle(painter);
    part(painter, "confirm-delete")!.click();
    await expect.poll(() => events.some(({ type }) => type === "painter-close")).toBe(true);
    expect(writes).toEqual([
      {
        url: "/management-api/venue-service/special-days/sd1",
        method: "DELETE",
        body: { expectedClockRevision: 4 },
      },
    ]);
    expect(events.filter(({ type }) => type === "special-day-deleted")).toEqual([
      { type: "special-day-deleted", detail: { id: "sd1" } },
    ]);
    expect(painter.open).toBe(false);
  });

  it("a repeating day's question says it goes every year", async () => {
    const { painter } = await mount({ days: { sd1: storedDay({ repeatsYearly: true }) } });
    part(painter, "delete")!.click();
    await settle(painter);
    expect(dialog(painter)!.textContent).toContain("This removes it every year.");
  });

  it("a refused delete says so and keeps the painter open", async () => {
    const { painter, events } = await mount({ answer: () => ({ code: "hours.clock_changed" }) });
    part(painter, "delete")!.click();
    await settle(painter);
    part(painter, "confirm-delete")!.click();
    await expect.poll(() => part(painter, "delete-refusal")?.textContent ?? "").not.toBe("");
    expect(painter.open).toBe(true);
    expect(events).toEqual([]);
  });
});

describe("Save", () => {
  it("is quiet until a change, sends exactly the facts and the revision, and takes the answer as saved", async () => {
    const { painter, writes, events } = await mount();
    expect(saveButton(painter).disabled).toBe(true);
    await typeName(painter, "Christmas dinners ");
    expect(saveButton(painter).disabled).toBe(false);
    await typeName(painter, "Staff dinners ");
    await save(painter, writes);
    expect(writes).toEqual([
      {
        url: "/management-api/venue-service/special-days/sd1",
        method: "PUT",
        body: {
          name: "Staff dinners",
          repeatsYearly: false,
          dates: [
            { date: "2026-12-14", closedAllDay: false },
            { date: "2026-12-15", closedAllDay: false },
            { date: "2026-12-25", closedAllDay: true },
          ],
          expectedClockRevision: 4,
        },
      },
    ]);
    expect(saveButton(painter).disabled).toBe(true);
    expect(frame(painter).heading).toBe("Staff dinners");
    expect(events.map(({ type }) => type)).toEqual(["special-day-saved"]);
    expect((events[0]!.detail as { detail: SpecialDayDetail }).detail.name).toBe("Staff dinners");
  });

  it("a new day is created, then offers Delete as the stored day it now is", async () => {
    const { painter, writes } = await mount({ specialDayId: null, date: "2026-12-24" });
    await typeName(painter, "Christmas Eve");
    await save(painter, writes);
    expect(writes[0]!.method).toBe("POST");
    expect(writes[0]!.url).toBe("/management-api/venue-service/special-days");
    expect(painter.specialDayId).toBe("sd-new");
    expect(part(painter, "delete")).not.toBeNull();
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("follows the model's clock revision while nothing is edited", async () => {
    const { painter, writes } = await mount();
    painter.model = { ...painterModel(), clockRevision: 9 };
    await settle(painter);
    await typeName(painter, "Renamed");
    painter.model = { ...painterModel(), clockRevision: 12 };
    await settle(painter);
    await save(painter, writes);
    expect((writes[0]!.body as { expectedClockRevision: number }).expectedClockRevision).toBe(9);
  });

  it("an empty name is marked beside the field and once beside Save, and nothing is sent", async () => {
    const { painter, writes } = await mount();
    await typeName(painter, "  ");
    saveButton(painter).click();
    await settle(painter);
    expect(writes).toEqual([]);
    expect(
      painter.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=name]")!
        .error,
    ).toBe("Enter a name.");
    expect(frame(painter).refusal).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(painter).disabled).toBe(true);
    await typeName(painter, "Fixed");
    expect(frame(painter).refusal).toBe("");
    expect(saveButton(painter).disabled).toBe(false);
  });

  it("no dates is marked under Dates", async () => {
    const { painter, writes } = await mount({ specialDayId: null, date: "2026-12-24" });
    await typeName(painter, "Empty");
    part(painter, "remove-date")!.click();
    await settle(painter);
    saveButton(painter).click();
    await settle(painter);
    expect(writes).toEqual([]);
    expect(part(painter, "dates-error")!.textContent!.trim()).toBe("Add at least one date.");
  });

  it("a refusal keeps the draft and shows beside Save; a retry sends it again and succeeds", async () => {
    const refusals: unknown[] = [
      {
        code: "special_day.date_taken",
        params: { date: "2026-12-15", name: "Staff party", specialDayId: "sd7" },
      },
    ];
    const { painter, writes } = await mount({
      answer: () => (refusals.length ? refusals.shift() : undefined),
    });
    await typeName(painter, "Renamed");
    await save(painter, writes);
    expect(frame(painter).refusal).toBe("Staff party already holds Tue, 15 Dec 2026.");
    expect(grid(painter).columnErrors.get("2026-12-15")).toBe(frame(painter).refusal);
    expect(frame(painter).heading).toBe("Renamed");
    expect(saveButton(painter).disabled).toBe(false);
    await save(painter, writes);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.body).toEqual(writes[0]!.body);
    expect(frame(painter).refusal).toBe("");
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("maps the other refusals to their messages", async () => {
    const cases: [unknown, string][] = [
      [{ code: "hours.clock_changed" }, "The business-day start changed. Reload hours."],
      [
        { code: "special_day.invalid", params: { field: "dates.1.date", reason: "overlap" } },
        "Tue, 15 Dec 2026 meets another of these dates.",
      ],
      [{ code: "special_day.invalid", params: { field: "name" } }, "Check this field."],
      [{ code: "server.internal" }, "This could not be saved. Try again."],
    ];
    for (const [refusal, message] of cases) {
      const { painter, writes } = await mount({ answer: () => refusal });
      await typeName(painter, "Renamed");
      await save(painter, writes);
      expect(frame(painter).refusal).toBe(message);
      painter.remove();
    }
  });
});

it("at 390px the side panel sits above the dates and nothing scrolls sideways", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 844);
    const { painter } = await mount();
    const body = frame(painter)
      .shadowRoot!.querySelector("wt-modal")!
      .shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    const panel = part(painter, "panel")!.getBoundingClientRect();
    expect(panel.right).toBeLessThanOrEqual(390);
    expect(panel.bottom).toBeLessThanOrEqual(grid(painter).getBoundingClientRect().top + 1);
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});

describe("edges", () => {
  const paintedDay = () =>
    storedDay({
      paint: [
        {
          departmentId: "d1",
          date: "2026-12-14",
          ranges: [{ periodId: "p2", startsAt: "20:00", endsAt: "21:00" }],
        },
      ],
      zonePaint: [
        {
          zoneId: "z2",
          date: "2026-12-14",
          ranges: [
            { kind: "open", startsAt: "13:00", endsAt: "15:00" },
            { kind: "closed", startsAt: "15:00", endsAt: "17:00" },
          ],
        },
      ],
    });
  const removeChip = async (el: SpecialDayPainter, date: string) => {
    el.shadowRoot!.querySelector<HTMLElement>(
      `[data-test=date-chip][data-date="${date}"] [data-test=remove-date]`,
    )!.click();
    await settle(el);
  };

  it("removing a date takes its stored paint with it: adding the date back is still a change", async () => {
    const { painter } = await mount({ days: { sd1: paintedDay() } });
    await removeChip(painter, "2026-12-15");
    await addDates(painter, ["2026-12-15"]);
    expect(saveButton(painter).disabled).toBe(true);
    await removeChip(painter, "2026-12-14");
    await addDates(painter, ["2026-12-14"]);
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-25"]);
    expect(saveButton(painter).disabled).toBe(false);
  });

  it("dates the draft already holds add nothing", async () => {
    const { painter } = await mount();
    await addDates(painter, ["2026-12-14", "2026-12-14"]);
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-25"]);
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("a new day with no dates opens the calendar on the business date's month; a failed month read marks nothing", async () => {
    const { painter } = await mount({
      specialDayId: null,
      failingMonths: ["2026-12"],
      taken: [{ date: "2026-12-31", id: "sd9", name: "New Year" }],
    });
    part(painter, "add-dates")!.click();
    await settle(painter);
    const calendar = painter.shadowRoot!.querySelector("add-dates-calendar")!;
    expect(calendar.month).toBe("2026-12");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calendar.taken.size).toBe(0);
  });

  it("a save's answer that lands after the painter moved to another special day is dropped", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const other = storedDay({ id: "sd2", name: "Fair week" });
    const { painter, writes, events } = await mount({
      days: { sd1: storedDay(), sd2: other },
      answer: async () => {
        await held;
        return undefined;
      },
    });
    await typeName(painter, "Renamed");
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    painter.specialDayId = "sd2";
    await loaded(painter);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle(painter);
    expect(frame(painter).heading).toBe("Fair week");
    expect(frame(painter).busy).toBe(false);
    expect(events).toEqual([]);
  });

  it("a date refusal on a date that is not a column marks no column; a refusal naming no date shows beside Save only", async () => {
    const cases: [unknown, string][] = [
      [
        {
          code: "special_day.date_taken",
          params: { date: "2027-12-15", name: "Staff party", specialDayId: "sd7" },
        },
        "Staff party already holds Wed, 15 Dec 2027.",
      ],
      [
        { code: "special_day.invalid", params: { field: "dates.0.closedAllDay" } },
        "Check this field.",
      ],
      [
        { code: "special_day.invalid", params: { field: "paint.0" } },
        "This could not be saved. Try again.",
      ],
    ];
    for (const [refusal, message] of cases) {
      const { painter, writes } = await mount({ answer: () => refusal });
      await typeName(painter, "Renamed");
      await save(painter, writes);
      expect(frame(painter).refusal).toBe(message);
      const marked = [...grid(painter).columnErrors.keys()];
      expect(marked).toEqual(message === "Check this field." ? ["2026-12-14"] : []);
      painter.remove();
    }
  });

  it("a delete refused for another reason says it could not be saved; Escape leaves the question", async () => {
    const { painter } = await mount({ answer: () => ({ code: "server.internal" }) });
    part(painter, "delete")!.click();
    await settle(painter);
    part(painter, "confirm-delete")!.click();
    await expect
      .poll(() => part(painter, "delete-refusal")?.textContent ?? "")
      .toBe("The change could not be saved.");
    const dialog = painter.shadowRoot!.querySelector("wt-dialog")!;
    const closed = new Promise((resolve) => dialog.addEventListener("wt-close", resolve));
    void dialog.requestClose("escape");
    await closed;
    await settle(painter);
    expect(painter.shadowRoot!.querySelector("wt-dialog")).toBeNull();
    expect(painter.open).toBe(true);
  });
});
