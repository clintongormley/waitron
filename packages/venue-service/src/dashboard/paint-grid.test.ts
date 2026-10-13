import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host, mount } from "@waitron/ui/src/test-helpers.js";
import type { Paint } from "../paint-model.js";
import type { PaintGrid, PaintChange } from "./paint-grid.js";
import "./paint-grid.js";
import "@waitron/ui/src/components/wt-modal.js";

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

function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
const dinner: Paint = { periodId: "dinner", startsAt: "20:00", endsAt: "23:00" };
function hostUpdates(el: PaintGrid) {
  el.addEventListener("paint-change", (event) => {
    el.days = new Map([...el.days, [event.detail.key, event.detail.day]]);
  });
}
const tick = () => new Promise((resolve) => setTimeout(resolve));

test("Escape in a block's menu inside a guarded modal closes the menu only and refocuses the block", async () => {
  const modal = (await mount(
    `<wt-modal size="full" heading="Winter week"><paint-grid></paint-grid></wt-modal>`,
  )) as HTMLElementTagNameMap["wt-modal"];
  let asked = 0;
  modal.beforeClose = async () => {
    asked++;
    return false;
  };
  modal.open = true;
  await modal.updateComplete;
  const el = modal.querySelector("paint-grid")!;
  el.columns = [{ key: "thu", label: "Thursday" }];
  el.periods = periods;
  el.days = new Map([["thu", [lunch]]]);
  el.chosen = "afternoon";
  await el.updateComplete;
  block(el, "thu").focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  await tick();
  expect(asked).toBe(0);
  expect(modal.open).toBe(true);
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(block(el, "thu").getAttribute("aria-expanded")).toBe("false");
  expect(deepActive()).toBe(block(el, "thu"));
});

test("choosing a period returns focus to the changed block", async () => {
  const el = await grid({ thu: [lunch] });
  hostUpdates(el);
  await userEvent.click(block(el, "thu"));
  await userEvent.click(menuButton(el, "Afternoon"));
  await el.updateComplete;
  expect(block(el, "thu").textContent).toContain("Afternoon");
  expect(deepActive()).toBe(block(el, "thu"));
});

test("Delete moves focus to the next block, else the previous, else the column", async () => {
  const el = await grid({ thu: [lunch, dinner] });
  hostUpdates(el);
  await userEvent.click(block(el, "thu", 0));
  await userEvent.click(menuButton(el, "Delete"));
  await el.updateComplete;
  expect(deepActive()).toBe(block(el, "thu", 0));
  expect(block(el, "thu", 0).textContent).toContain("Dinner");
  await userEvent.click(block(el, "thu", 0));
  await userEvent.click(menuButton(el, "Delete"));
  await el.updateComplete;
  expect(deepActive()).toBe(el.shadowRoot!.querySelector('.day[data-column="thu"]'));

  el.days = new Map([["thu", [lunch, dinner]]]);
  await el.updateComplete;
  await userEvent.click(block(el, "thu", 1));
  await userEvent.click(menuButton(el, "Delete"));
  await el.updateComplete;
  expect(deepActive()).toBe(block(el, "thu", 0));
  expect(block(el, "thu", 0).textContent).toContain("Lunch");
});

test("pointercancel ends a drag without painting and the next drag paints", async () => {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  const seen = changes(el);
  point(el, "mon", 840, "pointerdown");
  point(el, "mon", 1050, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).not.toBeNull();
  point(el, "mon", 1050, "pointercancel");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
  point(el, "mon", 1050, "pointerup");
  expect(seen).toEqual([]);
  await drag(el, "mon", 840, 960);
  expect(seen).toEqual([
    { key: "mon", day: [{ periodId: "dinner", startsAt: "20:00", endsAt: "22:00" }] },
  ]);
});

