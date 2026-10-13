import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host, mount } from "@waitron/ui/src/test-helpers.js";
import type { Paint } from "../paint-model.js";
import type { PaintGrid, PaintChange } from "./paint-grid.js";
import "./paint-grid.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const periods = [
  { id: "breakfast", name: "Breakfast", colour: "amber" as const },
  { id: "lunch", name: "Lunch", colour: "green" as const },
  { id: "afternoon", name: "Afternoon", colour: "blue" as const },
  { id: "dinner", name: "Dinner", colour: "red" as const },
];
const lunch: Paint = { periodId: "lunch", startsAt: "13:00", endsAt: "16:00" };

async function grid(
  days: Record<string, Paint[]> = { mon: [], thu: [lunch] },
  options: Partial<Pick<PaintGrid, "chosen" | "closedErases" | "paintable" | "underlay">> = {},
) {
  const el = (await mount("<paint-grid></paint-grid>")) as PaintGrid;
  el.columns = Object.keys(days).map((key) => ({
    key,
    label: key === "mon" ? "Monday" : key === "thu" ? "Thursday" : key,
  }));
  el.days = new Map(Object.entries(days));
  el.periods = periods;
  el.cutover = "06:00";
  el.closedErases = options.closedErases ?? true;
  el.chosen = "chosen" in options ? options.chosen : "afternoon";
  if (options.paintable) el.paintable = options.paintable;
  if (options.underlay) el.underlay = options.underlay;
  await el.updateComplete;
  return el;
}

function point(el: PaintGrid, key: string, minute: number, type: string, target?: EventTarget) {
  const day = el.shadowRoot!.querySelector<HTMLElement>(`.day[data-column="${key}"]`)!;
  const box = day.getBoundingClientRect();
  (target ?? (type === "pointerdown" ? day : window)).dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: 7,
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + (minute / 1440) * box.height,
    }),
  );
}
async function drag(el: PaintGrid, key: string, from: number, to: number) {
  point(el, key, from, "pointerdown");
  point(el, key, to, "pointermove");
  await el.updateComplete;
  point(el, key, to, "pointerup");
  await el.updateComplete;
}
function changes(el: PaintGrid) {
  const result: PaintChange[] = [];
  el.addEventListener("paint-change", (event) => result.push(event.detail));
  return result;
}
function block(el: PaintGrid, key: string, index = 0) {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(
    `.day[data-column="${key}"] button.block[data-index="${index}"]`,
  )!;
}
function menu(el: PaintGrid) {
  return el.shadowRoot!.querySelector<HTMLElement>(".menu")!;
}
function menuButton(el: PaintGrid, label: string) {
  return [...menu(el).querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  )!;
}

test("draws 15-minute rows about 5px tall from the changeover with hour labels", async () => {
  const el = await grid();
  const day = el.shadowRoot!.querySelector<HTMLElement>('.day[data-column="thu"]')!;
  expect(day.getBoundingClientRect().height).toBeCloseTo(96 * 5, 0);
  const hours = [...el.shadowRoot!.querySelectorAll(".hour")].map((hour) => hour.textContent);
  expect(hours[0]).toBe("06:00");
  expect(hours).toContain("13:00");
  const at = block(el, "thu").getBoundingClientRect();
  const box = day.getBoundingClientRect();
  expect((at.top - box.top) / box.height).toBeCloseTo(7 / 24, 2);
  expect(at.height / box.height).toBeCloseTo(3 / 24, 2);
  expect(block(el, "thu").textContent).toContain("Lunch");
  expect(block(el, "thu").textContent).toContain("13:00–16:00");
});

