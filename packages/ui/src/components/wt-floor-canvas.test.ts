import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { ReactiveControllerHost } from "lit";
import type { FloorTable, PlacementChange, PlacementClear } from "../floor.js";
import type { FloorCanvasCopy } from "./wt-floor-canvas.js";
import "./wt-floor-canvas.js";

afterEach(cleanup);

interface Canvas extends HTMLElement {
  tables: FloorTable[];
  editable: boolean;
  gridSnap: boolean;
  copy: Partial<FloorCanvasCopy>;
  // Private state on the component, exposed here so a test can drive and read it.
  selectedId: string | null;
  draft: { id: string; posX: number; posY: number } | null;
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
    "wt-open-table",
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
  el.addEventListener("wt-open-table", () => {
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
  el.addEventListener("wt-placement-clear", (e) => {
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
  el.addEventListener("wt-placement-change", () => {
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
  el.addEventListener("wt-placement-change", () => {
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
  el.addEventListener("wt-placement-change", () => {
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

test("a table's accessible name comes from its occupancy content, not an aria-label override", async () => {
  const el = await mountCanvas([
    oneTable("t1", { label: "4", state: "open-tab", tabTotal: "47.50", pendingToServe: 3 }),
  ]);
  const btn = tokenEl(el, "t1");
  expect(btn.hasAttribute("aria-label")).toBe(false);
  const token = btn.querySelector("wt-table-token")!;
  expect(token.shadowRoot!.querySelector(".label")!.textContent!.trim()).toBe("4");
  expect(token.shadowRoot!.textContent).toContain("47.50 €");
});

test("the table button is type=button so it never submits a surrounding form", async () => {
  const el = await mountCanvas([oneTable("t1")]);
  expect(tokenEl(el, "t1").getAttribute("type")).toBe("button");
});

test("the shape palette is announced as a shape picker, not as one shape", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const group = el.shadowRoot!.querySelector<HTMLElement>(".palette")!;
  expect(group.getAttribute("aria-label")).toBe("Shape");
});

test("a zone edit is trimmed before it is emitted", async () => {
  const el = await mountCanvas([oneTable("t1", { zoneId: null })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const detail = await withPlacementChange(el, () => {
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".zone input")!;
    input.value = "  terrace  ";
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  });
  expect(detail.zoneId).toBe("terrace");
});

test("a stray second pointer does not move the dragging table", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], {
    editable: true,
    gridSnap: true,
  });
  const tok = tokenEl(el, "t1");
  const r = tok.getBoundingClientRect();
  const canvas = el.shadowRoot!.querySelector<HTMLElement>(".canvas")!.getBoundingClientRect();
  let changed = false;
  el.addEventListener("wt-placement-change", () => {
    changed = true;
  });
  // Pointer 1 owns the gesture; a wandering pointer 2 must be ignored entirely.
  tok.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 1,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 2,
      clientX: canvas.left + canvas.width * 0.9,
      clientY: canvas.top + canvas.height * 0.9,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 2,
      clientX: canvas.left + canvas.width * 0.9,
      clientY: canvas.top + canvas.height * 0.9,
    }),
  );
  expect(changed).toBe(false);
});

test("a drag past the edge clamps the coordinates into [0, 1000]", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 1000, posY: 0 })], { editable: true });
  const detail = await drag(el, "t1", { xFrac: 1.4, yFrac: -0.4 });
  expect(detail.posX).toBe(1000);
  expect(detail.posY).toBe(0);
});

test("an arrow-key nudge at the edge stays clamped in range", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 1000, posY: 0 })], {
    editable: true,
    gridSnap: true,
  });
  const right = await withPlacementChange(el, () => {
    tokenEl(el, "t1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }),
    );
  });
  expect(right.posX).toBe(1000);
  const up = await withPlacementChange(el, () => {
    tokenEl(el, "t1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, composed: true }),
    );
  });
  expect(up.posY).toBe(0);
});