test("losing the pointer capture ends a drag without painting", async () => {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  const seen = changes(el);
  point(el, "mon", 840, "pointerdown");
  point(el, "mon", 1050, "pointermove");
  await el.updateComplete;
  point(el, "mon", 1050, "lostpointercapture", el.shadowRoot!.querySelector(".day")!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
  point(el, "mon", 1050, "pointerup");
  expect(seen).toEqual([]);
});

test("clicking elsewhere dismisses the menu and clears the selection", async () => {
  const el = await grid({ thu: [lunch] });
  await userEvent.click(block(el, "thu"));
  expect(menu(el).matches(":popover-open")).toBe(true);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('.heading[data-column="thu"]')!);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(block(el, "thu").getAttribute("aria-expanded")).toBe("false");
});

test("after a drag that ends off any block, a later click with no pointerdown opens the menu", async () => {
  const el = await grid({ thu: [lunch] }, { chosen: "dinner" });
  await drag(el, "thu", 840, 960);
  await tick();
  block(el, "thu").click();
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
});

test("the menu is a dialog the block controls, and Tab from its last choice reaches the next block", async () => {
  const el = await grid({ thu: [lunch, dinner] });
  expect(block(el, "thu").getAttribute("aria-haspopup")).toBe("dialog");
  expect(menu(el).getAttribute("role")).toBe("dialog");
  expect(block(el, "thu").getAttribute("aria-controls")).toBe(menu(el).id);
  block(el, "thu").focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  menuButton(el, "Delete").focus();
  await userEvent.tab();
  expect(deepActive()).toBe(block(el, "thu", 1));
});

test("the selected block's outline reads the focus-ring tokens", async () => {
  const el = await grid({ thu: [lunch] });
  host.style.setProperty("--wt-focus-ring", "3px dashed rgb(1, 2, 3)");
  host.style.setProperty("--wt-focus-offset", "5px");
  await userEvent.click(block(el, "thu"));
  const style = getComputedStyle(block(el, "thu"));
  expect(style.outlineStyle).toBe("dashed");
  expect(style.outlineWidth).toBe("3px");
  expect(style.outlineColor).toBe("rgb(1, 2, 3)");
  expect(style.outlineOffset).toBe("5px");
});

test("the menu acts on the block it opened on after the host inserts one before it", async () => {
  const el = await grid({ thu: [lunch] });
  const seen = changes(el);
  await userEvent.click(block(el, "thu"));
  const breakfast: Paint = { periodId: "breakfast", startsAt: "08:00", endsAt: "12:00" };
  el.days = new Map([["thu", [breakfast, lunch]]]);
  await el.updateComplete;
  await userEvent.click(menuButton(el, "Afternoon"));
  expect(seen).toEqual([
    { key: "thu", day: [breakfast, { periodId: "afternoon", startsAt: "13:00", endsAt: "16:00" }] },
  ]);
});

test("the menu closes when the host removes its block", async () => {
  const el = await grid({ thu: [lunch] });
  await userEvent.click(block(el, "thu"));
  el.days = new Map([["thu", [dinner]]]);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
});

test("the drag preview is not a live region", async () => {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  point(el, "mon", 840, "pointerdown");
  point(el, "mon", 1050, "pointermove");
  await el.updateComplete;
  const preview = el.shadowRoot!.querySelector(".preview")!;
  expect(preview.getAttribute("role")).toBeNull();
  expect(preview.getAttribute("aria-live")).toBeNull();
  point(el, "mon", 1050, "pointerup");
});

const breakfast: Paint = { periodId: "breakfast", startsAt: "08:00", endsAt: "12:00" };
function columnMenu(el: PaintGrid, key: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    `.heading[data-column="${key}"] wt-row-actions`,
  )!;
}
function columnAction(el: PaintGrid, key: string, label: string) {
  return [...columnMenu(el, key).querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  )!;
}
function chooser(el: PaintGrid) {
  return el.shadowRoot!.querySelector<HTMLElement>(".chooser")!;
}
function choiceLabel(el: PaintGrid, label: string) {
  return [...chooser(el).querySelectorAll<HTMLLabelElement>("label")].find(
    (row) => row.textContent!.trim() === label,
  )!;
}
function choice(el: PaintGrid, label: string) {
  return choiceLabel(el, label).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}
