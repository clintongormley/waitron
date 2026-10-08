import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host, mount } from "@waitron/ui/src/test-helpers.js";
import type { ServiceGrid } from "./service-grid.js";
import "./service-grid.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

type Grid = ServiceGrid;
const night = { periodId: "night", startsAt: "21:00", endsAt: "03:00" };
async function grid(slots = [night]) {
  const el = (await mount("<service-grid></service-grid>")) as Grid;
  el.dayCutover = "06:00";
  el.columns = [
    {
      key: "fri",
      label: "Friday",
      slots,
      periods: [{ id: "night", name: "Night", colour: "purple" }],
      editable: true,
    },
  ];
  await el.updateComplete;
  return el;
}

test("draws the overnight period as one block inside the business day", async () => {
  const el = await grid();
  const body = el.shadowRoot?.querySelector<HTMLElement>(".day");
  expect(body).toBeTruthy();
  const block = el.shadowRoot!.querySelector<HTMLElement>(".block")!;
  const day = body!.getBoundingClientRect();
  const at = block.getBoundingClientRect();
  expect((at.top - day.top) / day.height).toBeCloseTo(15 / 24, 3);
  expect(at.height / day.height).toBeCloseTo(6 / 24, 3);
  expect(block.textContent).toContain("Night");
  expect(block.textContent).toContain("21:00–03:00");
  expect(el.shadowRoot!.querySelectorAll(".step")).toHaveLength(96);
  expect(el.shadowRoot!.querySelectorAll(".hour")).toHaveLength(25);
});

test("paints a period with its palette fill and matching text tokens", async () => {
  const el = await grid();
  host.style.setProperty("--wt-color-palette-purple", "rgb(25, 35, 45)");
  host.style.setProperty("--wt-color-on-palette-purple", "rgb(215, 225, 235)");
  const block = el.shadowRoot?.querySelector<HTMLElement>(".block");
  expect(block).toBeTruthy();
  expect(getComputedStyle(block!).backgroundColor).toBe("rgb(25, 35, 45)");
  expect(getComputedStyle(block!).color).toBe("rgb(215, 225, 235)");
});

test("read-only and non-editable columns draw periods without focusable controls", async () => {
  const el = await grid();
  el.readOnly = true;
  await el.updateComplete;
  expect(el.shadowRoot?.querySelector(".block")).toBeTruthy();
  expect(el.shadowRoot!.querySelectorAll("button, .day [tabindex]")).toHaveLength(0);
  el.readOnly = false;
  el.columns = [
    {
      key: "fri",
      label: "Friday",
      slots: [night],
      periods: [{ id: "night", name: "Night", colour: "purple" }],
      editable: false,
    },
  ];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("button, .day [tabindex]")).toHaveLength(0);
});

function step(el: Grid, minute: number, column = "fri") {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(
    `[data-column="${column}"] .step[data-minute="${minute}"]`,
  )!;
}
function point(
  el: Grid,
  minute: number,
  type: string,
  target: EventTarget = window,
  pointerId = 7,
) {
  const box = el
    .shadowRoot!.querySelector<HTMLElement>('[data-column="fri"]')!
    .getBoundingClientRect();
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId,
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + (minute / 1440) * box.height,
    }),
  );
}
function events(el: Grid, name: string) {
  const result: unknown[] = [];
  el.addEventListener(name, (event) => result.push((event as CustomEvent).detail));
  return result;
}
function key(target: HTMLElement, name: string, shiftKey = false) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, composed: true }),
  );
}

test("pointer selection previews a dashed range then emits quarter-hour times on release", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  point(el, 360, "pointerdown", step(el, 360));
  point(el, 482, "pointermove");
  await el.updateComplete;
  const preview = el.shadowRoot!.querySelector<HTMLElement>(".selection");
  expect(preview).not.toBeNull();
  expect(getComputedStyle(preview!).borderTopStyle).toBe("dashed");
  expect(preview!.textContent).toContain("12:00–14:00");
  expect(selected).toEqual([]);
  point(el, 482, "pointerup");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "14:00" }]);
});

