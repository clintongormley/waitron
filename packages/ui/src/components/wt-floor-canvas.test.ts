import { afterEach, expect, test } from "vitest";
import { cleanup, mount, mountInShadowRoot } from "../test-helpers.js";
import type { FloorTable, PlacementChange, PlacementClear } from "../floor.js";
import "./wt-floor-canvas.js";

afterEach(cleanup);

interface Canvas extends HTMLElement {
  tables: FloorTable[];
  editable: boolean;
  gridSnap: boolean;
  updateComplete: Promise<unknown>;
}

function oneTable(id: string, overrides: Partial<FloorTable> = {}): FloorTable {
  return {
    id,
    label: id,
    capacity: 4,
    posX: 500,
    posY: 500,
    shape: "square",
    rotation: 0,
    zoneId: null,
    state: "free",
    pendingToServe: 0,
    status: null,
    ...overrides,
  };
}

async function mountCanvas(
  tables: FloorTable[],
  props: { editable?: boolean; gridSnap?: boolean } = {},
): Promise<Canvas> {
  const el = (await mount("<wt-floor-canvas></wt-floor-canvas>")) as Canvas;
  el.tables = tables;
  if (props.editable) el.editable = true;
  if (props.gridSnap) el.gridSnap = true;
  await el.updateComplete;
  return el;
}