function chooserButton(el: PaintGrid, label: string) {
  return [...chooser(el).querySelectorAll<HTMLElementTagNameMap["wt-button"]>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  )!;
}
async function openChooser(el: PaintGrid, key: string) {
  await userEvent.click(columnMenu(el, key));
  await userEvent.click(columnAction(el, key, "Copy to…"));
  await el.updateComplete;
}
const week = { mon: [breakfast, lunch], tue: [dinner], wed: [], thu: [] as Paint[] };

test("each day's ⋮ sits on its heading line and offers Copy to… and Clear", async () => {
  const el = await grid({ mon: [lunch], thu: [] });
  const heading = el.shadowRoot!.querySelector<HTMLElement>('.heading[data-column="thu"]')!;
  const trigger = columnMenu(el, "thu");
  expect(trigger.label).toBe("Thursday options");
  expect(trigger.icon).toBe("kebab");
  const name = heading.querySelector("span")!.getBoundingClientRect();
  const kebab = trigger.getBoundingClientRect();
  expect(kebab.top).toBeLessThan(name.bottom);
  expect(kebab.bottom).toBeGreaterThan(name.top);
  await userEvent.click(trigger);
  expect(columnAction(el, "thu", "Copy to…")).toBeDefined();
  expect(columnAction(el, "thu", "Clear")).toBeDefined();
});

test("Copy to… lists the other days; Copy stays quiet and disabled until one is ticked", async () => {
  const el = await grid(week);
  el.columns = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
    { key: "wed", label: "Wednesday" },
    { key: "thu", label: "Thursday" },
  ];
  await el.updateComplete;
  await openChooser(el, "mon");
  expect(chooser(el).matches(":popover-open")).toBe(true);
  expect(chooser(el).getAttribute("role")).toBe("dialog");
  expect(chooser(el).textContent).toContain("Copy Monday to");
  const labels = [...chooser(el).querySelectorAll("label")].map((row) => row.textContent!.trim());
  expect(labels).toEqual(["Tuesday", "Wednesday", "Thursday"]);
  expect(chooser(el).querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
  expect(chooser(el).querySelector("wt-switch")).toBeNull();
  expect(choice(el, "Tuesday").name).toBe("copyTo-tue");
  expect(chooserButton(el, "Copy").disabled).toBe(true);
  expect(chooserButton(el, "Copy").variant).toBe("secondary");
  await userEvent.click(choice(el, "Wednesday"));
  await el.updateComplete;
  expect(chooserButton(el, "Copy").disabled).toBe(false);
  expect(chooserButton(el, "Copy").variant).toBe("primary");
});

test("Copy copies the day by value to every ticked day, one change per day", async () => {
  const el = await grid(week);
  const seen = changes(el);
  await openChooser(el, "mon");
  await userEvent.click(choice(el, "tue"));
  await userEvent.click(choice(el, "Thursday"));
  await el.updateComplete;
  await userEvent.click(chooserButton(el, "Copy"));
  await el.updateComplete;
  expect(seen).toEqual([
    { key: "tue", day: [breakfast, lunch] },
    { key: "thu", day: [breakfast, lunch] },
  ]);
  expect(seen[0]!.day[0]).not.toBe(breakfast);
  expect(seen[0]!.day[0]).not.toBe(seen[1]!.day[0]);
  expect(chooser(el).matches(":popover-open")).toBe(false);
});

test("Cancel closes the chooser and copies nothing; reopening starts with nothing ticked", async () => {
  const el = await grid(week);
  const seen = changes(el);
  await openChooser(el, "mon");
  await userEvent.click(choice(el, "tue"));
  await userEvent.click(chooserButton(el, "Cancel"));
  await el.updateComplete;
  expect(chooser(el).matches(":popover-open")).toBe(false);
  expect(seen).toEqual([]);
  await openChooser(el, "mon");
  expect(choice(el, "tue").checked).toBe(false);
  expect(chooserButton(el, "Copy").disabled).toBe(true);
});