test("pointer selection stops at the first neighbouring block, including a reverse drag", async () => {
  const el = await grid([{ periodId: "night", startsAt: "14:00", endsAt: "15:00" }]);
  const selected = events(el, "grid-range-select");
  point(el, 360, "pointerdown", step(el, 360));
  point(el, 720, "pointermove");
  point(el, 720, "pointerup");
  point(el, 660, "pointerdown", step(el, 660));
  point(el, 360, "pointermove");
  point(el, 360, "pointerup");
  expect(selected).toEqual([
    { columnKey: "fri", startsAt: "12:00", endsAt: "14:00" },
    { columnKey: "fri", startsAt: "15:00", endsAt: "17:00" },
  ]);
});

test("resizing the bottom edge stops beside the next block and leaves the input slots untouched", async () => {
  const slots = [
    { periodId: "night", startsAt: "12:00", endsAt: "13:00" },
    { periodId: "night", startsAt: "14:00", endsAt: "15:00" },
  ];
  const el = await grid(slots);
  const changes = events(el, "grid-block-change");
  const handle = el.shadowRoot!.querySelector<HTMLElement>('.resize[data-index="0"]');
  expect(handle).not.toBeNull();
  point(el, 420, "pointerdown", handle!);
  point(el, 780, "pointermove");
  point(el, 780, "pointerup");
  expect(changes).toEqual([{ columnKey: "fri", index: 0, startsAt: "12:00", endsAt: "14:00" }]);
  expect(slots[0]!.endsAt).toBe("13:00");
});

test("shrinking a block retains at least fifteen minutes and an unchanged resize emits nothing", async () => {
  const el = await grid([{ periodId: "night", startsAt: "12:00", endsAt: "13:00" }]);
  const changes = events(el, "grid-block-change");
  const handle = el.shadowRoot!.querySelector<HTMLElement>(".resize");
  expect(handle).not.toBeNull();
  point(el, 420, "pointerdown", handle!);
  point(el, 420, "pointerup");
  expect(changes).toEqual([]);
  point(el, 420, "pointerdown", handle!);
  point(el, 300, "pointermove");
  point(el, 300, "pointerup");
  expect(changes).toEqual([{ columnKey: "fri", index: 0, startsAt: "12:00", endsAt: "12:15" }]);
});

test("Shift+arrows choose the same range as a pointer, and Enter on a block opens it", async () => {
  const el = await grid();
  const selected = events(el, "grid-range-select");
  const opened = events(el, "grid-block-open");
  step(el, 360).focus();
  for (let i = 0; i < 8; i++) {
    key(el.shadowRoot!.activeElement as HTMLElement, "ArrowDown", true);
    await el.updateComplete;
  }
  key(el.shadowRoot!.activeElement as HTMLElement, "Enter");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "14:00" }]);
  step(el, 900).focus();
  key(step(el, 900), "Enter");
  expect(opened).toEqual([{ columnKey: "fri", index: 0 }]);
});

test("keyboard extension cannot select through a neighbour", async () => {
  const el = await grid([{ periodId: "night", startsAt: "12:30", endsAt: "13:00" }]);
  const selected = events(el, "grid-range-select");
  step(el, 360).focus();
  for (let i = 0; i < 8; i++) {
    key(el.shadowRoot!.activeElement as HTMLElement, "ArrowDown", true);
    await el.updateComplete;
  }
  key(el.shadowRoot!.activeElement as HTMLElement, "Enter");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "12:30" }]);
});

test("arrows move the one Tab stop across editable columns", async () => {
  const el = await grid([]);
  el.columns = [
    el.columns[0]!,
    { ...el.columns[0]!, key: "sat", label: "Saturday", editable: false },
    { ...el.columns[0]!, key: "sun", label: "Sunday" },
  ];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  step(el, 360).focus();
  key(step(el, 360), "ArrowRight");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(step(el, 360, "sun"));
  key(step(el, 360, "sun"), "ArrowDown");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(step(el, 375, "sun"));
  expect(el.shadowRoot!.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
});

test("cancellation, removal and becoming read-only abandon a pointer gesture without emitting", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  for (const cancel of ["pointercancel", "Escape", "remove", "readonly"]) {
    point(el, 360, "pointerdown", step(el, 360));
    point(el, 480, "pointermove");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".selection")).not.toBeNull();
    if (cancel === "pointercancel") point(el, 480, "pointercancel");
    if (cancel === "Escape") key(step(el, 360), "Escape");
    if (cancel === "remove") {
      el.remove();
      host.append(el);
    }
    if (cancel === "readonly") {
      el.readOnly = true;
      await el.updateComplete;
    }
    point(el, 480, "pointerup");
    await el.updateComplete;
    expect(selected).toEqual([]);
    expect(el.shadowRoot!.querySelector(".selection")).toBeNull();
  }
});