test("a second pointerdown mid-drag is ignored, so the first drag still commits", async () => {
  const el = await mountCanvas(
    [oneTable("t1", { posX: 500, posY: 500 }), oneTable("t2", { posX: 200, posY: 200 })],
    { editable: true, gridSnap: true },
  );
  const changes: PlacementChange[] = [];
  el.addEventListener("wt-placement-change", (e) =>
    changes.push((e as CustomEvent<PlacementChange>).detail),
  );
  const canvas = el.shadowRoot!.querySelector<HTMLElement>(".canvas")!.getBoundingClientRect();
  const t1 = tokenEl(el, "t1").getBoundingClientRect();
  const t2 = tokenEl(el, "t2").getBoundingClientRect();
  tokenEl(el, "t1").dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 1,
      clientX: t1.left + t1.width / 2,
      clientY: t1.top + t1.height / 2,
    }),
  );
  // Pointer 2 tries to begin a second drag while the first is live — it must be ignored.
  tokenEl(el, "t2").dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 2,
      clientX: t2.left + t2.width / 2,
      clientY: t2.top + t2.height / 2,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientX: canvas.left + canvas.width * 0.6,
      clientY: canvas.top + canvas.height * 0.6,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 1,
      clientX: canvas.left + canvas.width * 0.6,
      clientY: canvas.top + canvas.height * 0.6,
    }),
  );
  // Exactly one commit, and it is pointer 1's table — pointer 2 started nothing.
  expect(changes).toHaveLength(1);
  expect(changes[0]!.tableId).toBe("t1");
});

test("a pointercancel aborts the drag without committing a placement", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], {
    editable: true,
    gridSnap: true,
  });
  let changed = false;
  el.addEventListener("wt-placement-change", () => {
    changed = true;
  });
  const tok = tokenEl(el, "t1");
  const r = tok.getBoundingClientRect();
  const canvas = el.shadowRoot!.querySelector<HTMLElement>(".canvas")!.getBoundingClientRect();
  tok.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 1,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientX: canvas.left + canvas.width * 0.9,
      clientY: canvas.top + canvas.height * 0.9,
    }),
  );
  // The OS cancels the gesture: no placement is committed…
  window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
  expect(changed).toBe(false);
  // …and the gesture is fully torn down, so a late pointerup cannot commit a stale drop.
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 1,
      clientX: canvas.left + canvas.width * 0.9,
      clientY: canvas.top + canvas.height * 0.9,
    }),
  );
  expect(changed).toBe(false);
});

test("the canvas chrome follows a --wt-* token override on the host", async () => {
  const el = await mountCanvas([oneTable("t1")]);
  host.style.setProperty("--wt-color-border", "rgb(9, 8, 7)");
  const canvas = el.shadowRoot!.querySelector<HTMLElement>(".canvas")!;
  expect(getComputedStyle(canvas).borderColor).toBe("rgb(9, 8, 7)");
});

// --- Default copy, the inspector's fields and the shape palette ---

test("labels the plan and every token chip from its own default copy", async () => {
  const el = await mountCanvas([
    oneTable("t1", { capacity: 4, pendingToServe: 2, reservedTime: "20:30" }),
  ]);
  expect(el.shadowRoot!.querySelector(".canvas")!.getAttribute("aria-label")).toBe("Floor plan");
  const token = tokenEl(el, "t1").querySelector("wt-table-token")!;
  expect(token.shadowRoot!.querySelector(".capacity")!.textContent!.trim()).toBe("4 covers");
  expect(token.shadowRoot!.querySelector("[data-to-serve]")!.textContent!.trim()).toBe(
    "2 to serve",
  );
  expect(token.shadowRoot!.querySelector("[data-reserved]")!.textContent!.trim()).toBe(
    "Reserved 20:30",
  );
});

test("a consumer's own words replace every default the tokens carry", async () => {
  const el = await mountCanvas([
    oneTable("t1", { capacity: 4, pendingToServe: 2, reservedTime: "20:30" }),
  ]);
  el.copy = {
    floor: "Plano de sala",
    covers: "plazas",
    toServe: "por servir",
    reserved: "Reservada",
  };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".canvas")!.getAttribute("aria-label")).toBe("Plano de sala");
  const token = tokenEl(el, "t1").querySelector("wt-table-token")!;
  expect(token.shadowRoot!.querySelector(".capacity")!.textContent!.trim()).toBe("4 plazas");
  expect(token.shadowRoot!.querySelector("[data-to-serve]")!.textContent!.trim()).toBe(
    "2 por servir",
  );
  expect(token.shadowRoot!.querySelector("[data-reserved]")!.textContent!.trim()).toBe(
    "Reservada 20:30",
  );
});