test("Clear empties the day", async () => {
  const el = await grid(week);
  const seen = changes(el);
  await userEvent.click(columnMenu(el, "mon"));
  await userEvent.click(columnAction(el, "mon", "Clear"));
  expect(seen).toEqual([{ key: "mon", day: [] }]);
});

test("the ⋮ menu and the chooser work from the keyboard; Escape in a guarded modal closes only the chooser", async () => {
  const modal = (await mount(
    `<wt-modal size="full" heading="Winter week"><paint-grid></paint-grid></wt-modal>`,
  )) as HTMLElementTagNameMap["wt-modal"];
  let asked = 0;
  modal.beforeClose = async () => {
    asked++;
    return false;
  };
  modal.open = true;
  await modal.updateComplete;
  const el = modal.querySelector("paint-grid")!;
  el.columns = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
  ];
  el.periods = periods;
  el.days = new Map([
    ["mon", [lunch]],
    ["tue", []],
  ]);
  await el.updateComplete;
  const seen = changes(el);
  columnMenu(el, "mon").focus();
  await userEvent.keyboard("{Enter}");
  columnAction(el, "mon", "Copy to…").focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(chooser(el).matches(":popover-open")).toBe(true);
  expect(chooser(el).contains(deepActive()) || choice(el, "Tuesday").matches(":focus")).toBe(true);
  await userEvent.keyboard(" ");
  await el.updateComplete;
  expect(choice(el, "Tuesday").checked).toBe(true);
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  await tick();
  expect(asked).toBe(0);
  expect(modal.open).toBe(true);
  expect(chooser(el).matches(":popover-open")).toBe(false);
  expect(seen).toEqual([]);
  expect(columnMenu(el, "mon").matches(":focus")).toBe(true);
  await openChooser(el, "mon");
  await userEvent.click(choice(el, "Tuesday"));
  chooserButton(el, "Copy").focus();
  await userEvent.keyboard("{Enter}");
  expect(seen).toEqual([{ key: "tue", day: [lunch] }]);
});

test.each(["Delete", "Backspace"])(
  "a focused block answers %s as the menu's Delete does",
  async (key) => {
    const el = await grid({ thu: [lunch, dinner] });
    hostUpdates(el);
    const seen = changes(el);
    block(el, "thu", 0).focus();
    await userEvent.keyboard(`{${key}}`);
    await el.updateComplete;
    expect(seen).toEqual([{ key: "thu", day: [dinner] }]);
    expect(deepActive()).toBe(block(el, "thu", 0));
    expect(block(el, "thu", 0).textContent).toContain("Dinner");
    expect(menu(el).matches(":popover-open")).toBe(false);
  },
);

test("the column focused after a Delete shows the focus-ring tokens", async () => {
  const el = await grid({ thu: [lunch] });
  hostUpdates(el);
  host.style.setProperty("--wt-focus-ring", "3px dashed rgb(1, 2, 3)");
  host.style.setProperty("--wt-focus-offset", "5px");
  block(el, "thu").focus();
  await userEvent.keyboard("{Delete}");
  await el.updateComplete;
  const column = el.shadowRoot!.querySelector<HTMLElement>('.day[data-column="thu"]')!;
  expect(deepActive()).toBe(column);
  const style = getComputedStyle(column);
  expect(style.outlineStyle).toBe("dashed");
  expect(style.outlineColor).toBe("rgb(1, 2, 3)");
  expect(style.outlineOffset).toBe("5px");
});

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
async function tallGrid() {
  const el = await grid({ mon: [] }, { chosen: "dinner" });
  el.style.height = "200px";
  await el.updateComplete;
  const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  return { el, scroll };
}
function pointAt(clientY: number, type = "pointermove") {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientY }));
}
function previewEnd(el: PaintGrid) {
  return el.shadowRoot!.querySelector(".preview")?.textContent?.match(/–(\d\d:\d\d)/)?.[1];
}