test("events bubble across the component shadow root with one custom event per block press", async () => {
  const el = await grid();
  const observed: Event[] = [];
  host.addEventListener("grid-block-open", (event) => observed.push(event));
  const block = el.shadowRoot!.querySelector<HTMLButtonElement>(".block")!;
  block.click();
  expect(observed).toHaveLength(1);
  expect((observed[0] as CustomEvent).detail).toEqual({ columnKey: "fri", index: 0 });
  expect(observed[0]!.composed).toBe(true);
  expect(observed[0]!.bubbles).toBe(true);
});

test("a changeover between quarter-hours still selects valid clock quarter-hours", async () => {
  const el = await grid([]);
  el.dayCutover = "06:07";
  await el.updateComplete;
  const selected = events(el, "grid-range-select");
  expect(step(el, 353)).not.toBeNull();
  point(el, 353, "pointerdown", step(el, 353));
  point(el, 476, "pointermove");
  point(el, 476, "pointerup");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "14:00" }]);
  const buttons = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".step[data-minute]")];
  expect(buttons[0]!.dataset.minute).toBe("8");
  expect(buttons.at(-1)!.dataset.minute).toBe("1418");
  step(el, 1418).focus();
  key(step(el, 1418), "ArrowDown", true);
  await el.updateComplete;
  key(el.shadowRoot!.activeElement as HTMLElement, "Enter");
  expect(selected.at(-1)).toEqual({ columnKey: "fri", startsAt: "05:45", endsAt: "06:00" });
  expect(
    [...el.shadowRoot!.querySelectorAll(".hour")].some((hour) => hour.textContent === "07:00"),
  ).toBe(true);
});

test("an overnight drag to the final boundary emits the changeover as the exclusive end", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  point(el, 1260, "pointerdown", step(el, 1260));
  point(el, 1500, "pointermove");
  point(el, 1500, "pointerup");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "03:00", endsAt: "06:00" }]);
});

test("a different pointer and right-button press cannot finish or replace the active gesture", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  step(el, 360).dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 2, pointerId: 8 }),
  );
  point(el, 480, "pointerup", window, 8);
  expect(selected).toEqual([]);
  point(el, 360, "pointerdown", step(el, 360));
  point(el, 720, "pointermove", window, 9);
  point(el, 720, "pointerup", window, 9);
  expect(selected).toEqual([]);
  point(el, 480, "pointerup");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "14:00" }]);
});

test("a covered focus cell names its period and its times for keyboard users", async () => {
  const el = await grid();
  expect(step(el, 900).getAttribute("aria-label")).toContain("Night");
  expect(step(el, 900).getAttribute("aria-label")).toContain("21:00–03:00");
});

test("a real Chromium mouse drag selects a range inside the scroll viewport", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  el.shadowRoot!.querySelector<HTMLElement>(".scroll")!.scrollTop = 700;
  await userEvent.dragAndDrop(step(el, 360), step(el, 480));
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "14:00" }]);
});

test("a real mouse resize emits one change without opening the period editor", async () => {
  const el = await grid([
    { periodId: "night", startsAt: "12:00", endsAt: "13:00" },
    { periodId: "night", startsAt: "14:00", endsAt: "15:00" },
  ]);
  const changes = events(el, "grid-block-change");
  const opened = events(el, "grid-block-open");
  el.shadowRoot!.querySelector<HTMLElement>(".scroll")!.scrollTop = 700;
  await userEvent.dragAndDrop(
    el.shadowRoot!.querySelector<HTMLElement>('.resize[data-index="0"]')!,
    step(el, 600),
  );
  expect(changes).toEqual([{ columnKey: "fri", index: 0, startsAt: "12:00", endsAt: "14:00" }]);
  expect(opened).toEqual([]);
});

test("Enter on an empty cell chooses fifteen minutes; ordinary arrows move backwards without selecting", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  step(el, 360).focus();
  key(step(el, 360), "Enter");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "12:15" }]);
  key(step(el, 360), "ArrowUp");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(step(el, 345));
  key(step(el, 345), "ArrowLeft");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(step(el, 345));
  key(step(el, 345), "a");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(step(el, 345));
  expect(selected).toHaveLength(1);
});

