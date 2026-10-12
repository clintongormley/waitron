import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-table-panel.js";
import type { FloorPlanTablePanel } from "./floor-plan-table-panel.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { FloorPlan } from "../api/client.js";
import { draftFromPlan, patchTable, type FloorPlanDraft } from "./floor-plan-draft.js";

let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  cleanupWidgets();
});

const m1Placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

const plan: FloorPlan = {
  zoneId: "z1",
  revision: 3,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [
    {
      id: "m1",
      liveTableId: "l1",
      label: "T1",
      seats: 4,
      fixed: false,
      placement: m1Placement,
      partIds: [],
    },
    {
      id: "m2",
      liveTableId: "l2",
      label: "T2",
      seats: 2,
      fixed: true,
      placement: null,
      partIds: [],
    },
    {
      id: "m9",
      liveTableId: "l9",
      label: "T9",
      seats: null,
      fixed: false,
      placement: null,
      partIds: [],
    },
  ],
};

const opened = (): FloorPlanDraft => draftFromPlan(plan);

type Field = HTMLElement & { value: string; error: string; checked: boolean };

async function open(props: Partial<FloorPlanTablePanel> = {}): Promise<FloorPlanTablePanel> {
  const { el } = await mountWidget<FloorPlanTablePanel>("floor-plan-table-panel", {
    draft: opened(),
    tableKey: "m1",
    ...props,
  });
  await el.updateComplete;
  return el;
}

const field = (el: FloorPlanTablePanel, name: string) =>
  el.shadowRoot!.querySelector<Field>(`[name=${name}]`);
const action = (el: FloorPlanTablePanel, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`);

interface Change {
  draft: FloorPlanDraft;
  mergeKey?: string;
}

function listen(el: FloorPlanTablePanel) {
  const changes: Change[] = [];
  const selects: (string | null)[] = [];
  el.addEventListener("floor-plan-change", (e) => {
    const detail = (e as CustomEvent<Change>).detail;
    changes.push(detail);
    el.draft = detail.draft;
  });
  el.addEventListener("floor-plan-select", (e) =>
    selects.push((e as CustomEvent<{ key: string | null }>).detail.key),
  );
  return { changes, selects };
}

async function set(el: FloorPlanTablePanel, name: string, value: string): Promise<void> {
  await chooseOption(field(el, name)!, value);
  await el.updateComplete;
}

const tableOf = (change: Change | undefined, key: string) =>
  change!.draft.tables.find((t) => t.key === key);

const shapeGroup = (el: FloorPlanTablePanel) =>
  el.shadowRoot!.querySelector<HTMLElement>("[role=group][data-field=shape]");
const shapeButtons = (el: FloorPlanTablePanel) => [
  ...shapeGroup(el)!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
];
const pressedShape = (el: FloorPlanTablePanel) =>
  shapeButtons(el)
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.getAttribute("aria-label"));
const shapeCaption = (el: FloorPlanTablePanel) =>
  el.shadowRoot!.getElementById(shapeGroup(el)!.getAttribute("aria-labelledby")!);

it("shows the selected table's values", async () => {
  const el = await open();
  expect(field(el, "table-name")!.value).toBe("T1");
  expect(field(el, "seats")!.value).toBe("4");
  expect(field(el, "moveable")!.checked).toBe(true);
  expect(pressedShape(el)).toEqual(["Rectangle"]);
});

it("lays out Name, then Seats beside Shape, then Moveable, and nothing more", async () => {
  const el = await open();
  const named = [
    ...el.shadowRoot!.querySelectorAll(".fields [name]:not(wt-icon), .fields [role=group]"),
  ];
  expect(named.map((n) => n.getAttribute("name") ?? n.getAttribute("data-field"))).toEqual([
    "table-name",
    "seats",
    "shape",
    "moveable",
  ]);
  const seatsRow = field(el, "seats")!.parentElement!;
  expect(seatsRow.contains(shapeGroup(el))).toBe(true);
  expect(seatsRow.contains(field(el, "table-name"))).toBe(false);
  expect(seatsRow.contains(field(el, "moveable"))).toBe(false);
  for (const name of ["width", "height", "rotation", "fixed", "shape"]) {
    expect(field(el, name)).toBeNull();
  }
});

it("names the shape pair by a visible caption, with no tooltip", async () => {
  const el = await open();
  const caption = shapeCaption(el)!;
  expect(caption.textContent!.trim()).toBe("Shape");
  expect(caption.checkVisibility()).toBe(true);
  expect(shapeButtons(el).map((b) => b.getAttribute("aria-label"))).toEqual(["Rectangle", "Round"]);
  expect(shapeGroup(el)!.querySelector(".icon-tooltip")).toBeNull();
});

it("puts Shape under Seats only on a panel too narrow for both", async () => {
  const el = await open();
  el.style.width = "180px";
  await el.updateComplete;
  const seats = field(el, "seats")!.getBoundingClientRect();
  const shape = shapeGroup(el)!.getBoundingClientRect();
  expect(shape.top).toBeGreaterThanOrEqual(seats.bottom);
});

for (const locale of ["en-GB", "es-ES"]) {
  it(`puts Shape beside Seats in the editor's widest side column (${locale})`, async () => {
    setLocale(locale);
    const el = await open();
    el.style.width = "288px";
    await el.updateComplete;
    const seats = field(el, "seats")!.getBoundingClientRect();
    const block = shapeGroup(el)!.parentElement!.getBoundingClientRect();
    expect(Math.abs(block.top - seats.top)).toBeLessThanOrEqual(0.5);
    expect(block.left).toBeGreaterThanOrEqual(seats.right);
  });
}