test("the grid scrolls itself inside the height its host gives it, headings pinned", async () => {
  const { el, scroll } = await tallGrid();
  expect(scroll.clientHeight).toBeLessThanOrEqual(200);
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  const heading = el.shadowRoot!.querySelector<HTMLElement>('.heading[data-column="mon"]')!;
  const top = heading.getBoundingClientRect().top;
  scroll.scrollTop = 150;
  expect(heading.getBoundingClientRect().top).toBeCloseTo(top, 0);
});

test("a drag held below the bottom edge scrolls and keeps stretching, and stops when the pointer comes back", async () => {
  const { el, scroll } = await tallGrid();
  const box = scroll.getBoundingClientRect();
  point(el, "mon", 60, "pointerdown");
  pointAt(box.bottom + 30);
  await el.updateComplete;
  const firstEnd = previewEnd(el);
  await vi.waitFor(() => expect(scroll.scrollTop).toBeGreaterThan(60));
  await el.updateComplete;
  expect(previewEnd(el)! > firstEnd!).toBe(true);
  pointAt(box.bottom - 30);
  await frame();
  const held = scroll.scrollTop;
  await frame();
  await frame();
  await frame();
  expect(scroll.scrollTop).toBe(held);
  pointAt(box.bottom - 30, "pointerup");
});

test("a drag held above the top edge scrolls up, and releasing stops it", async () => {
  const { el, scroll } = await tallGrid();
  scroll.scrollTop = 300;
  await frame();
  const heading = el.shadowRoot!.querySelector<HTMLElement>('.heading[data-column="mon"]')!;
  const box = scroll.getBoundingClientRect();
  const seen = changes(el);
  el.shadowRoot!.querySelector('.day[data-column="mon"]')!.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 7,
      button: 0,
      clientY: box.bottom - 20,
    }),
  );
  pointAt(heading.getBoundingClientRect().top - 10);
  await vi.waitFor(() => expect(scroll.scrollTop).toBeLessThan(250));
  pointAt(heading.getBoundingClientRect().top - 10, "pointerup");
  expect(seen).toHaveLength(1);
  const held = scroll.scrollTop;
  await frame();
  await frame();
  expect(scroll.scrollTop).toBe(held);
});

test("a day's label ticks its checkbox", async () => {
  const el = await grid(week);
  await openChooser(el, "mon");
  await userEvent.click(choiceLabel(el, "tue"));
  await el.updateComplete;
  expect(choice(el, "tue").checked).toBe(true);
  expect(chooserButton(el, "Copy").disabled).toBe(false);
});

test.each(["Delete", "Backspace"])("clicking a block then pressing %s deletes it", async (key) => {
  const el = await grid({ thu: [lunch, dinner] });
  hostUpdates(el);
  const seen = changes(el);
  await userEvent.click(block(el, "thu", 0));
  expect(menu(el).matches(":popover-open")).toBe(true);
  await userEvent.keyboard(`{${key}}`);
  await el.updateComplete;
  expect(seen).toEqual([{ key: "thu", day: [dinner] }]);
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(deepActive()).toBe(block(el, "thu", 0));
});

test.each(["Control", "Meta", "Alt"])(
  "Delete and Backspace with %s held delete nothing",
  async (modifier) => {
    const el = await grid({ thu: [lunch, dinner] });
    const seen = changes(el);
    block(el, "thu", 0).focus();
    await userEvent.keyboard(`{${modifier}>}{Delete}{Backspace}{/${modifier}}`);
    await userEvent.click(block(el, "thu", 0));
    await userEvent.keyboard(`{${modifier}>}{Delete}{Backspace}{/${modifier}}`);
    expect(seen).toEqual([]);
  },
);

