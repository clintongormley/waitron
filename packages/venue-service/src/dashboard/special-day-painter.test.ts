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
import { t } from "./strings.js";
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
  addDate?: string | null;
  holidays?: readonly HolidayFact[];
  readOnly?: boolean;
}
async function mount(options: Options = {}) {
  const writes: Write[] = [];
  const events: { type: string; detail: unknown }[] = [];
  painter = document.createElement("special-day-painter");
  painter.api = specialDayApi(writes, { days: { sd1: storedDay() }, ...options });
  const lists: Promise<unknown>[] = [];
  const list = painter.api.specialDays.listSpecialDays.bind(painter.api.specialDays);
  painter.api.specialDays.listSpecialDays = (...args) => {
    const answer = list(...args);
    lists.push(answer);
    return answer;
  };
  painter.model = painterModel();
  painter.specialDayId = options.specialDayId === undefined ? "sd1" : options.specialDayId;
  painter.date = options.date ?? null;
  painter.addDate = options.addDate ?? null;
  painter.holidays = options.holidays ?? [];
  painter.readOnly = options.readOnly ?? false;
  painter.open = true;
  for (const type of [
    "special-day-saved",
    "special-day-deleted",
    "special-day-navigate",
    "painter-close",
  ])
    painter.addEventListener(type, (event) =>
      events.push({ type, detail: (event as CustomEvent).detail }),
    );
  applyTokens(painter);
  document.body.append(painter);
  await loaded(painter);
  return { painter, writes, events, lists };
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
/** Every date the chips hold, a run's dates each. */
const chips = (el: SpecialDayPainter) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=date-chip]")].flatMap((chip) =>
    chip.dataset.dates!.split(" "),
  );
const chipLabels = (el: SpecialDayPainter) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=date-chip]")].map((chip) =>
    chip.querySelector("[data-test=date-label]")!.textContent!.trim(),
  );
const removeRun = async (el: SpecialDayPainter, first: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(
    `[data-test=date-chip][data-date="${first}"] [data-test=remove-date]`,
  )!.click();
  await settle(el);
};
const dated = (...dates: string[]) =>
  storedDay({ dates: dates.map((date) => ({ date, closedAllDay: false })) });
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

describe("a stored special day opened with a date to add", () => {
  it("holds the date as an unsaved change, saves nothing until Save, and sends it then", async () => {
    const { painter, writes, events } = await mount({ addDate: "2026-12-20" });
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-20", "2026-12-25"]);
    expect(tick(painter, "2026-12-20").checked).toBe(false);
    expect(saveButton(painter).disabled).toBe(false);
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
    await save(painter, writes);
    expect(writes[0]).toMatchObject({
      url: "/management-api/venue-service/special-days/sd1",
      method: "PUT",
      body: {
        dates: [
          { date: "2026-12-14", closedAllDay: false },
          { date: "2026-12-15", closedAllDay: false },
          { date: "2026-12-20", closedAllDay: false },
          { date: "2026-12-25", closedAllDay: true },
        ],
      },
    });
  });

  it("adds nothing for a date the day already holds, and a change of the date to add starts again from the stored day with that date", async () => {
    const { painter } = await mount({ addDate: "2026-12-15" });
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-25"]);
    expect(saveButton(painter).disabled).toBe(true);
    await typeName(painter, "Edited");
    painter.addDate = "2026-12-20";
    await loaded(painter);
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-20", "2026-12-25"]);
    expect(
      painter.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!
        .value,
    ).toBe("Christmas dinners");
  });

  it("once saved, keeps the saved state while the address still names the date, reading nothing again", async () => {
    const { painter, writes } = await mount({ addDate: "2026-12-20" });
    let reads = 0;
    const api = painter.api.specialDays;
    const read = api.readSpecialDay.bind(api);
    api.readSpecialDay = (...args) => {
      reads++;
      return read(...args);
    };
    await save(painter, writes);
    await loaded(painter);
    expect(reads).toBe(0);
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-20", "2026-12-25"]);
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
    expect(grid(painter)).toBeNull();
    expect(part(painter, "no-dates")).not.toBeNull();
  });
});