it("typing a name sends one merged change", async () => {
  const el = await open();
  const { changes } = listen(el);
  await set(el, "table-name", "T1a");
  await set(el, "table-name", "T1ab");
  expect(changes).toHaveLength(2);
  expect(changes.map((c) => c.mergeKey)).toEqual(["label:m1", "label:m1"]);
  expect(tableOf(changes[1], "m1")!.label).toBe("T1ab");
});

it("an empty seat count sends no seats", async () => {
  const el = await open();
  const { changes } = listen(el);
  await set(el, "seats", "");
  expect(changes).toHaveLength(1);
  expect(changes[0]!.mergeKey).toBe("seats:m1");
  expect(tableOf(changes[0], "m1")!.seats).toBeNull();
});

interface Invalid {
  key: string;
  field: string;
  text: string | null;
  message?: () => string;
}

function listenInvalid(el: FloorPlanTablePanel): Invalid[] {
  const sent: Invalid[] = [];
  el.addEventListener("floor-plan-invalid", (e) => sent.push((e as CustomEvent<Invalid>).detail));
  return sent;
}

/** Types as a person does: one input event per character, after clearing the field. */
async function typeInto(el: FloorPlanTablePanel, name: string, keys: string): Promise<void> {
  const input = field(el, name)!.shadowRoot!.querySelector("input")!;
  await userEvent.clear(input);
  await userEvent.type(input, keys);
  await el.updateComplete;
}

it("a seat count typed past 999 asks the page to refuse it, sending only the valid prefixes", async () => {
  const el = await open();
  const { changes } = listen(el);
  const invalid = listenInvalid(el);
  await typeInto(el, "seats", "1000");
  expect(changes.map((c) => tableOf(c, "m1")!.seats)).toEqual([null, 1, 10, 100]);
  expect(invalid.at(-1)).toMatchObject({ key: "m1", field: "seats", text: "1000" });
  expect(invalid.at(-1)!.message!()).toBe("Enter 0 to 999.");
});

it("a fraction or a trailing point is refused", async () => {
  const el = await open();
  listen(el);
  const invalid = listenInvalid(el);
  await typeInto(el, "seats", "4.");
  expect(invalid.at(-1)).toMatchObject({ field: "seats", text: "4." });
});

it("a valid value after a refusal tells the page the field is fine", async () => {
  const el = await open();
  const { changes } = listen(el);
  const invalid = listenInvalid(el);
  await typeInto(el, "seats", "1000");
  const input = field(el, "seats")!.shadowRoot!.querySelector("input")!;
  await userEvent.type(input, "{Backspace}");
  expect(invalid.at(-1)).toMatchObject({ key: "m1", field: "seats", text: null });
  expect(tableOf(changes.at(-1), "m1")!.seats).toBe(100);
});

it("shows the refused text the page hands back, and the draft's value once it goes", async () => {
  const el = await open({
    fieldErrors: [{ field: "seats", message: "Enter 0 to 999.", text: "1000" }],
  });
  expect(field(el, "seats")!.value).toBe("1000");
  expect(field(el, "seats")!.error).toBe("Enter 0 to 999.");
  el.fieldErrors = [];
  await el.updateComplete;
  expect(field(el, "seats")!.value).toBe("4");
  expect(field(el, "seats")!.error).toBe("");
});

it("shows a draft value again over text typed into the field", async () => {
  const el = await open();
  listen(el);
  listenInvalid(el);
  await typeInto(el, "seats", "4.");
  expect(field(el, "seats")!.value).toBe("4.");
  el.draft = patchTable(el.draft, "m1", { label: "T1x" });
  await el.updateComplete;
  expect(field(el, "seats")!.value).toBe("4");
});