test("the palette offers the three shapes in order, each under its own name", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const chips = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".palette .chip")];
  expect(chips.map((chip) => chip.dataset.shape)).toEqual(["round", "square", "rect"]);
  expect(chips.map((chip) => chip.textContent!.trim())).toEqual(["Round", "Square", "Rect"]);
});

test("the palette marks the selected table's own shape as the pressed one", async () => {
  const el = await mountCanvas([oneTable("t1", { shape: "square" })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const pressed = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>(".palette .chip")].map((chip) =>
      chip.getAttribute("aria-pressed"),
    );
  expect(pressed()).toEqual(["false", "true", "false"]);
});

test("a table with no shape of its own shows as round in the palette", async () => {
  const el = await mountCanvas([oneTable("t1", { shape: null })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const chips = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".palette .chip")];
  expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual([
    "true",
    "false",
    "false",
  ]);
});

test("the inspector shows the selected table's covers, and nothing when it has none", async () => {
  const el = await mountCanvas(
    [oneTable("t1", { capacity: 6 }), oneTable("t2", { capacity: null })],
    {
      editable: true,
    },
  );
  tokenEl(el, "t1").click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".inspector .covers")!.textContent!.trim()).toBe("6 covers");
  tokenEl(el, "t2").click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".inspector .covers")).toBeNull();
});

test("the zone box opens on the selected table's zone, and empty when it has none", async () => {
  const el = await mountCanvas(
    [oneTable("t1", { zoneId: "terrace" }), oneTable("t2", { zoneId: null })],
    { editable: true },
  );
  tokenEl(el, "t1").click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLInputElement>(".zone input")!.value).toBe("terrace");
  tokenEl(el, "t2").click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLInputElement>(".zone input")!.value).toBe("");
});

test("the inspector follows the table that was selected, not the first one", async () => {
  const el = await mountCanvas([oneTable("first"), oneTable("second")], { editable: true });
  tokenEl(el, "second").click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".inspector .name")!.textContent!.trim()).toBe("second");
});

test("a selected id alone opens no inspector while the plan is read-only", async () => {
  const el = await mountCanvas([oneTable("t1")]);
  el.selectedId = "t1";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".inspector")).toBeNull();
});

test("what a gesture reports for a table that states no shape, angle or zone", async () => {
  // The three placement fields are left out of the object entirely, not set to null: a table the
  // server has never placed arrives without them, and the defaults are what the gesture must send.
  const bare: FloorTable = {
    id: "t1",
    label: "t1",
    capacity: 4,
    posX: 500,
    posY: 500,
    state: "free",
    pendingToServe: 0,
  };
  const el = await mountCanvas([bare], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const reshaped = await withPlacementChange(el, () => {
    el.shadowRoot!.querySelector<HTMLElement>('.palette [data-shape="square"]')!.click();
  });
  expect(reshaped.shape).toBe("square");
  expect(reshaped.rotation).toBe(0);
  expect(reshaped.zoneId).toBeNull();

  const rotated = await withPlacementChange(el, () => {
    el.shadowRoot!.querySelector<HTMLElement>(".rotate")!.click();
  });
  expect(rotated.shape).toBe("round");
  expect(rotated.rotation).toBe(15);
});

test("rotating a table that already has an angle adds one more detent", async () => {
  const el = await mountCanvas([oneTable("t1", { rotation: 15 })], { editable: true });
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const detail = await withPlacementChange(el, () => {
    el.shadowRoot!.querySelector<HTMLElement>(".rotate")!.click();
  });
  expect(detail.rotation).toBe(30);
});

// --- What leaves the shadow boundary ---

test("both placement events cross the shadow boundary to the app", async () => {
  const el = (await mountInShadowRoot("<wt-floor-canvas></wt-floor-canvas>")) as Canvas;
  el.tables = [oneTable("t1")];
  el.editable = true;
  await el.updateComplete;
  tokenEl(el, "t1").click();
  await el.updateComplete;
  const seen: string[] = [];
  const record = (e: Event) => seen.push(e.type);
  document.addEventListener("wt-placement-change", record);
  document.addEventListener("wt-placement-clear", record);
  el.shadowRoot!.querySelector<HTMLElement>(".rotate")!.click();
  el.shadowRoot!.querySelector<HTMLElement>(".deactivate")!.click();
  document.removeEventListener("wt-placement-change", record);
  document.removeEventListener("wt-placement-clear", record);
  expect(seen).toEqual(["wt-placement-change", "wt-placement-clear"]);
});

// --- Drag bookkeeping ---

test("a drag moves the token itself before it is dropped", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const gesture = startDrag(el, "t1");
  gesture.move({ xFrac: 0.8, yFrac: 0.2 });
  await el.updateComplete;
  expect(tokenEl(el, "t1").style.left).not.toBe("50%");
  expect(tokenEl(el, "t1").style.top).not.toBe("50%");
  gesture.up({ xFrac: 0.8, yFrac: 0.2 });
});