function tokenEl(el: Canvas, id: string): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-table="${id}"]`)!;
}

// --- View mode ---

test("draws a placed token at the scaled position, sized and rotated", async () => {
  const el = await mountCanvas([
    oneTable("t1", {
      label: "4",
      capacity: 4,
      posX: 500,
      posY: 250,
      shape: "square",
      rotation: 15,
      state: "open-tab",
      tabTotal: "47.50",
    }),
  ]);
  const tok = tokenEl(el, "t1");
  expect(tok.style.left).toBe("50%"); // 500‰
  expect(tok.style.top).toBe("25%"); // 250‰
  expect(tok.style.transform).toContain("rotate(15deg)");
  expect(tok.getAttribute("data-size")).toBe("M"); // capacity 4
});

test("sizes each token from its capacity bucket", async () => {
  const el = await mountCanvas([
    oneTable("s", { capacity: 2 }),
    oneTable("l", { capacity: 6 }),
    oneTable("xl", { capacity: 10 }),
  ]);
  expect(tokenEl(el, "s").getAttribute("data-size")).toBe("S");
  expect(tokenEl(el, "l").getAttribute("data-size")).toBe("L");
  expect(tokenEl(el, "xl").getAttribute("data-size")).toBe("XL");
});

test("defaults an unplaced rotation to zero degrees", async () => {
  const el = await mountCanvas([oneTable("t1", { rotation: null })]);
  expect(tokenEl(el, "t1").style.transform).toContain("rotate(0deg)");
});

test("renders one wrapper carrying the shared occupancy token per table", async () => {
  const el = await mountCanvas([oneTable("a"), oneTable("b")]);
  const wrappers = el.shadowRoot!.querySelectorAll("[data-table]");
  expect(wrappers.length).toBe(2);
  expect(tokenEl(el, "a").querySelector("wt-table-token")).not.toBeNull();
});

test("tapping a table asks the app to open it (composed, bubbling)", async () => {
  const el = (await mountInShadowRoot("<wt-floor-canvas></wt-floor-canvas>")) as Canvas;
  el.tables = [oneTable("t7")];
  await el.updateComplete;
  let received: string | undefined;
  document.addEventListener(
    "open-table",
    (e) => {
      received = (e as CustomEvent<{ tableId: string }>).detail.tableId;
    },
    { once: true },
  );
  tokenEl(el, "t7").click();
  expect(received).toBe("t7");
});

test("view mode shows no editing chrome", async () => {
  const el = await mountCanvas([oneTable("t1")]);
  expect(el.shadowRoot!.querySelector(".inspector")).toBeNull();
  expect(el.shadowRoot!.querySelector(".palette")).toBeNull();
});

// --- Edit mode ---

test("emits placement-change with grid-snapped coords on drag", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], {
    editable: true,
    gridSnap: true,
  });
  const detail = await drag(el, "t1", { xFrac: 0.333, yFrac: 0.52 });
  expect(detail.tableId).toBe("t1");
  expect(detail.posX % 50).toBe(0); // snapped to the 50‰ grid
  expect(detail.posY % 50).toBe(0);
});

test("without grid snap a drag reports the raw dropped position", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const detail = await drag(el, "t1", { xFrac: 0.333, yFrac: 0.52 });
  // 0.333 * 1000 = 333, not a grid multiple — proves the snap is genuinely off.
  expect(detail.posX % 50).not.toBe(0);
});

test("a tap in edit mode selects the table instead of opening it", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  let opened = false;
  el.addEventListener("open-table", () => {
    opened = true;
  });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  expect(opened).toBe(false);
  expect(el.shadowRoot!.querySelector(".inspector")).not.toBeNull();
});

test("the shapes palette re-shapes the selected table", async () => {
  const el = await mountCanvas([oneTable("t1", { shape: "square" })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const detail = await withPlacementChange(el, () => {
    el.shadowRoot!.querySelector<HTMLElement>('.palette [data-shape="round"]')!.click();
  });
  expect(detail.shape).toBe("round");
});

test("the rotate handle turns the selected table one 15° detent", async () => {
  const el = await mountCanvas([oneTable("t1", { rotation: 0 })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const detail = await withPlacementChange(el, () => {
    el.shadowRoot!.querySelector<HTMLElement>(".rotate")!.click();
  });
  expect(detail.rotation).toBe(15);
});

test("editing the zone re-homes the selected table", async () => {
  const el = await mountCanvas([oneTable("t1", { zoneId: null })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const detail = await withPlacementChange(el, () => {
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".zone input")!;
    input.value = "terrace";
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  });
  expect(detail.zoneId).toBe("terrace");
});

test("deactivating clears the table's placement", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  let cleared: PlacementClear | undefined;
  el.addEventListener("placement-clear", (e) => {
    cleared = (e as CustomEvent<PlacementClear>).detail;
  });
  el.shadowRoot!.querySelector<HTMLElement>(".deactivate")!.click();
  expect(cleared?.tableId).toBe("t1");
});

test("arrow keys nudge the focused table and emit the new placement", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], {
    editable: true,
    gridSnap: true,
  });
  const tok = tokenEl(el, "t1");
  const right = await withPlacementChange(el, () => {
    tok.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }),
    );
  });
  expect(right.posX).toBe(550);
  const up = await withPlacementChange(el, () => {
    tokenEl(el, "t1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, composed: true }),
    );
  });
  expect(up.posY).toBe(450);
});

test("arrow keys nudge in every direction", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], {
    editable: true,
    gridSnap: true,
  });
  const left = await withPlacementChange(el, () => {
    tokenEl(el, "t1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, composed: true }),
    );
  });
  expect(left.posX).toBe(450);
  const down = await withPlacementChange(el, () => {
    tokenEl(el, "t1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }),
    );
  });
  expect(down.posY).toBe(550);
});

test("without grid snap an arrow key nudges by a fine step", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const right = await withPlacementChange(el, () => {
    tokenEl(el, "t1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }),
    );
  });
  expect(right.posX).toBe(510);
});

test("a non-arrow key does not move the table", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  let moved = false;
  el.addEventListener("placement-change", () => {
    moved = true;
  });
  tokenEl(el, "t1").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(moved).toBe(false);
});

test("view mode ignores keyboard nudges and pointer drags", async () => {
  const el = await mountCanvas([oneTable("t1")]);
  let changed = false;
  el.addEventListener("placement-change", () => {
    changed = true;
  });
  const tok = tokenEl(el, "t1");
  tok.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }),
  );
  const rect = el.shadowRoot!.querySelector(".canvas")!.getBoundingClientRect();
  tok.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 1,
      clientX: rect.left,
      clientY: rect.top,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientX: rect.left + rect.width * 0.9,
      clientY: rect.top + rect.height * 0.9,
    }),
  );
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  expect(changed).toBe(false);
});

test("a pointer tap without movement does not emit a placement change", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  let changed = false;
  el.addEventListener("placement-change", () => {
    changed = true;
  });
  const tok = tokenEl(el, "t1");
  const r = tok.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  tok.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: x, clientY: y }),
  );
  window.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: x, clientY: y }),
  );
  expect(changed).toBe(false);
});

test("clearing the zone input re-homes the table to no zone", async () => {
  const el = await mountCanvas([oneTable("t1", { zoneId: "terrace" })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const detail = await withPlacementChange(el, () => {
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".zone input")!;
    input.value = "   ";
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  });
  expect(detail.zoneId).toBeNull();
});

// --- helpers ---

/** Runs `act`, then resolves with the next placement-change detail it triggers. */
function withPlacementChange(el: Canvas, act: () => void): Promise<PlacementChange> {
  return new Promise<PlacementChange>((resolve) => {
    el.addEventListener(
      "placement-change",
      (e) => resolve((e as CustomEvent<PlacementChange>).detail),
      { once: true },
    );
    act();
  });
}

/** Simulates a pointer drag of table `id` to a fraction of the canvas, returning the emitted change. */
function drag(
  el: Canvas,
  id: string,
  to: { xFrac: number; yFrac: number },
): Promise<PlacementChange> {
  const canvas = el.shadowRoot!.querySelector<HTMLElement>(".canvas")!;
  const rect = canvas.getBoundingClientRect();
  const tok = tokenEl(el, id);
  const from = tok.getBoundingClientRect();
  const startX = from.left + from.width / 2;
  const startY = from.top + from.height / 2;
  const targetX = rect.left + rect.width * to.xFrac;
  const targetY = rect.top + rect.height * to.yFrac;
  return withPlacementChange(el, () => {
    tok.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        pointerId: 1,
        clientX: startX,
        clientY: startY,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: targetX,
        clientY: targetY,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        clientX: targetX,
        clientY: targetY,
      }),
    );
  });
}