it("Moveable and shape each send their change", async () => {
  const el = await open();
  const { changes } = listen(el);
  shapeButtons(el)[0]!.click();
  expect(changes).toHaveLength(0);
  const moveable = field(el, "moveable")!;
  moveable.shadowRoot!.querySelector("input")!.click();
  await el.updateComplete;
  expect(tableOf(changes.at(-1), "m1")!.fixed).toBe(true);
  expect(changes.at(-1)!.mergeKey).toBeUndefined();
  shapeButtons(el)[1]!.click();
  await el.updateComplete;
  expect(tableOf(changes.at(-1), "m1")!.placement!.shape).toBe("round");
  expect(changes.at(-1)!.mergeKey).toBeUndefined();
  expect(pressedShape(el)).toEqual(["Round"]);
  expect(changes).toHaveLength(2);
});

it("names its fields in Spanish", async () => {
  setLocale("es-ES");
  const el = await open();
  const label = (name: string) => (field(el, name) as unknown as { label: string }).label;
  expect(label("table-name")).toBe("Nombre");
  expect(label("seats")).toBe("Plazas");
  expect(shapeCaption(el)!.textContent!.trim()).toBe("Forma");
  expect(shapeButtons(el).map((b) => b.getAttribute("aria-label"))).toEqual([
    "Rectángulo",
    "Redonda",
  ]);
  expect(label("moveable")).toBe("Movible");
});

it("an unplaced table offers no shape or size, and no Place", async () => {
  const el = await open({ tableKey: "m2" });
  expect(shapeGroup(el)).toBeNull();
});

it("offers no Place, Remove or Delete, placed or not", async () => {
  for (const tableKey of ["m1", "m2"]) {
    const el = await open({ tableKey });
    for (const name of ["place", "remove", "delete"]) expect(action(el, name)).toBeNull();
    cleanupWidgets();
  }
});

it("shows a refusal under the field it names", async () => {
  const el = await open({ fieldErrors: [{ field: "seats", message: "Too many seats" }] });
  expect(field(el, "seats")!.error).toBe("Too many seats");
  expect(field(el, "table-name")!.error).toBe("");
  el.fieldErrors = [{ field: "label", message: "A table with that name already exists" }];
  await el.updateComplete;
  expect(field(el, "table-name")!.error).toBe("A table with that name already exists");
  expect(field(el, "seats")!.error).toBe("");
});

it("shows each marked field's own refused text and reason, the first mark of a field winning", async () => {
  const el = await open({
    fieldErrors: [
      { field: "seats", message: "Enter 0 to 999.", text: "1000" },
      { field: "seats", message: "Too many seats", text: "5." },
    ],
  });
  expect([field(el, "seats")!.value, field(el, "seats")!.error]).toEqual([
    "1000",
    "Enter 0 to 999.",
  ]);
  expect([field(el, "table-name")!.value, field(el, "table-name")!.error]).toEqual(["T1", ""]);
});

it("shows a refusal of Moveable under the switch", async () => {
  const el = await open({ fieldErrors: [{ field: "fixed", message: "Not allowed" }] });
  const note = el.shadowRoot!.querySelector("[data-error=fixed]")!;
  expect(note.textContent!.trim()).toBe("Not allowed");
  expect((field(el, "moveable") as unknown as { description: string }).description).toBe(
    "Not allowed",
  );
});

it("shows a refusal of the shape under the shape pair", async () => {
  const el = await open({ fieldErrors: [{ field: "shape", message: "Not allowed" }] });
  const note = el.shadowRoot!.querySelector("[data-error=shape]")!;
  expect(note.textContent!.trim()).toBe("Not allowed");
  expect(shapeGroup(el)!.parentElement!.contains(note)).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-error=fixed]")).toBeNull();
});

it("describes each shape button by the shape refusal only while one shows", async () => {
  const el = await open({ fieldErrors: [{ field: "shape", message: "Not allowed" }] });
  for (const button of shapeButtons(el)) {
    const id = button.getAttribute("aria-describedby")!;
    expect(el.shadowRoot!.getElementById(id)!.textContent!.trim()).toBe("Not allowed");
    await expect.element(button).toHaveAccessibleDescription("Not allowed");
  }
  el.fieldErrors = [];
  await el.updateComplete;
  expect(shapeButtons(el).map((b) => b.hasAttribute("aria-describedby"))).toEqual([false, false]);
});

it("shows nothing for a table the draft does not hold", async () => {
  const el = await open({ tableKey: "gone" });
  expect(el.shadowRoot!.querySelector("[name]")).toBeNull();
});

it("has no Joins section and no Add join", async () => {
  const el = await open();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-joins-heading]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=add-join]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-join]")).toBeNull();
});