test("each column heading holds the day name and a slot for its menu on one line", async () => {
  const el = await grid();
  const heading = el.shadowRoot!.querySelector<HTMLElement>('.heading[data-column="thu"]')!;
  expect(heading.textContent).toContain("Thursday");
  expect(heading.querySelector('slot[name="column-menu-thu"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('.day[data-column="thu"]')!.getAttribute("aria-label")).toBe(
    "Thursday",
  );
});

test("dragging down a day previews the stretch and paints the chosen period on release", async () => {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  const seen = changes(el);
  point(el, "mon", 840, "pointerdown");
  point(el, "mon", 1050, "pointermove");
  await el.updateComplete;
  const preview = el.shadowRoot!.querySelector<HTMLElement>(".preview")!;
  expect(preview).not.toBeNull();
  expect(getComputedStyle(preview).borderTopStyle).toBe("dashed");
  expect(preview.textContent).toContain("Dinner 20:00–23:30");
  expect(seen).toEqual([]);
  point(el, "mon", 1050, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([
    { key: "mon", day: [{ periodId: "dinner", startsAt: "20:00", endsAt: "23:30" }] },
  ]);
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
});

test("dragging over Lunch replaces its end and the preview says so", async () => {
  const el = await grid({ thu: [lunch] }, { chosen: "afternoon" });
  const seen = changes(el);
  point(el, "thu", 540, "pointerdown", block(el, "thu"));
  point(el, "thu", 840, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")!.textContent).toContain("replaces Lunch");
  point(el, "thu", 840, "pointerup");
  expect(seen).toEqual([
    {
      key: "thu",
      day: [
        { periodId: "lunch", startsAt: "13:00", endsAt: "15:00" },
        { periodId: "afternoon", startsAt: "15:00", endsAt: "20:00" },
      ],
    },
  ]);
});

test("two touching drags of one period join into one block", async () => {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  const seen = changes(el);
  el.addEventListener("paint-change", (event) => {
    el.days = new Map([[event.detail.key, event.detail.day]]);
  });
  await drag(el, "mon", 840, 960);
  await drag(el, "mon", 960, 1050);
  expect(seen.at(-1)).toEqual({
    key: "mon",
    day: [{ periodId: "dinner", startsAt: "20:00", endsAt: "23:30" }],
  });
  expect(el.shadowRoot!.querySelectorAll('.day[data-column="mon"] button.block')).toHaveLength(1);
});

test("an upward drag from the bottom of the grid paints up to the changeover", async () => {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  const seen = changes(el);
  await drag(el, "mon", 1440, 1260);
  expect(seen).toEqual([
    { key: "mon", day: [{ periodId: "dinner", startsAt: "03:00", endsAt: "06:00" }] },
  ]);
});

test("a click without a drag paints nothing, even on the top row", async () => {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  const seen = changes(el);
  await drag(el, "mon", 0, 0);
  await drag(el, "mon", 600, 602);
  expect(seen).toEqual([]);
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
});

test("with nothing chosen, a drag paints nothing", async () => {
  const el = await grid({ mon: [] }, { chosen: undefined });
  const seen = changes(el);
  point(el, "mon", 840, "pointerdown");
  point(el, "mon", 1050, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
  point(el, "mon", 1050, "pointerup");
  expect(seen).toEqual([]);
});

test("Closed paints erase in a department column", async () => {
  const el = await grid({ thu: [lunch] }, { chosen: null });
  const seen = changes(el);
  await drag(el, "thu", 540, 600);
  expect(seen).toEqual([
    { key: "thu", day: [{ periodId: "lunch", startsAt: "13:00", endsAt: "15:00" }] },
  ]);
});

test("clicking a block selects it and opens its menu; choosing a period changes it", async () => {
  const el = await grid();
  const seen = changes(el);
  await userEvent.click(block(el, "thu"));
  await el.updateComplete;
  expect(block(el, "thu").getAttribute("aria-expanded")).toBe("true");
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(seen).toEqual([]);
  const labels = [...menu(el).querySelectorAll("wt-button")].map((b) => b.textContent!.trim());
  expect(labels).toEqual(["Breakfast", "Lunch", "Afternoon", "Dinner", "Closed", "Delete"]);
  expect(menuButton(el, "Lunch").hasAttribute("disabled")).toBe(true);
  await userEvent.click(menuButton(el, "Afternoon"));
  await el.updateComplete;
  expect(seen).toEqual([
    { key: "thu", day: [{ periodId: "afternoon", startsAt: "13:00", endsAt: "16:00" }] },
  ]);
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(block(el, "thu").getAttribute("aria-expanded")).toBe("false");
});

test("a selected department block's Delete leaves the time unpainted", async () => {
  const el = await grid({
    thu: [lunch, { periodId: "dinner", startsAt: "20:00", endsAt: "23:00" }],
  });
  const seen = changes(el);
  await userEvent.click(block(el, "thu", 0));
  await userEvent.click(menuButton(el, "Delete"));
  expect(seen).toEqual([
    { key: "thu", day: [{ periodId: "dinner", startsAt: "20:00", endsAt: "23:00" }] },
  ]);
});

test("a department block changed to Closed is erased", async () => {
  const el = await grid();
  const seen = changes(el);
  await userEvent.click(block(el, "thu"));
  await userEvent.click(menuButton(el, "Closed"));
  expect(seen).toEqual([{ key: "thu", day: [] }]);
});

test("in a zone column Closed is stored, its menu offers what the host allows, and Delete removes it", async () => {
  const closed: Paint = { periodId: null, startsAt: "15:00", endsAt: "17:00" };
  const el = await grid(
    { zone: [] },
    {
      chosen: null,
      closedErases: false,
      paintable: [null],
      underlay: new Map([["zone", [lunch]]]),
    },
  );
  const seen = changes(el);
  await drag(el, "zone", 540, 660);
  expect(seen).toEqual([{ key: "zone", day: [closed] }]);
  expect(el.shadowRoot!.querySelector(".all-closed")).toBeNull();
  el.days = new Map([["zone", [closed]]]);
  await el.updateComplete;
  await userEvent.click(block(el, "zone"));
  const labels = [...menu(el).querySelectorAll("wt-button")].map((b) => b.textContent!.trim());
  expect(labels).toEqual(["Closed", "Delete"]);
  await userEvent.click(menuButton(el, "Delete"));
  expect(seen.at(-1)).toEqual({ key: "zone", day: [] });
});

test("the underlay is drawn faded and inert under the paint", async () => {
  const el = await grid(
    { zone: [] },
    { closedErases: false, underlay: new Map([["zone", [lunch]]]) },
  );
  host.style.setProperty("--wt-opacity-disabled", "0.37");
  const faded = el.shadowRoot!.querySelector<HTMLElement>('.day[data-column="zone"] .underlay')!;
  expect(faded.tagName).toBe("DIV");
  expect(faded.textContent).toContain("Lunch");
  expect(getComputedStyle(faded, "::before").opacity).toBe("0.37");
  expect(getComputedStyle(faded).pointerEvents).toBe("none");
});

test("periods paint with their palette tokens; Closed and an empty department day are hatched", async () => {
  const el = await grid({
    mon: [],
    thu: [lunch, { periodId: null, startsAt: "17:00", endsAt: "18:00" }],
  });
  host.style.setProperty("--wt-color-palette-green", "rgb(25, 35, 45)");
  host.style.setProperty("--wt-color-on-palette-green", "rgb(215, 225, 235)");
  expect(getComputedStyle(block(el, "thu")).backgroundColor).toBe("rgb(25, 35, 45)");
  expect(getComputedStyle(block(el, "thu")).color).toBe("rgb(215, 225, 235)");
  expect(getComputedStyle(block(el, "thu", 1)).backgroundImage).toContain(
    "repeating-linear-gradient",
  );
  const empty = el.shadowRoot!.querySelector<HTMLElement>('.day[data-column="mon"] .all-closed')!;
  expect(empty.textContent).toContain("Closed all day");
  expect(getComputedStyle(empty).backgroundImage).toContain("repeating-linear-gradient");
  expect(el.shadowRoot!.querySelector('.day[data-column="thu"] .all-closed')).toBeNull();
});

test("a block is a button named by its day, period and range", async () => {
  const el = await grid();
  expect(block(el, "thu").getAttribute("aria-label")).toBe("Thursday, Lunch 13:00–16:00");
});

test.each(["en", "es"] as const)("text reads in %s", async (locale) => {
  setLocale(locale);
  const el = await grid({ mon: [] });
  expect(el.shadowRoot!.querySelector(".all-closed")!.textContent).toContain(
    locale === "en" ? "Closed all day" : "Cerrado todo el día",
  );
});

test("seven columns fit at 1280px; at 390px the grid scrolls sideways with the time column pinned", async () => {
  const week = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((key) => [key, [] as Paint[]]),
  );
  const el = await grid(week);
  host.style.width = "1280px";
  await el.updateComplete;
  const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
  host.style.width = "390px";
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  const times = el.shadowRoot!.querySelector<HTMLElement>(".times")!;
  const before = times.getBoundingClientRect().left;
  scroll.scrollLeft = 200;
  expect(times.getBoundingClientRect().left).toBeCloseTo(before, 0);
});

test("the click that ends a drag inside a block does not select it; the next click does", async () => {
  const el = await grid({ thu: [lunch] }, { chosen: "afternoon" });
  point(el, "thu", 450, "pointerdown", block(el, "thu"));
  point(el, "thu", 540, "pointermove");
  point(el, "thu", 540, "pointerup");
  block(el, "thu").click();
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  block(el, "thu").click();
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
});
