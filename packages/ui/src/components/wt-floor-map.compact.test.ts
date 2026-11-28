import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import type { FloorMapTable, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

const panCopy = "Drag to see more tables";
const table = (id: string, x: number, y: number, width = 2, height = width): FloorMapTable => ({
  id,
  label: id,
  placement: { x, y, width, height, shape: "rect", rotation: 0 },
  fill: "free",
  outline: null,
  pulse: null,
  cue: null,
  joinId: null,
  description: "Free",
});

afterEach(cleanup);

const button = (map: WtFloorMap, id: string) =>
  map.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-table-id="${id}"]`)!;
const plan = (map: WtFloorMap) => map.shadowRoot!.querySelector<HTMLElement>('[role="group"]')!;
const hint = (map: WtFloorMap) => map.shadowRoot!.querySelector(".pan-hint");

async function compactMap(width: number, height: number, tables: FloorMapTable[]) {
  const scroller = await mount(`
    <div style="height: ${height}px; overflow: auto">
      <wt-floor-map compact style="width: ${width}px; height: ${height}px"></wt-floor-map>
      <div style="height: ${height}px"></div>
    </div>`);
  const map = scroller.querySelector<WtFloorMap>("wt-floor-map")!;
  map.copy = { pan: panCopy };
  map.tables = tables;
  await vi.waitFor(() => expect(button(map, tables[0]!.id)).toBeTruthy());
  return { map, scroller };
}

async function pan(map: WtFloorMap, deltaX: number, deltaY: number) {
  plan(map).dispatchEvent(
    new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, composed: true }),
  );
  await map.updateComplete;
}

it("keeps both ends of a wide floor within reach at the minimum touch size", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(260, 340, [table("Near", 5, 7), table("Far", 25, 7)]);
  const near = button(map, "Near");
  const far = button(map, "Far");
  expect(near.getBoundingClientRect().width).toBe(44);
  expect(near.getBoundingClientRect().height).toBe(44);
  expect(far.getBoundingClientRect().left).toBeGreaterThan(plan(map).getBoundingClientRect().right);
  expect(hint(map)?.textContent).toBe(panCopy);
  expect(hint(map)!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    plan(map).getBoundingClientRect().bottom,
  );

  await pan(map, 1000, 0);
  expect(far.getBoundingClientRect().right).toBeCloseTo(plan(map).getBoundingClientRect().right);
  await pan(map, -1000, 0);
  expect(near.getBoundingClientRect().left).toBeCloseTo(plan(map).getBoundingClientRect().left);
});

it("uses the short name only when the full name cannot fit, and keeps the name spoken", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(340, 320, [
    { ...table("small", 3, 4), label: "Riverside 12", shortName: "R12" },
    { ...table("large", 5, 8, 8), label: "Riverside 14", shortName: "R14" },
  ]);
  const small = button(map, "small");
  expect(small.querySelector('[part="name"]')?.textContent).toBe("R12");
  expect(small.getAttribute("aria-label")).toBe("Riverside 12 (R12), Free");
  expect(button(map, "large").querySelector('[part="name"]')?.textContent).toBe("Riverside 14");
});

it("keeps today's name if the saved fallback is wider", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(260, 340, [
    {
      ...table("near", 5, 7),
      name: "Window 12",
      label: "Riverside table",
      shortName: "Riverside table 12",
    },
    table("far", 25, 7),
  ]);
  const name = button(map, "near").querySelector<HTMLElement>('[part="name"]')!;
  expect(name.textContent).toBe("Window 12");
  expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
});

it("does not replace a daily name with the saved full name", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(260, 340, [
    {
      ...table("near", 5, 7),
      name: "Birthday at the window",
      label: "Table 12",
      shortName: "Table 12",
    },
    table("far", 25, 7),
  ]);
  const near = button(map, "near");
  expect(near.querySelector('[part="name"]')?.textContent).toBe("Birthday at the window");
  expect(near.getAttribute("aria-label")).toBe("Birthday at the window, Free");
});

it("uses the compact job when the whole action would take more than two lines", async () => {
  await page.viewport(390, 700);
  const job = {
    text: "Collect from the upstairs cocktail station beside the very far end of the terrace",
    time: "9 min",
    compact: "Bar 9′",
  };
  const { map } = await compactMap(250, 210, [
    {
      ...table("T12", 2, 2, 8),
      cue: { icon: "floor-ready", text: "2" },
      job,
    },
  ]);
  const target = button(map, "T12");
  expect(target.getBoundingClientRect().width).toBeGreaterThan(90);
  expect(target.querySelector('[part="cue"]')?.textContent?.trim()).toBe("Bar 9′");
  expect(target.getAttribute("aria-label")).toBe(`T12, ${job.text}, 9 min, Free`);
});

it("shows a whole short job with its wait or leaves the narrow table in its job colour", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(260, 340, [
    {
      ...table("T1", 5, 7),
      fill: "danger",
      cue: { icon: "floor-timer", text: "Forgotten" },
      job: {
        text: "Chase the downstairs kitchen",
        time: "11 min",
        compact: "Chase",
        compactTime: "11′",
      },
    },
    {
      ...table("T2", 11, 7, 2.7, 2),
      cue: { icon: "floor-ready", text: "2" },
      job: { text: "Collect from Bar", time: "9 min", compact: "Bar", compactTime: "9′" },
    },
    {
      ...table("T4", 17, 7, 3.5, 4),
      cue: { icon: null, text: "Reserved" },
      job: { text: "Reserved", time: "21:30", compact: "21:30" },
    },
    table("T3", 25, 7),
  ]);
  map.style.fontSize = "20px";
  map.style.fontFamily = "monospace";
  map.requestUpdate();
  await map.updateComplete;
  const narrow = button(map, "T1");
  expect(narrow.querySelector('[part="cue"]')).toBeNull();
  expect(narrow.getAttribute("aria-label")).toContain("Chase the downstairs kitchen, 11 min");
  expect(narrow.querySelector('[part="shape"]')?.getAttribute("data-fill")).toBe("danger");

  const cue = button(map, "T2").querySelector<HTMLElement>('[part="cue"]');
  expect(cue?.textContent?.trim()).toBe("Bar 9′");
  expect(cue!.scrollWidth).toBeLessThanOrEqual(cue!.clientWidth);
  expect(getComputedStyle(cue!).fontWeight).toBe("600");
  const reservation = button(map, "T4");
  expect(reservation.querySelector('[part="job"]')?.textContent).toBe("Reserved");
  expect(reservation.querySelector('[part="time"]')?.textContent).toBe("21:30");
});

it("shows the delivery count beside the icon when the full label does not fit", async () => {
  await page.viewport(390, 700);
  const delivery = { icon: "floor-step", text: "2 to deliver", compact: "2" } as const;
  const { map } = await compactMap(260, 340, [
    { ...table("T1", 5, 7, 3.8, 2), cue: delivery },
    { ...table("T2", 11, 7, 6, 2), cue: delivery },
    table("T3", 25, 7),
  ]);
  const narrow = button(map, "T1");
  const wide = button(map, "T2");
  expect(narrow.querySelector("wt-icon")?.getAttribute("name")).toBe("floor-step");
  expect(narrow.querySelector('[part="cue"]')?.textContent?.trim()).toBe("2");
  expect(narrow.getAttribute("aria-label")).toContain("2 to deliver");
  expect(wide.querySelector('[part="cue"]')?.textContent?.trim()).toBe("2 to deliver");
});

it("keeps the full collection job when three lines fit inside the table", async () => {
  await page.viewport(390, 700);
  const cue = { icon: "floor-ready", text: "2" } as const;
  const job = {
    text: "Collect from Kitchen",
    time: "2 min",
    compact: "Kitchen",
    compactTime: "2′",
  };
  const { map } = await compactMap(260, 340, [
    { ...table("T1", 5, 7, 4), cue, job },
    { ...table("T2", 14, 7, 4, 3), cue, job },
    table("T3", 25, 7),
  ]);
  map.style.fontFamily = "monospace";
  map.style.fontSize = "12px";
  map.requestUpdate();
  await map.updateComplete;
  const target = button(map, "T1");
  expect(target.querySelector('[part="job"]')?.textContent).toBe("Collect from Kitchen");
  expect(target.querySelector('[part="time"]')?.textContent).toBe("2 min");
  expect(button(map, "T2").querySelector('[part="cue"]')?.textContent?.trim()).toBe("Kitchen 2′");
});

it("leaves an inset beside a full job and wraps whole words", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(250, 210, [
    {
      ...table("T1", 2, 2, 9, 8),
      label: "Riverside 1234",
      shortName: "R12",
      cue: { icon: "floor-ready", text: "2" },
      job: {
        text: "Collect from the Kitchen",
        time: "9 min",
        compact: "Kitchen",
        compactTime: "9′",
      },
    },
  ]);
  const target = button(map, "T1");
  expect(target.querySelector('[part="name"]')?.textContent).toBe("R12");
  const job = target.querySelector('[part="job"]')!;
  expect(job.textContent).toBe("Collect from the Kitchen");
  const tile = target.getBoundingClientRect();
  const label = document.createRange();
  label.selectNodeContents(job);
  const lines = [...label.getClientRects()];
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line.left - tile.left).toBeGreaterThanOrEqual(10);
    expect(tile.right - line.right).toBeGreaterThanOrEqual(10);
  }
});

it("uses the compact wait if the allergy mark leaves too little height for a full job", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(340, 280, [
    {
      ...table("T1", 5, 7, 3),
      allergy: true,
      cue: { icon: "floor-timer", text: "Forgotten" },
      job: { text: "Chase the Bar", time: "17 min", compact: "Bar", compactTime: "17′" },
    },
    table("T2", 14, 7, 3),
  ]);
  map.style.fontSize = "17px";
  map.requestUpdate();
  await map.updateComplete;
  const target = button(map, "T1");
  const box = target.getBoundingClientRect();
  expect(box.height).toBeGreaterThanOrEqual(68);
  expect(box.height).toBeLessThan(80);
  const cue = target.querySelector<HTMLElement>('[part="cue"]');
  expect(cue?.textContent?.trim()).toContain("17′");
  expect(cue!.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom);
});

it("fits a landscape floor by its height and leaves room at its edges", async () => {
  await page.viewport(700, 390);
  const { map } = await compactMap(400, 200, [table("Near", 5, 7, 4), table("Far", 13, 13, 4)]);
  const area = plan(map).getBoundingClientRect();
  const near = button(map, "Near").getBoundingClientRect();
  const far = button(map, "Far").getBoundingClientRect();
  expect(near.width).toBe(64);
  expect(near.top - area.top).toBe(20);
  expect(area.bottom - far.bottom).toBe(20);
  expect(near.left - area.left).toBe(area.right - far.right);
  expect(hint(map)).toBeNull();
});

it("keeps a small floor at seating size on a large portrait screen", async () => {
  await page.viewport(820, 1180);
  const { map } = await compactMap(796, 1039, [
    table("B1", 17, 59),
    table("B2", 22, 59),
    table("B3", 19, 65),
  ]);
  const area = plan(map).getBoundingClientRect();
  for (const label of ["B1", "B2", "B3"]) {
    const stool = button(map, label).getBoundingClientRect();
    expect(stool.width).toBe(96);
    expect(stool.left).toBeGreaterThan(area.left);
    expect(stool.right).toBeLessThan(area.right);
    expect(stool.top).toBeGreaterThan(area.top);
    expect(stool.bottom).toBeLessThan(area.bottom);
  }
  expect(hint(map)).toBeNull();
});

it("leaves an inset on both sides of a floor fitted to a portrait screen", async () => {
  await page.viewport(390, 700);
  const { map } = await compactMap(340, 500, [table("Near", 5, 7), table("Far", 11, 11)]);
  const area = plan(map).getBoundingClientRect();
  const near = button(map, "Near").getBoundingClientRect();
  const far = button(map, "Far").getBoundingClientRect();
  expect(near.left - area.left).toBe(20);
  expect(area.right - far.right).toBe(20);
  expect(near.top - area.top).toBe(area.bottom - far.bottom);
  expect(hint(map)).toBeNull();
});

it("reveals the last table with End while keeping the scroll position of the till", async () => {
  await page.viewport(700, 390);
  const { map, scroller } = await compactMap(400, 195, [table("Near", 5, 7), table("Far", 21, 16)]);
  const near = button(map, "Near");
  const far = button(map, "Far");
  const area = plan(map).getBoundingClientRect();
  expect(near.getBoundingClientRect().width).toBe(44);
  expect(far.getBoundingClientRect().bottom).toBeGreaterThan(area.bottom);
  expect(far.getBoundingClientRect().right).toBeGreaterThan(area.right);
  expect(hint(map)?.textContent).toBe(panCopy);
  expect(hint(map)!.getBoundingClientRect().left).toBeGreaterThanOrEqual(area.right);
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

  near.focus();
  await userEvent.keyboard("{End}");
  expect(map.shadowRoot!.activeElement).toBe(far);
  expect(far.getBoundingClientRect().bottom).toBeCloseTo(area.bottom);
  expect(Math.abs(far.getBoundingClientRect().right - area.right)).toBeLessThanOrEqual(1);
  expect(scroller.scrollTop).toBe(0);
  await pan(map, 0, 1000);
  expect(far.getBoundingClientRect().bottom).toBeCloseTo(area.bottom);
  await pan(map, 0, -1000);
  expect(near.getBoundingClientRect().top).toBeCloseTo(area.top);
});

it("refits a changed floor until staff pan, then keeps their view until a smaller table arrives", async () => {
  await page.viewport(390, 700);
  const near = table("Near", 5, 7);
  const far = table("Far", 25, 7);
  const { map } = await compactMap(260, 340, [near, far]);
  const original = button(map, "Near").getBoundingClientRect();
  map.tables = [near, table("Far", 10, 7)];
  await map.updateComplete;
  const fitted = button(map, "Near").getBoundingClientRect();
  expect(fitted.width).toBeGreaterThan(original.width);
  expect(hint(map)).toBeNull();

  await pan(map, -100, 0);
  const panned = button(map, "Near").getBoundingClientRect();
  expect(panned.left).toBeGreaterThan(fitted.left);
  map.tables = [near, far];
  await map.updateComplete;
  expect(button(map, "Near").getBoundingClientRect().left).toBeCloseTo(panned.left);
  expect(button(map, "Near").getBoundingClientRect().width).toBeCloseTo(panned.width);

  map.tables = [near, far, table("Small", 18, 7, 1, 2)];
  await map.updateComplete;
  expect(button(map, "Small").getBoundingClientRect().width).toBe(44);
});
