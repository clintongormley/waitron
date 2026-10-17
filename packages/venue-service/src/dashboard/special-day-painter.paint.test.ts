import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import { t } from "./strings.js";
import {
  drag,
  frame,
  grid,
  painterModel,
  part,
  pick,
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
});

const DEC_14 = "2026-12-14";
const DEC_15 = "2026-12-15";
const DEC_25 = "2026-12-25";
const dinner = (startsAt: string, endsAt: string) => ({ periodId: "p2", startsAt, endsAt });
const lunch = (startsAt: string, endsAt: string) => ({ periodId: "p1", startsAt, endsAt });
const closed = (startsAt: string, endsAt: string) => ({ periodId: null, startsAt, endsAt });
/** Minutes after the 06:00 changeover. */
const at = (clock: string) =>
  (Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) - 360 + 1440) % 1440;

/** Every date's season: Dinner 20:00–23:30, and the Terrace closed 21:00–22:00. */
const winterDinner: SpecialDayAnswers["season"] = () => ({
  ranges: [dinner("20:00", "23:30")],
  zones: { z2: [{ startsAt: "21:00", endsAt: "22:00" }] },
});

async function mount(options: SpecialDayAnswers = {}) {
  const writes: Write[] = [];
  const seasonReads: LocalDate[][] = [];
  painter = document.createElement("special-day-painter");
  painter.api = specialDayApi(writes, {
    days: { sd1: storedDay() },
    season: winterDinner,
    ...options,
  });
  const read = painter.api.readSeasonDays.bind(painter.api);
  painter.api.readSeasonDays = (dates) => {
    seasonReads.push([...dates]);
    return read(dates);
  };
  painter.model = painterModel();
  painter.specialDayId = "sd1";
  painter.open = true;
  applyTokens(painter);
  document.body.append(painter);
  await loaded(painter);
  return { painter, writes, seasonReads };
}
async function loaded(el: SpecialDayPainter) {
  await settle(el);
  await expect.poll(() => part(el, "loading")).toBeNull();
  await expect.poll(() => grid(el).underlay.size).toBeGreaterThan(0);
  await settle(el);
}
const chip = (el: SpecialDayPainter, test: string) => part<HTMLButtonElement>(el, test)!;
const saveButton = (el: SpecialDayPainter) =>
  frame(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;

describe("the season under the paint", () => {
  it("draws each date's season faded under a date with no paint", async () => {
    const { painter } = await mount();
    expect(grid(painter).readOnly).toBe(false);
    expect(grid(painter).underlay.get(DEC_14)).toEqual([dinner("20:00", "23:30")]);
    expect(grid(painter).days.get(DEC_14) ?? []).toEqual([]);
    const faded = grid(painter).shadowRoot!.querySelectorAll(
      `.day[data-column="${DEC_14}"] .block.underlay`,
    );
    expect(faded.length).toBe(1);
  });

  it("reads the season once per set of dates, not once per redraw", async () => {
    const { painter, seasonReads } = await mount();
    expect(seasonReads).toEqual([[DEC_14, DEC_15, DEC_25]]);
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    await pick(painter, "zone:z1");
    expect(seasonReads.length).toBe(1);
  });

  it("re-reads when a date is removed, and when the model's seasons change, keeping the draft", async () => {
    const { painter, seasonReads, writes } = await mount();
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    painter
      .shadowRoot!.querySelector<HTMLElement>(`[data-date="${DEC_25}"] [data-test=remove-date]`)!
      .click();
    await settle(painter);
    await expect.poll(() => seasonReads.length).toBe(2);
    expect(seasonReads[1]).toEqual([DEC_14, DEC_15]);
    const moved = painterModel();
    painter.model = {
      ...moved,
      seasons: [{ ...moved.seasons[0]! }, { ...moved.seasons[1]!, startsOn: "11-15" }],
    };
    await settle(painter);
    await expect.poll(() => seasonReads.length).toBe(3);
    painter.model = { ...painter.model };
    await settle(painter);
    expect(seasonReads.length).toBe(3);
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    expect(saveButton(painter).disabled).toBe(false);
    expect(writes).toEqual([]);
  });

  it("drops a season read that lands after a newer one", async () => {
    let release: () => void = () => {};
    let slow = false;
    let hours = [dinner("20:00", "23:30")];
    const { painter, seasonReads } = await mount({
      season: () => ({ ranges: hours }),
      seasonAfter: () =>
        slow ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve(),
    });
    slow = true;
    painter.model = { ...painterModel(), seasons: [] };
    await settle(painter);
    slow = false;
    hours = [lunch("13:00", "16:00")];
    painter.model = painterModel();
    await settle(painter);
    await expect.poll(() => grid(painter).underlay.get(DEC_15)).toEqual([lunch("13:00", "16:00")]);
    expect(seasonReads.length).toBe(3);
    hours = [dinner("19:00", "20:00")];
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(painter);
    expect(grid(painter).underlay.get(DEC_15)).toEqual([lunch("13:00", "16:00")]);
  });

  it("says so when the season cannot be read, and still paints", async () => {
    const { painter } = await mountFailing();
    expect(part(painter, "season-error")!.textContent!.trim()).toBe(
      "The season's hours could not be loaded.",
    );
    expect(grid(painter).underlay.size).toBe(0);
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
  });

  it("draws from the first date's changeover, with a notice when the dates' changeovers differ", async () => {
    const { painter } = await mount({
      season: (date) => ({ dayCutover: date === DEC_14 ? "05:00" : "06:00" }),
    });
    expect(grid(painter).cutover).toBe("05:00");
    expect(part(painter, "changeover-notice")!.textContent!.trim()).toBe(
      "These dates start their day at different times; drawn from 05:00.",
    );
  });

  it("shows no changeover notice when every date starts its day at the same time", async () => {
    const { painter } = await mount();
    expect(grid(painter).cutover).toBe("06:00");
    expect(part(painter, "changeover-notice")).toBeNull();
  });
});

async function mountFailing() {
  const writes: Write[] = [];
  painter = document.createElement("special-day-painter");
  painter.api = specialDayApi(writes, { days: { sd1: storedDay() }, failingSeason: () => true });
  painter.model = painterModel();
  painter.specialDayId = "sd1";
  painter.open = true;
  applyTokens(painter);
  document.body.append(painter);
  await settle(painter);
  await expect.poll(() => part(painter!, "season-error")).not.toBeNull();
  await settle(painter);
  return { painter };
}

describe("painting a department", () => {
  it("offers the department's periods and Closed, the first period chosen", async () => {
    const { painter } = await mount();
    expect(chip(painter, "paint-p1").getAttribute("aria-pressed")).toBe("true");
    expect(chip(painter, "paint-p2").getAttribute("aria-pressed")).toBe("false");
    expect(chip(painter, "paint-closed")).not.toBeNull();
    expect(part(painter, "paint-open")).toBeNull();
    expect(grid(painter).closedErases).toBe(false);
  });

  it("the owner's worked example: Dinner 19:00–22:00 over a Dinner 20:00–23:30 season, then Closed to 23:30", async () => {
    const { painter } = await mount();
    expect(saveButton(painter).disabled).toBe(true);
    chip(painter, "paint-p2").click();
    await settle(painter);
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    expect(grid(painter).underlay.get(DEC_14)).toEqual([dinner("20:00", "23:30")]);
    expect(saveButton(painter).disabled).toBe(false);
    chip(painter, "paint-closed").click();
    await settle(painter);
    await drag(painter, DEC_14, at("22:00"), at("23:30"));
    expect(grid(painter).days.get(DEC_14)).toEqual([
      dinner("19:00", "22:00"),
      closed("22:00", "23:30"),
    ]);
  });

  it("keeps a stored Dinner 20:00–21:00 when Lunch is painted elsewhere on that date", async () => {
    const { painter } = await mount({
      days: {
        sd1: storedDay({
          paint: [{ departmentId: "d1", date: DEC_14, ranges: [dinner("20:00", "21:00")] }],
        }),
      },
    });
    chip(painter, "paint-p1").click();
    await drag(painter, DEC_14, at("13:00"), at("16:00"));
    expect(grid(painter).days.get(DEC_14)).toEqual([
      lunch("13:00", "16:00"),
      dinner("20:00", "21:00"),
    ]);
  });

  it("copies a date's paint to another date by value, and clears a date", async () => {
    const { painter } = await mount();
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    const g = grid(painter);
    const menu = (key: string) =>
      g.shadowRoot!.querySelector<HTMLElement>(`.heading[data-column="${key}"] wt-row-actions`)!;
    const action = (key: string, label: string) =>
      [...menu(key).querySelectorAll<HTMLElement>("wt-button")].find(
        (button) => button.textContent!.trim() === label,
      )!;
    await userEvent.click(menu(DEC_14));
    await userEvent.click(action(DEC_14, "Copy to…"));
    await g.updateComplete;
    const chooser = g.shadowRoot!.querySelector<HTMLElement>(".chooser")!;
    await userEvent.click(
      chooser.querySelector<HTMLInputElement>(`input[name="copyTo-${DEC_15}"]`)!,
    );
    await g.updateComplete;
    await userEvent.click(
      [...chooser.querySelectorAll<HTMLElement>("wt-button")].find(
        (button) => button.textContent!.trim() === "Copy",
      )!,
    );
    await settle(painter);
    expect(grid(painter).days.get(DEC_15)).toEqual([dinner("19:00", "22:00")]);
    chip(painter, "paint-closed").click();
    await drag(painter, DEC_14, at("19:00"), at("20:00"));
    expect(grid(painter).days.get(DEC_15)).toEqual([dinner("19:00", "22:00")]);
    await userEvent.click(menu(DEC_15));
    await userEvent.click(action(DEC_15, "Clear"));
    await settle(painter);
    expect(grid(painter).days.get(DEC_15) ?? []).toEqual([]);
  });

  it("an undone paint makes Save quiet again", async () => {
    const { painter } = await mount();
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    expect(saveButton(painter).disabled).toBe(false);
    grid(painter).dispatchEvent(
      new CustomEvent("paint-change", {
        detail: { key: DEC_14, day: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(painter);
    expect(saveButton(painter).disabled).toBe(true);
  });

  it("a read-only painter offers no paint row and a grid that cannot change", async () => {
    painter = document.createElement("special-day-painter");
    painter.api = specialDayApi([], { days: { sd1: storedDay() }, season: winterDinner });
    painter.model = painterModel();
    painter.specialDayId = "sd1";
    painter.readOnly = true;
    painter.open = true;
    document.body.append(painter);
    await loaded(painter);
    expect(part(painter, "paint-row")).toBeNull();
    expect(grid(painter).readOnly).toBe(true);
    expect(grid(painter).underlay.get(DEC_14)).toEqual([dinner("20:00", "23:30")]);
  });
});

describe("the department and zone picker", () => {
  it("with no active department offers no picker or paint, and still ticks Closed", async () => {
    painter = document.createElement("special-day-painter");
    painter.api = specialDayApi([], { days: { sd1: storedDay() } });
    const model = painterModel();
    painter.model = { ...model, departments: model.departments.filter(({ active }) => !active) };
    painter.specialDayId = "sd1";
    painter.open = true;
    document.body.append(painter);
    await settle(painter);
    await expect.poll(() => part(painter!, "loading")).toBeNull();
    await settle(painter);
    expect(painter.shadowRoot!.querySelector("[name=department]")).toBeNull();
    expect(part(painter, "paint-row")).toBeNull();
    expect(grid(painter).readOnly).toBe(true);
    expect(grid(painter).columns.map(({ key }) => key)).toEqual([DEC_14, DEC_15, DEC_25]);
    expect(
      painter.shadowRoot!.querySelector<HTMLInputElement>(`input[name="closed.${DEC_14}"]`)!
        .disabled,
    ).toBe(false);
  });

  it("with no active department and no dates says to add dates, and draws no link to the Periods window", async () => {
    painter = document.createElement("special-day-painter");
    painter.api = specialDayApi([], {});
    const model = painterModel();
    painter.model = { ...model, departments: model.departments.filter(({ active }) => !active) };
    painter.specialDayId = null;
    painter.open = true;
    document.body.append(painter);
    await settle(painter);
    expect(part(painter, "no-dates")).not.toBeNull();
    expect(grid(painter)).toBeNull();
    expect(part(painter, "periods-link")).toBeNull();
  });

  it("ignores a pick of a department or zone it does not list", async () => {
    const { painter } = await mount();
    await pick(painter, "zone:z9");
    await pick(painter, "d2");
    const picker = painter.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[name=department]",
    )!;
    expect(picker.value).toBe("d1");
  });

  it("lists each active department with its zones indented under it", async () => {
    const { painter } = await mount();
    const picker = painter.shadowRoot!.querySelector<
      HTMLElement & { options: unknown; value: string }
    >("[name=department]")!;
    expect(picker.slot).toBe("picker");
    expect(picker.value).toBe("d1");
    expect(picker.options).toEqual([
      { value: "d1", label: "Restaurant" },
      { value: "zone:z1", label: "Dining room", depth: 1 },
      { value: "zone:z2", label: "Terrace", depth: 1 },
    ]);
  });

  it("keeps one draft across the department and its zones", async () => {
    const { painter } = await mount();
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    await pick(painter, "zone:z2");
    await drag(painter, DEC_15, at("21:00"), at("22:00"));
    expect(grid(painter).days.get(DEC_15)).toEqual([closed("21:00", "22:00")]);
    await pick(painter, "d1");
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    expect(grid(painter).days.get(DEC_15) ?? []).toEqual([]);
    await pick(painter, "zone:z2");
    expect(grid(painter).days.get(DEC_15)).toEqual([closed("21:00", "22:00")]);
  });

  it("a zone paints Closed and Open, and its underlay is the department's day with the zone's closures", async () => {
    const { painter } = await mount();
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    await pick(painter, "zone:z2");
    expect(part(painter, "paint-p1")).toBeNull();
    expect(chip(painter, "paint-closed").getAttribute("aria-pressed")).toBe("true");
    expect(grid(painter).paintable).toEqual([null, "open"]);
    expect(grid(painter).closedErases).toBe(false);
    expect(grid(painter).underlay.get(DEC_14)).toEqual([
      dinner("19:00", "21:00"),
      closed("21:00", "22:00"),
      dinner("22:00", "23:30"),
    ]);
    expect(grid(painter).underlay.get(DEC_15)).toEqual([
      dinner("20:00", "21:00"),
      closed("21:00", "22:00"),
      dinner("22:00", "23:30"),
    ]);
    chip(painter, "paint-open").click();
    await settle(painter);
    expect(chip(painter, "paint-open").getAttribute("aria-pressed")).toBe("true");
    await drag(painter, DEC_14, at("21:00"), at("22:00"));
    chip(painter, "paint-closed").click();
    await drag(painter, DEC_14, at("22:00"), at("23:00"));
    expect(grid(painter).days.get(DEC_14)).toEqual([
      { periodId: "open", startsAt: "21:00", endsAt: "22:00" },
      closed("22:00", "23:00"),
    ]);
    const open = grid(painter).shadowRoot!.querySelector<HTMLElement>(
      `.day[data-column="${DEC_14}"] .block:not(.underlay)`,
    )!;
    expect(open.dataset.colour).toBe("green");
    expect(saveButton(painter).disabled).toBe(false);
  });

  it("opens on a zone's stored Open as the Open paint", async () => {
    const { painter } = await mount({
      days: {
        sd1: storedDay({
          zonePaint: [
            {
              zoneId: "z2",
              date: DEC_14,
              ranges: [{ kind: "open", startsAt: "21:00", endsAt: "22:00" }],
            },
          ],
        }),
      },
    });
    await pick(painter, "zone:z2");
    expect(grid(painter).days.get(DEC_14)).toEqual([
      { periodId: "open", startsAt: "21:00", endsAt: "22:00" },
    ]);
  });
});

describe("a date ticked Closed", () => {
  const column = (el: SpecialDayPainter, date: string) =>
    grid(el).shadowRoot!.querySelector<HTMLElement>(`.day[data-column="${date}"]`)!;
  const tick = (el: SpecialDayPainter, date: string) =>
    el.shadowRoot!.querySelector<HTMLInputElement>(`input[name="closed.${date}"]`)!;

  it("draws closed all day across its column, over its season and its paint, and unticking shows the paint again", async () => {
    const { painter, writes } = await mount();
    expect(column(painter, DEC_25).querySelector(".all-closed")!.textContent!.trim()).toBe(
      "Closed all day",
    );
    expect(column(painter, DEC_25).querySelector(".underlay")).toBeNull();
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    tick(painter, DEC_14).click();
    await settle(painter);
    expect(column(painter, DEC_14).querySelector(".all-closed")).not.toBeNull();
    expect(column(painter, DEC_14).querySelector(".block")).toBeNull();
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    await drag(painter, DEC_14, at("12:00"), at("14:00"));
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    tick(painter, DEC_14).click();
    await settle(painter);
    expect(column(painter, DEC_14).querySelector(".all-closed")).toBeNull();
    expect(column(painter, DEC_14).querySelector("button.block")!.textContent).toContain(
      "19:00–22:00",
    );
    expect(column(painter, DEC_14).querySelector(".underlay")).not.toBeNull();
    expect(writes).toEqual([]);
  });

  it("keeps the ticked date's paint in the draft and sends it with the tick", async () => {
    const { painter, writes } = await mount();
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_15, at("19:00"), at("22:00"));
    tick(painter, DEC_15).click();
    await settle(painter);
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.body).toMatchObject({
      dates: [
        { date: DEC_14, closedAllDay: false },
        { date: DEC_15, closedAllDay: true },
        { date: DEC_25, closedAllDay: true },
      ],
      paint: [{ departmentId: "d1", date: DEC_15, ranges: [dinner("19:00", "22:00")] }],
    });
  });

  it("draws a zone's ticked date closed too", async () => {
    const { painter } = await mount();
    await pick(painter, "zone:z2");
    expect(column(painter, DEC_25).querySelector(".all-closed")).not.toBeNull();
    expect(column(painter, DEC_14).querySelector(".all-closed")).toBeNull();
  });
});

describe("periods from the painter", () => {
  const editorOf = (el: SpecialDayPainter) => el.shadowRoot!.querySelector("period-dialog");
  async function openEditor(el: SpecialDayPainter, test: string) {
    chip(el, test).click();
    await settle(el);
    const editor = editorOf(el)!;
    await editor.updateComplete;
    return editor;
  }

  it("its bar links to the Periods window, as the season painter's does", async () => {
    const { painter } = await mount();
    const link = painter.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!;
    expect(link.slot).toBe("link");
    expect(link.textContent!.trim()).toBe("Periods");
    expect(link.getAttribute("href")).toBe("/manage/opening-hours/view/year/window/periods");
    expect(link.hasAttribute("data-own-click")).toBe(true);
    await pick(painter, "zone:z2");
    expect(
      painter
        .shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!
        .getAttribute("href"),
    ).toBe("/manage/opening-hours/view/year/window/periods");
    expect(
      painter
        .shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!
        .hasAttribute("data-own-click"),
    ).toBe(true);
  });

  it("a plain click on its Periods link asks for the Periods window; a click already cancelled asks nothing", async () => {
    const { painter } = await mount();
    const link = part<HTMLAnchorElement>(painter, "periods-link")!;
    const asked: unknown[] = [];
    const seen: boolean[] = [];
    const record = (event: Event) => asked.push((event as CustomEvent).detail);
    const cancel = (event: Event) => event.preventDefault();
    // Bubbling on window runs after the link's own listener; cancelling here keeps the test page.
    const settled = (event: Event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    };
    const press = () =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    document.addEventListener("calendar-window-open", record);
    window.addEventListener("click", settled);
    try {
      document.addEventListener("click", cancel, { capture: true });
      try {
        press();
      } finally {
        document.removeEventListener("click", cancel, { capture: true });
      }
      expect(asked).toEqual([]);
      press();
      expect(seen).toEqual([true, true]);
      expect(asked).toEqual([{ window: "periods" }]);
    } finally {
      document.removeEventListener("calendar-window-open", record);
      window.removeEventListener("click", settled);
    }
  });

  it("+ New period opens the period dialog, saves the period on its own, keeps the painting and chooses it", async () => {
    const { painter, writes } = await mount({
      answer: ({ url }) => (url.endsWith("/menu-periods") ? { id: "p-new" } : undefined),
    });
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_14, at("19:00"), at("22:00"));
    const editor = await openEditor(painter, "new-period");
    expect(editor.period).toBeUndefined();
    const submit = editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!;
    expect(submit.textContent!.trim()).toBe("Add and paint with it");
    for (const [name, value] of [
      ["name", "Christmas"],
      ["menuId", "m1"],
    ])
      editor
        .shadowRoot!.querySelector(`[name=${name}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    await editor.updateComplete;
    const reread = vi.spyOn(painter.api, "rereadWatches");
    submit.click();
    await expect.poll(() => editorOf(painter)).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      url: "/management-api/venue-service/departments/d1/menu-periods",
      method: "POST",
      body: { name: "Christmas", expectedClockRevision: 4 },
    });
    expect(reread).toHaveBeenCalledTimes(1);
    expect(grid(painter).chosen).toBe("p-new");
    const next = painterModel();
    (next.departments[0]!.periods as unknown[]).push({
      ...next.departments[0]!.periods[0]!,
      id: "p-new",
      name: "Christmas",
      colour: "blue",
    });
    painter.model = next;
    await settle(painter);
    expect(chip(painter, "paint-p-new").getAttribute("aria-pressed")).toBe("true");
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    expect(saveButton(painter).disabled).toBe(false);
  });

  it("✎ on a period chip opens the period dialog with that period", async () => {
    const { painter } = await mount();
    const editor = await openEditor(painter, "edit-p2");
    expect(editor.period?.id).toBe("p2");
    expect(editor.departmentName).toBe("Restaurant");
  });

  it("a zone offers neither ✎ nor + New period", async () => {
    const { painter } = await mount();
    await pick(painter, "zone:z2");
    expect(part(painter, "new-period")).toBeNull();
    expect(part(painter, "edit-open")).toBeNull();
    expect(painter.shadowRoot!.querySelector("[data-test^=edit-]")).toBeNull();
  });

  it("read-only, there is no ✎ and no + New period, and the Periods link stays", async () => {
    painter = document.createElement("special-day-painter");
    painter.api = specialDayApi([], { days: { sd1: storedDay() }, season: winterDinner });
    painter.model = painterModel();
    painter.specialDayId = "sd1";
    painter.readOnly = true;
    painter.open = true;
    document.body.append(painter);
    await loaded(painter);
    expect(part(painter, "new-period")).toBeNull();
    expect(part(painter, "edit-p1")).toBeNull();
    expect(part(painter, "periods-link")).not.toBeNull();
  });
});

describe("a period the live model no longer lists", () => {
  const withoutLunch = () => {
    const next = painterModel();
    const restaurant = next.departments[0]!;
    restaurant.periods = restaurant.periods.filter(({ id }) => id !== "p1");
    return next;
  };

  it("leaves the draft, and Save sends only the other edits", async () => {
    const day = storedDay({
      paint: [{ departmentId: "d1", date: DEC_15, ranges: [lunch("08:00", "10:00")] }],
    });
    const { painter, writes } = await mount({ days: { sd1: day } });
    chip(painter, "paint-p1").click();
    await drag(painter, DEC_14, at("13:00"), at("16:00"));
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_15, at("19:00"), at("22:00"));
    expect(grid(painter).days.get(DEC_15)).toEqual([
      lunch("08:00", "10:00"),
      dinner("19:00", "22:00"),
    ]);
    day.paint = [];
    painter.model = withoutLunch();
    await settle(painter);
    expect(part(painter, "paint-p1")).toBeNull();
    expect(grid(painter).days.get(DEC_14) ?? []).toEqual([]);
    expect(
      grid(painter).shadowRoot!.querySelectorAll(
        `.day[data-column="${DEC_14}"] .block:not(.underlay)`,
      ).length,
    ).toBe(0);
    expect(grid(painter).days.get(DEC_15)).toEqual([dinner("19:00", "22:00")]);
    expect(saveButton(painter).disabled).toBe(false);
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    expect((writes[0]!.body as { paint: unknown }).paint).toEqual([
      { departmentId: "d1", date: DEC_15, ranges: [dinner("19:00", "22:00")] },
    ]);
  });

  it("leaves a draft whose only edit used it with nothing to save", async () => {
    const { painter, writes } = await mount();
    chip(painter, "paint-p1").click();
    await drag(painter, DEC_14, at("13:00"), at("16:00"));
    expect(saveButton(painter).disabled).toBe(false);
    painter.model = withoutLunch();
    await settle(painter);
    expect(grid(painter).days.get(DEC_14) ?? []).toEqual([]);
    expect(saveButton(painter).disabled).toBe(true);
    expect(writes).toEqual([]);
  });
});

describe("a period the live model no longer lists, moved to a replacement", () => {
  it("leaves the replacement's saved block on a date the draft changed, and Save sends it beside the painted one", async () => {
    const day = storedDay({
      paint: [{ departmentId: "d1", date: DEC_15, ranges: [lunch("08:00", "10:00")] }],
    });
    const { painter, writes } = await mount({ days: { sd1: day } });
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_15, at("19:00"), at("22:00"));
    expect(grid(painter).days.get(DEC_15)).toEqual([
      lunch("08:00", "10:00"),
      dinner("19:00", "22:00"),
    ]);
    day.paint = [{ departmentId: "d1", date: DEC_15, ranges: [dinner("08:00", "10:00")] }];
    const next = painterModel();
    const restaurant = next.departments[0]!;
    restaurant.periods = restaurant.periods.filter(({ id }) => id !== "p1");
    painter.model = next;
    await settle(painter);
    expect(part(painter, "paint-p1")).toBeNull();
    await expect
      .poll(() => grid(painter).days.get(DEC_15))
      .toEqual([dinner("08:00", "10:00"), dinner("19:00", "22:00")]);
    expect(saveButton(painter).disabled).toBe(false);
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    expect((writes[0]!.body as { paint: unknown }).paint).toEqual([
      {
        departmentId: "d1",
        date: DEC_15,
        ranges: [dinner("08:00", "10:00"), dinner("19:00", "22:00")],
      },
    ]);
  });
});

describe("a period deleted with a replacement before the stored day is read again", () => {
  const withoutLunch = () => {
    const next = painterModel();
    const restaurant = next.departments[0]!;
    restaurant.periods = restaurant.periods.filter(({ id }) => id !== "p1");
    return next;
  };
  /** Mounts a day with Lunch 08:00–10:00 saved on Dec 15, then stores Dinner there in its place
   *  and drops Lunch from the model, with each re-read of the day awaiting `reread`; `reads` counts
   *  the re-reads. */
  async function deleteLunch(
    reread: () => Promise<unknown> | undefined,
    more: SpecialDayAnswers = {},
  ) {
    let follow: () => Promise<unknown> | undefined = () => undefined;
    let reads = 0;
    const day = storedDay({
      paint: [{ departmentId: "d1", date: DEC_15, ranges: [lunch("08:00", "10:00")] }],
    });
    const mounted = await mount({
      ...more,
      days: { sd1: day, ...more.days },
      dayAfter: () => follow(),
    });
    follow = () => {
      reads += 1;
      return reread();
    };
    day.paint = [{ departmentId: "d1", date: DEC_15, ranges: [dinner("08:00", "10:00")] }];
    mounted.painter.model = withoutLunch();
    await settle(mounted.painter);
    expect(part(mounted.painter, "paint-p1")).toBeNull();
    chip(mounted.painter, "paint-p2").click();
    await drag(mounted.painter, DEC_15, at("19:00"), at("22:00"));
    chip(mounted.painter, "paint-closed").click();
    await drag(mounted.painter, DEC_15, at("08:00"), at("09:00"));
    expect(grid(mounted.painter).days.get(DEC_15)).toEqual([
      closed("08:00", "09:00"),
      dinner("19:00", "22:00"),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle(mounted.painter);
    expectSaveOffered(mounted.painter);
    return { ...mounted, reads: () => reads };
  }
  function expectSaveOffered(painter: SpecialDayPainter) {
    expect(saveButton(painter).disabled).toBe(false);
    expect(saveButton(painter).variant).toBe("primary");
  }
  const refilled = [closed("08:00", "09:00"), dinner("09:00", "10:00"), dinner("19:00", "22:00")];
  const sentPaint = (write: Write) => (write.body as { paint: unknown }).paint;

  it("keeps Save offered while the re-read hangs, and a press sends the replacement beside the paint made meanwhile once it lands", async () => {
    let release: () => void = () => {};
    const hung = new Promise<void>((resolve) => (release = resolve));
    const { painter, writes, reads } = await deleteLunch(() => hung);
    saveButton(painter).click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle(painter);
    expect(writes).toEqual([]);
    expect(frame(painter).busy).toBe(true);
    release();
    await expect.poll(() => writes.length).toBe(1);
    expect(sentPaint(writes[0]!)).toEqual([{ departmentId: "d1", date: DEC_15, ranges: refilled }]);
    expect(reads()).toBe(1);
  });

  it("refuses a press beside Save when its re-read fails, keeping Save offered, and a later press reads again and sends the replacement", async () => {
    let failing = true;
    const { painter, writes, reads } = await deleteLunch(() =>
      failing ? Promise.reject(new Error("offline")) : undefined,
    );
    expect(reads()).toBe(1);
    saveButton(painter).click();
    await expect.poll(() => frame(painter).refusal).toBe(t("menu.save_error"));
    await settle(painter);
    expect(reads()).toBe(2);
    expect(writes).toEqual([]);
    expect(frame(painter).busy).toBe(false);
    expectSaveOffered(painter);
    failing = false;
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(sentPaint(writes[0]!)).toEqual([{ departmentId: "d1", date: DEC_15, ranges: refilled }]);
    expect(reads()).toBe(3);
  });

  for (const leaving of ["closed first", "switched while open"] as const)
    it(`reads nothing while a later save's write is out, after a press waiting on a hung re-read is left behind (${leaving})`, async () => {
      let hung = true;
      let hold: () => void = () => {};
      const { painter, writes, reads } = await deleteLunch(
        () => {
          if (!hung) return undefined;
          hung = false;
          return new Promise<void>(() => {});
        },
        {
          days: { sd2: storedDay({ id: "sd2", name: "New Year" }) },
          answer: () => new Promise<void>((resolve) => (hold = resolve)),
        },
      );
      saveButton(painter).click();
      await settle(painter);
      expect(frame(painter).busy).toBe(true);
      if (leaving === "closed first") {
        frame(painter).dispatchEvent(
          new CustomEvent("painter-close", { bubbles: true, composed: true }),
        );
        await settle(painter);
      }
      painter.specialDayId = "sd2";
      painter.open = true;
      await loaded(painter);
      chip(painter, "paint-p2").click();
      await drag(painter, DEC_14, at("19:00"), at("22:00"));
      saveButton(painter).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]!.url).toContain("sd2");
      const before = reads();
      painter.model = painterModel();
      await settle(painter);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(reads() - before).toBe(0);
      hold();
      await expect.poll(() => frame(painter).busy).toBe(false);
    });

  it("reads the stored day again when a save that was out as the period was deleted is refused", async () => {
    let reads = 0;
    let refuse: () => void = () => {};
    const day = storedDay({
      paint: [{ departmentId: "d1", date: DEC_15, ranges: [lunch("08:00", "10:00")] }],
    });
    const { painter, writes } = await mount({
      days: { sd1: day },
      dayAfter: () => {
        reads += 1;
        return undefined;
      },
      answer: () => new Promise((resolve) => (refuse = () => resolve({ code: "server.internal" }))),
    });
    reads = 0;
    chip(painter, "paint-p2").click();
    await drag(painter, DEC_15, at("19:00"), at("22:00"));
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    day.paint = [{ departmentId: "d1", date: DEC_15, ranges: [dinner("08:00", "10:00")] }];
    painter.model = withoutLunch();
    await settle(painter);
    expect(reads).toBe(0);
    refuse();
    await expect
      .poll(() => grid(painter).days.get(DEC_15))
      .toEqual([dinner("08:00", "10:00"), dinner("19:00", "22:00")]);
    expect(reads).toBe(1);
    await settle(painter);
    expectSaveOffered(painter);
  });
});