test("Shift+Up extends backwards, and returning to the anchor keeps a nonempty quarter-hour selection", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  step(el, 360).focus();
  key(step(el, 360), "ArrowUp", true);
  await el.updateComplete;
  key(step(el, 345), "ArrowUp", true);
  await el.updateComplete;
  key(step(el, 330), "Enter");
  expect(selected.at(-1)).toEqual({ columnKey: "fri", startsAt: "11:30", endsAt: "12:00" });
  step(el, 360).focus();
  key(step(el, 360), "ArrowUp", true);
  await el.updateComplete;
  key(step(el, 345), "ArrowDown", true);
  await el.updateComplete;
  key(step(el, 360), "Enter");
  expect(selected.at(-1)).toEqual({ columnKey: "fri", startsAt: "12:00", endsAt: "12:15" });
});

test("a full-day period reaches the exclusive changeover and admits no empty-cell selection", async () => {
  const el = await grid([{ periodId: "night", startsAt: "06:00", endsAt: "06:00" }]);
  const selected = events(el, "grid-range-select");
  const opened = events(el, "grid-block-open");
  expect(el.shadowRoot!.querySelector<HTMLElement>(".block")!.style.height).toBe("100%");
  point(el, 360, "pointerdown", step(el, 360));
  point(el, 480, "pointerup");
  expect(selected).toEqual([]);
  step(el, 360).focus();
  key(step(el, 360), "ArrowDown", true);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".selection")).toBeNull();
  key(step(el, 360), "Enter");
  expect(opened).toEqual([{ columnKey: "fri", index: 0 }]);
});

test("a single pointer press makes a nonempty selection and an unrelated cancellation cannot cancel it", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  point(el, 360, "pointerdown", step(el, 360));
  point(el, 360, "pointercancel", window, 10);
  point(el, 360, "pointerdown", step(el, 360), 10);
  point(el, 360, "pointerup");
  expect(selected).toEqual([{ columnKey: "fri", startsAt: "12:00", endsAt: "12:15" }]);
});

test("old controls refuse interaction as soon as read-only is set, before the redraw", async () => {
  const el = await grid();
  const selected = events(el, "grid-range-select");
  const opened = events(el, "grid-block-open");
  const cell = step(el, 360);
  const block = el.shadowRoot!.querySelector<HTMLButtonElement>(".block")!;
  el.readOnly = true;
  key(cell, "Enter");
  block.click();
  point(el, 360, "pointerdown", cell);
  point(el, 480, "pointerup");
  await el.updateComplete;
  expect(selected).toEqual([]);
  expect(opened).toEqual([]);
});

test("keyboard activation of a block or its resize handle opens the range editor once", async () => {
  const el = await grid();
  const opened = events(el, "grid-block-open");
  const block = el.shadowRoot!.querySelector<HTMLButtonElement>(".block")!;
  block.focus();
  await userEvent.keyboard("{Enter}");
  expect(opened).toEqual([{ columnKey: "fri", index: 0 }]);
  const handle = el.shadowRoot!.querySelector<HTMLButtonElement>(".resize")!;
  handle.focus();
  await userEvent.keyboard("{Enter}");
  expect(opened).toEqual([
    { columnKey: "fri", index: 0 },
    { columnKey: "fri", index: 0 },
  ]);
  handle.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true, composed: true }));
  expect(opened).toHaveLength(2);
});

test("changing columns cancels a selection and an empty grid keeps a keyboard-scrollable region", async () => {
  const el = await grid([]);
  const selected = events(el, "grid-range-select");
  point(el, 360, "pointerdown", step(el, 360));
  point(el, 480, "pointermove");
  el.columns = [];
  await el.updateComplete;
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7 }));
  expect(selected).toEqual([]);
  expect(el.shadowRoot!.querySelectorAll(".day")).toHaveLength(0);
  expect(el.shadowRoot!.querySelector<HTMLElement>(".scroll")!.tabIndex).toBe(0);
});

test.each(["en", "es"] as const)("the resize control names its action in %s", async (locale) => {
  setLocale(locale);
  const el = await grid();
  expect(el.shadowRoot!.querySelector(".resize")!.getAttribute("aria-label")).toContain(
    locale === "en" ? "Adjust Night range" : "Ajustar el intervalo de Night",
  );
});