test("a drop reports how far the pointer travelled on both axes", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  // Opposite directions on the two axes: the same signed displacement on both would read alike
  // whether or not the component kept them apart. Within a few permille of exact, because the
  // token's own centre is measured from a laid-out box and carries sub-pixel rounding.
  const detail = await drag(el, "t1", { xFrac: 0.8, yFrac: 0.2 });
  expect(detail.posX).toBeCloseTo(800, -1);
  expect(detail.posY).toBeCloseTo(200, -1);
});

test("a pointer event arriving with no drag in progress is ignored", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  const details = collectPlacements(el);
  // No pointerdown first: the window listeners can still be reached by another component's gesture,
  // and the guards that make that harmless only show as a thrown error if they are removed.
  const failures: string[] = [];
  const onError = (e: ErrorEvent) => failures.push(e.message);
  window.addEventListener("error", onError);
  const stray = pointerFor(el);
  stray.move({ xFrac: 0.1, yFrac: 0.1 });
  stray.up({ xFrac: 0.1, yFrac: 0.1 });
  stray.cancel();
  window.removeEventListener("error", onError);
  expect(failures).toEqual([]);
  expect(details).toEqual([]);
  expect(el.draft).toBeNull();
});

test("a stray pointer's up does not drop the table the owning pointer is still dragging", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const details = collectPlacements(el);
  const gesture = startDrag(el, "t1");
  gesture.move({ xFrac: 0.8, yFrac: 0.5 });
  gesture.up({ xFrac: 0.1, yFrac: 0.1 }, 2);
  expect(details).toEqual([]);
  gesture.up({ xFrac: 0.8, yFrac: 0.5 });
  expect(details.length).toBe(1);
  expect(details[0]!.posX).toBeCloseTo(800, -1);
});

test("a stray pointer's cancel does not abort the drag the owning pointer is still running", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const details = collectPlacements(el);
  const gesture = startDrag(el, "t1");
  gesture.move({ xFrac: 0.8, yFrac: 0.5 });
  gesture.cancel(2);
  gesture.up({ xFrac: 0.8, yFrac: 0.5 });
  expect(details.length).toBe(1);
});

test("a stray pointer's move does not drag the table the owning pointer holds", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const gesture = startDrag(el, "t1");
  gesture.move({ xFrac: 0.7, yFrac: 0.5 });
  await el.updateComplete;
  const held = tokenEl(el, "t1").style.left;
  gesture.move({ xFrac: 0.1, yFrac: 0.1 }, 2);
  await el.updateComplete;
  expect(tokenEl(el, "t1").style.left).toBe(held);
  gesture.up({ xFrac: 0.7, yFrac: 0.5 });
});

test("taking the plan off the page mid-drag drops the gesture instead of committing it", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const details = collectPlacements(el);
  const gesture = startDrag(el, "t1");
  gesture.move({ xFrac: 0.8, yFrac: 0.5 });
  el.remove();
  gesture.up({ xFrac: 0.8, yFrac: 0.5 });
  expect(details).toEqual([]);
  expect(el.draft).toBeNull();
});

test("a tap that never moved leaves no gesture behind for the next pointer move", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const details = collectPlacements(el);
  const gesture = startDrag(el, "t1");
  gesture.up({ xFrac: 0.5, yFrac: 0.5 });
  gesture.move({ xFrac: 0.9, yFrac: 0.9 });
  gesture.up({ xFrac: 0.9, yFrac: 0.9 });
  expect(details).toEqual([]);
});