describe("opened on a public holiday", () => {
  const navidad = [holiday("2026-12-25", "Navidad")];
  const named = (id: string, name: string, dates: string[]): SpecialDayDetail =>
    storedDay({
      id,
      name,
      dates: dates.map((date) => ({ date, closedAllDay: date.endsWith("-24") })),
    });
  async function listed(el: SpecialDayPainter, lists: Promise<unknown>[]) {
    await Promise.allSettled(lists);
    await settle(el);
  }
  const nameValue = (el: SpecialDayPainter) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")?.value;

  it("starts on the holiday's name and date, and Save sends exactly that unchanged", async () => {
    const { painter, writes, lists } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
    });
    await listed(painter, lists);
    expect(lists).toHaveLength(1);
    expect(part(painter, "offer")).toBeNull();
    expect(nameValue(painter)).toBe("Navidad");
    expect(chips(painter)).toEqual(["2026-12-25"]);
    expect(saveButton(painter).disabled).toBe(false);
    await save(painter, writes);
    expect(writes).toEqual([
      {
        url: "/management-api/venue-service/special-days",
        method: "POST",
        body: {
          name: "Navidad",
          repeatsYearly: false,
          dates: [{ date: "2026-12-25", closedAllDay: false }],
          expectedClockRevision: 4,
        },
      },
    ]);
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("closes at once when nothing was changed from the pre-fill", async () => {
    const { painter, events } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
    });
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
    await expect.poll(() => painter.open).toBe(false);
    expect(events.map(({ type }) => type)).toEqual(["painter-close"]);
  });

  it("first offers the special day of the same name, and only that name", async () => {
    const days = { sd1: storedDay(), sd2: named("sd2", "Navidad", ["2025-12-25"]) };
    const offered = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days,
    });
    await listed(offered.painter, offered.lists);
    expect(part(offered.painter, "offer")!.textContent).toContain(
      "A special day called Navidad already exists.",
    );
    expect(part(offered.painter, "add-to")!.textContent!.trim()).toBe("Add to Navidad");
    expect(part(offered.painter, "new-instead")!.textContent!.trim()).toBe("New special day");
    expect(nameValue(offered.painter)).toBeUndefined();
    expect(saveButton(offered.painter).disabled).toBe(true);
    frame(offered.painter).dispatchEvent(new CustomEvent("painter-save"));
    await settle(offered.painter);
    expect(offered.writes).toEqual([]);
    offered.painter.remove();

    const other = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days: { sd2: named("sd2", "Navidad dinners", ["2025-12-25"]) },
    });
    await listed(other.painter, other.lists);
    expect(part(other.painter, "offer")).toBeNull();
    expect(nameValue(other.painter)).toBe("Navidad");
  });

  it("never offers on an ordinary date or a stored day, and asks for no list there", async () => {
    const days = { sd1: storedDay({ name: "Navidad" }), sd2: named("sd2", "Navidad", []) };
    const ordinary = await mount({
      specialDayId: null,
      date: "2026-12-24",
      holidays: navidad,
      days,
    });
    await listed(ordinary.painter, ordinary.lists);
    expect(ordinary.lists).toHaveLength(0);
    expect(part(ordinary.painter, "offer")).toBeNull();
    expect(nameValue(ordinary.painter)).toBe("");
    ordinary.painter.remove();

    const stored = await mount({ date: "2026-12-25", holidays: navidad, days });
    await listed(stored.painter, stored.lists);
    expect(stored.lists).toHaveLength(0);
    expect(part(stored.painter, "offer")).toBeNull();
  });

  it("Add to opens that special day with the date added to its draft, and saves nothing", async () => {
    const days = {
      sd1: storedDay(),
      sd2: named("sd2", "Navidad", ["2025-12-24", "2025-12-25"]),
    };
    const { painter, writes, events, lists } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days,
    });
    await listed(painter, lists);
    part(painter, "add-to")!.click();
    await loaded(painter);
    await expect.poll(() => chips(painter)).toEqual(["2025-12-24", "2025-12-25", "2026-12-25"]);
    expect(part(painter, "offer")).toBeNull();
    expect(nameValue(painter)).toBe("Navidad");
    expect(tick(painter, "2025-12-24").checked).toBe(true);
    expect(tick(painter, "2025-12-25").checked).toBe(false);
    expect(tick(painter, "2026-12-25").checked).toBe(false);
    expect(writes).toEqual([]);
    expect(events).toEqual([{ type: "special-day-navigate", detail: { specialDayId: "sd2" } }]);
    expect(saveButton(painter).disabled).toBe(false);
    expect(part(painter, "delete")).not.toBeNull();

    painter.specialDayId = "sd2";
    await settle(painter);
    expect(chips(painter)).toEqual(["2025-12-24", "2025-12-25", "2026-12-25"]);

    await save(painter, writes);
    expect(writes).toEqual([
      {
        url: "/management-api/venue-service/special-days/sd2",
        method: "PUT",
        body: {
          name: "Navidad",
          repeatsYearly: false,
          dates: [
            { date: "2025-12-24", closedAllDay: true },
            { date: "2025-12-25", closedAllDay: false },
            { date: "2026-12-25", closedAllDay: false },
          ],
          expectedClockRevision: 4,
        },
      },
    ]);
  });

  it("Add to a day that already holds the date opens it unchanged", async () => {
    const days = { sd2: named("sd2", "Navidad", ["2026-12-25"]) };
    const { painter, lists } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days,
    });
    await listed(painter, lists);
    part(painter, "add-to")!.click();
    await loaded(painter);
    await expect.poll(() => part(painter, "offer")).toBeNull();
    expect(chips(painter)).toEqual(["2026-12-25"]);
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("offers the same-named day with the latest date, and the lowest id on a tie", async () => {
    const pick = async (days: Record<string, SpecialDayDetail>) => {
      const { painter, events, lists } = await mount({
        specialDayId: null,
        date: "2026-12-25",
        holidays: navidad,
        days,
      });
      await listed(painter, lists);
      part(painter, "add-to")!.click();
      await expect.poll(() => events.length).toBe(1);
      painter.remove();
      return (events[0]!.detail as { specialDayId: string }).specialDayId;
    };
    expect(
      await pick({
        sd1: named("sd1", "Navidad", []),
        sd2: named("sd2", "Navidad", ["2023-12-25", "2024-12-25"]),
        sd3: named("sd3", "Navidad", ["2025-12-25"]),
      }),
    ).toBe("sd3");
    expect(
      await pick({
        sd5: named("sd5", "Navidad", ["2025-12-25"]),
        sd4: named("sd4", "Navidad", ["2025-12-25"]),
        sd1: named("sd1", "Navidad", []),
      }),
    ).toBe("sd4");
  });

  it("New special day keeps the pre-filled new day", async () => {
    const days = { sd2: named("sd2", "Navidad", ["2025-12-25"]) };
    const { painter, writes, events, lists } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days,
    });
    await listed(painter, lists);
    part(painter, "new-instead")!.click();
    await settle(painter);
    expect(part(painter, "offer")).toBeNull();
    expect(nameValue(painter)).toBe("Navidad");
    expect(chips(painter)).toEqual(["2026-12-25"]);
    expect(part(painter, "delete")).toBeNull();
    await save(painter, writes);
    expect(writes[0]!.method).toBe("POST");
    expect(events.map(({ type }) => type)).toEqual(["special-day-saved"]);
  });

  it("a list that fails, or lands after the painter moved on, offers nothing", async () => {
    const days = { sd1: storedDay(), sd2: named("sd2", "Navidad", ["2025-12-25"]) };
    const failed = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days,
      failingList: true,
    });
    await listed(failed.painter, failed.lists);
    expect(part(failed.painter, "offer")).toBeNull();
    expect(nameValue(failed.painter)).toBe("Navidad");
    failed.painter.remove();

    let release!: () => void;
    const late = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days,
      listAfter: new Promise<void>((resolve) => (release = resolve)),
    });
    late.painter.specialDayId = "sd1";
    await loaded(late.painter);
    release();
    await listed(late.painter, late.lists);
    expect(part(late.painter, "offer")).toBeNull();
    expect(nameValue(late.painter)).toBe("Christmas dinners");
  });

  it("a list that answers after Save offers nothing on the day just saved", async () => {
    let release!: () => void;
    const { painter, writes, lists } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days: { sd2: named("sd2", "Navidad", ["2025-12-25"]) },
      listAfter: new Promise<void>((resolve) => (release = resolve)),
    });
    await save(painter, writes);
    expect(part(painter, "delete")).not.toBeNull();
    release();
    await listed(painter, lists);
    expect(part(painter, "offer")).toBeNull();
    expect(nameValue(painter)).toBe("Navidad");
  });

  it("a list that answers after the new day was edited offers nothing, and the edit stands", async () => {
    let release!: () => void;
    const { painter, writes, lists } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days: { sd2: named("sd2", "Navidad", ["2025-12-25"]) },
      listAfter: new Promise<void>((resolve) => (release = resolve)),
    });
    await addDates(painter, ["2026-12-14"]);
    release();
    await listed(painter, lists);
    expect(part(painter, "offer")).toBeNull();
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-25"]);
    await save(painter, writes);
    expect(writes[0]!.method).toBe("POST");
    expect((writes[0]!.body as { dates: unknown }).dates).toEqual([
      { date: "2026-12-14", closedAllDay: false },
      { date: "2026-12-25", closedAllDay: false },
    ]);
  });

  it("a read of the offered day that fails says so beside Save", async () => {
    const { painter, events, lists } = await mount({
      specialDayId: null,
      date: "2026-12-25",
      holidays: navidad,
      days: {},
      list: [{ id: "sd9", name: "Navidad", repeatsYearly: false, dates: [] }],
    });
    await listed(painter, lists);
    part(painter, "add-to")!.click();
    await expect.poll(() => frame(painter).refusal).toBe(t("special.load_error"));
    expect(events).toEqual([]);
  });
});