test("Clear on an empty day and Copy to a day that already matches send no change for it", async () => {
  const el = await grid({ mon: [lunch], tue: [lunch], wed: [], thu: [] });
  const seen = changes(el);
  await userEvent.click(columnMenu(el, "wed"));
  await userEvent.click(columnAction(el, "wed", "Clear"));
  expect(seen).toEqual([]);
  await openChooser(el, "mon");
  await userEvent.click(choice(el, "tue"));
  await userEvent.click(choice(el, "Thursday"));
  await userEvent.click(chooserButton(el, "Copy"));
  expect(seen).toEqual([{ key: "thu", day: [lunch] }]);
});

async function scrollingDown(el: PaintGrid, scroll: HTMLElement) {
  const box = scroll.getBoundingClientRect();
  point(el, "mon", 60, "pointerdown");
  pointAt(box.bottom + 30);
  await vi.waitFor(() => expect(scroll.scrollTop).toBeGreaterThan(20));
}
async function staysStill(scroll: HTMLElement) {
  const held = scroll.scrollTop;
  await frame();
  await frame();
  await frame();
  expect(scroll.scrollTop).toBe(held);
}

test("pointercancel ends an autoscroll", async () => {
  const { el, scroll } = await tallGrid();
  await scrollingDown(el, scroll);
  pointAt(scroll.getBoundingClientRect().bottom + 30, "pointercancel");
  await staysStill(scroll);
});

test("losing the pointer capture ends an autoscroll", async () => {
  const { el, scroll } = await tallGrid();
  await scrollingDown(el, scroll);
  point(el, "mon", 60, "lostpointercapture", el.shadowRoot!.querySelector(".day")!);
  await staysStill(scroll);
});

test("taking the grid off the page ends an autoscroll", async () => {
  const { el, scroll } = await tallGrid();
  await scrollingDown(el, scroll);
  const parent = el.parentNode!;
  el.remove();
  parent.appendChild(el);
  await el.updateComplete;
  const again = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  again.scrollTop = 40;
  await staysStill(again);
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
});

test("autoscroll starts inside a band about an hour deep at each edge, for a grid that fills the screen", async () => {
  const { el, scroll } = await tallGrid();
  const box = scroll.getBoundingClientRect();
  point(el, "mon", 60, "pointerdown");
  pointAt(box.bottom - 6);
  await vi.waitFor(() => expect(scroll.scrollTop).toBeGreaterThan(20));
  const heading = el.shadowRoot!.querySelector<HTMLElement>('.heading[data-column="mon"]')!;
  pointAt(heading.getBoundingClientRect().bottom + 6);
  const down = scroll.scrollTop;
  await vi.waitFor(() => expect(scroll.scrollTop).toBeLessThan(down - 10));
  pointAt(heading.getBoundingClientRect().bottom + 6, "pointerup");
});

test("a drag held past the edge at the end of the scroll stops redrawing", async () => {
  const { el, scroll } = await tallGrid();
  scroll.scrollTop = scroll.scrollHeight;
  await frame();
  const box = scroll.getBoundingClientRect();
  point(el, "mon", 1200, "pointerdown");
  pointAt(box.bottom + 30);
  await frame();
  await frame();
  await el.updateComplete;
  let renders = 0;
  const render = el.render.bind(el);
  el.render = () => {
    renders++;
    return render();
  };
  await frame();
  await frame();
  await frame();
  await frame();
  await el.updateComplete;
  expect(renders).toBe(0);
  expect(el.shadowRoot!.querySelector(".preview")).not.toBeNull();
  pointAt(box.bottom + 30, "pointerup");
});

test("the heading row is as compact as the ⋮'s touch size allows", async () => {
  const el = await grid();
  const heading = el.shadowRoot!.querySelector<HTMLElement>('.heading[data-column="thu"]')!;
  expect(heading.getBoundingClientRect().height).toBeLessThanOrEqual(46);
});