test("a dropped table is not dragged a second time by the pointer moves after it", async () => {
  const el = await mountCanvas([oneTable("t1", { posX: 500, posY: 500 })], { editable: true });
  const details = collectPlacements(el);
  await drag(el, "t1", { xFrac: 0.8, yFrac: 0.5 });
  const gesture = pointerFor(el);
  gesture.move({ xFrac: 0.1, yFrac: 0.1 });
  await el.updateComplete;
  expect(el.draft).toBeNull();
  gesture.up({ xFrac: 0.1, yFrac: 0.1 });
  expect(details.length).toBe(1);
});

test("a tap on a table is not also delivered to the page behind the plan", async () => {
  const el = (await mountInShadowRoot("<wt-floor-canvas></wt-floor-canvas>")) as Canvas;
  el.tables = [oneTable("t1")];
  await el.updateComplete;
  let clicks = 0;
  const onClick = () => {
    clicks += 1;
  };
  document.addEventListener("click", onClick);
  tokenEl(el, "t1").click();
  document.removeEventListener("click", onClick);
  expect(clicks).toBe(0);
});

test("pressing on a table claims the gesture from the browser's own dragging", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  const tok = tokenEl(el, "t1");
  const r = tok.getBoundingClientRect();
  const down = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
  });
  tok.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
});

test("an arrow key that nudges a table is not left to scroll the page as well", async () => {
  const el = await mountCanvas([oneTable("t1")], { editable: true });
  const press = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  tokenEl(el, "t1").dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
});

test("the plan tells its controllers when it leaves the page", async () => {
  const el = await mountCanvas([oneTable("t1")]);
  let disconnected = 0;
  (el as unknown as ReactiveControllerHost).addController({
    hostDisconnected: () => {
      disconnected += 1;
    },
  });
  el.remove();
  expect(disconnected).toBe(1);
});

// --- helpers ---

/** Runs `act`, then resolves with the next placement-change detail it triggers. */
function withPlacementChange(el: Canvas, act: () => void): Promise<PlacementChange> {
  return new Promise<PlacementChange>((resolve) => {
    el.addEventListener(
      "wt-placement-change",
      (e) => resolve((e as CustomEvent<PlacementChange>).detail),
      { once: true },
    );
    act();
  });
}

/** Collects every placement change `el` emits from here on, in order. */
function collectPlacements(el: Canvas): PlacementChange[] {
  const details: PlacementChange[] = [];
  el.addEventListener("wt-placement-change", (e) => {
    details.push((e as CustomEvent<PlacementChange>).detail);
  });
  return details;
}

/** Fraction of the canvas, measured from its top-left corner. */
interface CanvasPoint {
  xFrac: number;
  yFrac: number;
}

/**
 * The window events a live gesture can send next. `pointerId` defaults to the one that started the
 * gesture; pass another to stand for a second finger the canvas is meant to ignore. The canvas
 * geometry is read once, so a case can aim at a fraction of it without measuring anything itself.
 */
function pointerFor(el: Canvas, owner = 1) {
  const canvas = el.shadowRoot!.querySelector<HTMLElement>(".canvas")!.getBoundingClientRect();
  const fire = (type: string, to: CanvasPoint | undefined, pointerId: number) =>
    window.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId,
        ...(to
          ? {
              clientX: canvas.left + canvas.width * to.xFrac,
              clientY: canvas.top + canvas.height * to.yFrac,
            }
          : {}),
      }),
    );
  return {
    move: (to: CanvasPoint, pointerId = owner) => fire("pointermove", to, pointerId),
    up: (to: CanvasPoint, pointerId = owner) => fire("pointerup", to, pointerId),
    cancel: (pointerId = owner) => fire("pointercancel", undefined, pointerId),
  };
}

/** Presses on table `id` at its own centre and hands back the rest of the gesture. */
function startDrag(el: Canvas, id: string, owner = 1) {
  const tok = tokenEl(el, id);
  const from = tok.getBoundingClientRect();
  tok.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: owner,
      clientX: from.left + from.width / 2,
      clientY: from.top + from.height / 2,
    }),
  );
  return pointerFor(el, owner);
}

/** Simulates a pointer drag of table `id` to a fraction of the canvas, returning the emitted change. */
function drag(el: Canvas, id: string, to: CanvasPoint): Promise<PlacementChange> {
  return withPlacementChange(el, () => {
    const gesture = startDrag(el, id);
    gesture.move(to);
    gesture.up(to);
  });
}