describe("dates", () => {
  it("are marked required as the name is, with the same star", async () => {
    const { painter } = await mount();
    const mark = painter.shadowRoot!.querySelector<HTMLElement>("#dates-label [data-required]");
    const nameMark = painter
      .shadowRoot!.querySelector("wt-input[name=name]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-required]")!;
    expect(mark?.textContent).toBe(nameMark.textContent);
    expect(mark!.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(mark!).color).toBe(getComputedStyle(nameMark).color);
  });

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
    await removeRun(painter, "2026-12-10");
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-25", "2026-12-31"]);
    expect(grid(painter).columns.map(({ key }) => key)).not.toContain("2026-12-10");
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

  it("in Spanish the bar's button, the heading, the question and the confirm button share one verb", async () => {
    setLocale("es");
    const { painter } = await mount();
    expect(part(painter, "delete")!.textContent!.trim()).toBe("Eliminar");
    part(painter, "delete")!.click();
    await settle(painter);
    expect(dialog(painter)!.heading).toBe("Eliminar");
    expect(dialog(painter)!.textContent).toContain("¿Eliminar Christmas dinners?");
    expect(part(painter, "confirm-delete")!.textContent!.trim()).toBe("Eliminar");
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

  it("a refused name is marked under Name, and beside Save says only the generic sentence", async () => {
    const { painter, writes } = await mount({
      answer: () => ({ code: "special_day.invalid", params: { field: "name" } }),
    });
    const name = () =>
      painter.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=name]")!;
    await typeName(painter, "Renamed");
    await save(painter, writes);
    expect(name().error).toBe("Check this field.");
    expect(frame(painter).refusal).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(painter).disabled).toBe(false);
    await typeName(painter, "Renamed again");
    expect(name().error).toBe("");
    expect(frame(painter).refusal).toBe("");
  });

  it("a date's own refusal is told on its column, and beside Save says only the generic sentence", async () => {
    const { painter, writes } = await mount({
      answer: () => ({ code: "special_day.invalid", params: { field: "dates.1.closedAllDay" } }),
    });
    await typeName(painter, "Renamed");
    await save(painter, writes);
    expect([...grid(painter).columnErrors]).toEqual([["2026-12-15", "Check this field."]]);
    expect(frame(painter).refusal).toBe("Correct the highlighted fields to continue.");
  });

  it("maps the other refusals to their messages", async () => {
    const cases: [unknown, string][] = [
      [{ code: "hours.clock_changed" }, "The business-day start changed. Reload hours."],
      [
        { code: "special_day.invalid", params: { field: "dates.1.date", reason: "overlap" } },
        "Tue, 15 Dec 2026 meets another of these dates.",
      ],
      [
        { code: "special_day.invalid", params: { field: "name" } },
        "Correct the highlighted fields to continue.",
      ],
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
    const apart = {
      ...paintedDay(),
      dates: ["2026-12-14", "2026-12-16", "2026-12-25"].map((date) => ({
        date,
        closedAllDay: date === "2026-12-25",
      })),
    };
    const { painter } = await mount({ days: { sd1: apart } });
    await removeChip(painter, "2026-12-16");
    await addDates(painter, ["2026-12-16"]);
    expect(saveButton(painter).disabled).toBe(true);
    await removeChip(painter, "2026-12-14");
    await addDates(painter, ["2026-12-14"]);
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-16", "2026-12-25"]);
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
        "Correct the highlighted fields to continue.",
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
      expect(marked).toEqual(
        message === "Correct the highlighted fields to continue." ? ["2026-12-14"] : [],
      );
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

describe("the date chips", () => {
  const december = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `2026-12-${String(from + i).padStart(2, "0")}`);

  it("show consecutive dates as one run, and a date on its own as a single chip, in short dates", async () => {
    const { painter } = await mount({ days: { sd1: dated(...december(14, 23), "2026-12-25") } });
    expect(chipLabels(painter)).toEqual(["14 Dec – 23 Dec", "25 Dec"]);
    const remove = painter.shadowRoot!.querySelector<HTMLElement>(
      '[data-test=date-chip][data-date="2026-12-14"] [data-test=remove-date]',
    )!;
    expect(remove.getAttribute("aria-label")).toBe(
      "Remove Monday, 14 December 2026 – Wednesday, 23 December 2026",
    );
  });

  it("removing a run removes every date in it, and its columns", async () => {
    const { painter } = await mount({ days: { sd1: dated(...december(14, 23), "2026-12-25") } });
    await removeRun(painter, "2026-12-14");
    expect(chips(painter)).toEqual(["2026-12-25"]);
    expect(grid(painter).columns.map(({ key }) => key)).toEqual(["2026-12-25"]);
    expect(saveButton(painter).disabled).toBe(false);
  });

  it("read in Spanish, and with the year when the dates fall in more than one year", async () => {
    setLocale("es");
    const { painter } = await mount({
      days: { sd1: dated("2026-12-14", "2026-12-15", "2026-12-31", "2027-01-01", "2027-01-06") },
    });
    expect(chipLabels(painter)).toEqual([
      "14 dic 2026 – 15 dic 2026",
      "31 dic 2026 – 1 ene 2027",
      "6 ene 2027",
    ]);
    painter.remove();
    const single = await mount({ days: { sd1: dated("2026-12-14", "2026-12-15") } });
    expect(chipLabels(single.painter)).toEqual(["14 dic – 15 dic"]);
  });

  it("a date added next to a run joins it", async () => {
    const { painter } = await mount();
    expect(chipLabels(painter)).toEqual(["14 Dec – 15 Dec", "25 Dec"]);
    await addDates(painter, ["2026-12-16", "2026-12-24"]);
    expect(chipLabels(painter)).toEqual(["14 Dec – 16 Dec", "24 Dec – 25 Dec"]);
  });
});

describe("no dates yet", () => {
  it("says to add dates where the grid would be, in the dashboard's language", async () => {
    const { painter } = await mount({ specialDayId: null });
    expect(part(painter, "no-dates")!.textContent!.trim()).toBe("Add dates to paint them.");
    expect(grid(painter)).toBeNull();
    await addDates(painter, ["2026-12-24"]);
    expect(part(painter, "no-dates")).toBeNull();
    expect(grid(painter).columns.map(({ key }) => key)).toEqual(["2026-12-24"]);
    painter.remove();
    setLocale("es");
    const spanish = await mount({ specialDayId: null });
    expect(part(spanish.painter, "no-dates")!.textContent!.trim()).toBe(
      "Añade fechas para pintarlas.",
    );
  });

  it("says nothing while a stored day is still being read", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    painter = document.createElement("special-day-painter");
    painter.api = specialDayApi([], { days: { sd1: storedDay() } });
    const api = painter.api.specialDays;
    const read = api.readSpecialDay.bind(api);
    api.readSpecialDay = async (id, options) => {
      await held;
      return read(id, options);
    };
    painter.model = painterModel();
    painter.specialDayId = "sd1";
    painter.open = true;
    document.body.append(painter);
    await settle(painter);
    expect(part(painter, "loading")).not.toBeNull();
    expect(part(painter, "no-dates")).toBeNull();
    release();
    await loaded(painter);
    expect(part(painter, "no-dates")).toBeNull();
  });
});

it("a refused date marks its heading, and the Closed tick under it keeps its own colour", async () => {
  const { painter, writes } = await mount({
    answer: () => ({
      code: "special_day.date_taken",
      params: { date: "2026-12-15", name: "Staff party", specialDayId: "sd7" },
    }),
  });
  await typeName(painter, "Renamed");
  await save(painter, writes);
  const heading = (date: string) =>
    grid(painter).shadowRoot!.querySelector<HTMLElement>(`.heading[data-column="${date}"]`)!;
  const label = (date: string) => tick(painter, date).closest("label")!;
  expect(heading("2026-12-15").hasAttribute("data-error")).toBe(true);
  expect(getComputedStyle(heading("2026-12-15")).color).not.toBe(
    getComputedStyle(heading("2026-12-14")).color,
  );
  expect(getComputedStyle(label("2026-12-15")).color).toBe(
    getComputedStyle(label("2026-12-14")).color,
  );
});

it("while the offer to add to a same-named day is shown, the paint row and the Closed ticks are quiet and cannot change", async () => {
  const { painter, lists } = await mount({
    specialDayId: null,
    date: "2026-12-25",
    holidays: [holiday("2026-12-25", "Navidad")],
    days: {
      sd2: storedDay({
        id: "sd2",
        name: "Navidad",
        dates: [{ date: "2025-12-25", closedAllDay: false }],
      }),
    },
  });
  await Promise.allSettled(lists);
  await settle(painter);
  expect(part(painter, "offer")).not.toBeNull();
  const row = part(painter, "paint-row")!;
  const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons.length).toBeGreaterThan(0);
  expect(buttons.every((button) => button.disabled)).toBe(true);
  for (const quiet of row.querySelectorAll(".pot, .new"))
    expect(Number(getComputedStyle(quiet).opacity)).toBeLessThan(1);
  const box = tick(painter, "2026-12-25");
  expect(box.disabled).toBe(true);
  box.click();
  await settle(painter);
  expect(box.checked).toBe(false);
  expect(saveButton(painter).disabled).toBe(true);
  part(painter, "new-instead")!.click();
  await settle(painter);
  expect(tick(painter, "2026-12-25").disabled).toBe(false);
  expect(
    [...part(painter, "paint-row")!.querySelectorAll<HTMLButtonElement>("button")].some(
      (button) => button.disabled,
    ),
  ).toBe(false);
});

describe("taken off the page while a request is out, and put back", () => {
  const dismiss = (el: SpecialDayPainter) =>
    frame(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=dismiss]")!;
  const deferred = () => {
    let release!: (value?: unknown) => void;
    const promise = new Promise((resolve) => (release = resolve));
    return { promise, release };
  };
  async function putBack(el: SpecialDayPainter) {
    el.remove();
    await Promise.resolve();
    document.body.append(el);
    await settle(el);
  }

  it("during a save, stays busy until the save's answer lands, then takes it as saved: ✕ can close and Save is quiet", async () => {
    const held = deferred();
    const { painter, writes } = await mount({ answer: () => held.promise });
    await typeName(painter, "Renamed");
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => frame(painter).busy).toBe(true);
    await putBack(painter);
    expect(frame(painter).busy).toBe(true);
    held.release();
    await expect.poll(() => frame(painter).busy).toBe(false);
    await settle(painter);
    expect(dismiss(painter).disabled).toBe(false);
    expect(frame(painter).heading).toBe("Renamed");
    expect(saveButton(painter).disabled).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("during a new day's first save, takes the saved day's answer even when it lands off the page: Save is quiet and the next save changes that day", async () => {
    const held = deferred();
    let calls = 0;
    const { painter, writes } = await mount({
      specialDayId: null,
      date: "2026-12-14",
      answer: () => (calls++ === 0 ? held.promise : undefined),
    });
    await typeName(painter, "Christmas lunch");
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.method).toBe("POST");
    painter.remove();
    held.release();
    await expect.poll(() => painter.specialDayId).toBe("sd-new");
    document.body.append(painter);
    await settle(painter);
    expect(frame(painter).busy).toBe(false);
    expect(saveButton(painter).disabled).toBe(true);
    expect(part(painter, "delete")).not.toBeNull();
    await typeName(painter, "Christmas lunches");
    await save(painter, writes);
    expect(writes[1]!.method).toBe("PUT");
    expect(writes[1]!.url).toMatch(/\/special-days\/sd-new$/);
  });

  it("during the first read, reads the day again and opens on it", async () => {
    const held = deferred();
    let reads = 0;
    const writes: Write[] = [];
    painter = document.createElement("special-day-painter");
    painter.api = specialDayApi(writes, {
      days: { sd1: storedDay() },
      dayAfter: () => (reads++ === 0 ? held.promise : undefined),
    });
    painter.model = painterModel();
    painter.specialDayId = "sd1";
    painter.open = true;
    applyTokens(painter);
    document.body.append(painter);
    await settle(painter);
    expect(part(painter, "loading")).not.toBeNull();
    painter.remove();
    held.release();
    await held.promise;
    document.body.append(painter);
    await loaded(painter);
    expect(frame(painter).heading).toBe("Christmas dinners");
    expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-25"]);
    expect(reads).toBe(2);
  });

  it("during a delete, the question is no longer busy and ✕ can close", async () => {
    const held = deferred();
    const { painter, writes, events } = await mount({
      answer: (write) => (write.method === "DELETE" ? held.promise : undefined),
    });
    part(painter, "delete")!.click();
    await settle(painter);
    part(painter, "confirm-delete")!.click();
    await expect.poll(() => writes.length).toBe(1);
    await putBack(painter);
    held.release();
    await settle(painter);
    expect(painter.shadowRoot!.querySelector("wt-dialog[data-test=delete-special-day]")).toBeNull();
    expect(events.filter(({ type }) => type === "special-day-deleted")).toEqual([]);
    expect(dismiss(painter).disabled).toBe(false);
    dismiss(painter).click();
    await expect.poll(() => painter.open).toBe(false);
  });

  it("during a passive re-read, reads the day again, so a name changed elsewhere still follows", async () => {
    let hold: ReturnType<typeof deferred> | undefined;
    const days = { sd1: storedDay() };
    const { painter } = await mount({ days, dayAfter: () => hold?.promise });
    hold = deferred();
    days.sd1 = storedDay({ name: "Renamed elsewhere" });
    painter.model = painterModel();
    await settle(painter);
    const first = hold;
    hold = undefined;
    painter.remove();
    first.release();
    await first.promise;
    document.body.append(painter);
    await settle(painter);
    await expect.poll(() => frame(painter).heading).toBe("Renamed elsewhere");
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("with the calendar open, watches its month again", async () => {
    const { painter } = await mount();
    const months: string[] = [];
    const watch = painter.api.watchMonth.bind(painter.api);
    painter.api.watchMonth = (month, ...rest) => {
      months.push(month);
      return watch(month, ...rest);
    };
    part(painter, "add-dates")!.click();
    await settle(painter);
    expect(months).toEqual(["2026-12"]);
    await putBack(painter);
    expect(months).toEqual(["2026-12", "2026-12"]);
  });
});
