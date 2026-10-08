import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, DashboardTable, FloorZone } from "../api/client.js";
import "./floor-screen.js";
import type { FloorScreen } from "./floor-screen.js";

afterEach(cleanupWidgets);

const zones: FloorZone[] = [
  { id: "z1", name: "Comedor", displayOrder: 0, active: true },
  { id: "z2", name: "Terraza", displayOrder: 1, active: true },
];

// Every field a row shows holds something, in the spellings a stored table comes back in, beside a
// table with no capacity and a disabled one, so a field that rewrites its value on first draw would
// show as a change.
const seed: DashboardTable[] = [
  {
    id: "t1",
    label: "4",
    zoneId: "z1",
    capacity: 2,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
    posX: 250,
    posY: 400,
    shape: "round",
    rotation: 0,
  },
  {
    id: "t2",
    label: "Barra 1",
    zoneId: null,
    capacity: null,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
  {
    id: "t3",
    label: "7",
    zoneId: "z2",
    capacity: 6,
    active: false,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

function stubApi() {
  let rows = seed.map((row) => ({ ...row }));
  return {
    listZones: vi.fn(async () => zones.map((zone) => ({ ...zone }))),
    listTables: vi.fn(async () => rows.map((row) => ({ ...row }))),
    createTable: vi.fn(async (input: { label: string }) => {
      rows = [
        ...rows,
        {
          id: "t9",
          label: input.label,
          zoneId: null,
          capacity: null,
          active: true,
          createdAt: "2026-08-17T00:00:00Z",
        },
      ];
      return { id: "t9" };
    }),
    updateTable: vi.fn(async (id: string, patch: Partial<DashboardTable>) => {
      rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    }),
    deactivateTable: vi.fn(async () => {}),
    setTablePlacement: vi.fn(async () => {}),
    clearPlacement: vi.fn(async () => {}),
  };
}

async function mount() {
  const api = stubApi();
  const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", {
    api: api as unknown as DashboardApi,
  });
  await expect.poll(() => el.shadowRoot!.querySelector('[data-test="table-row-t3"]')).toBeTruthy();
  await el.updateComplete;
  return { el, api };
}

function button(el: FloorScreen, selector: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(selector)!;
}
const save = (id: string) => `wt-button[data-test="table-save-${id}"]`;
const add = "wt-button[data-add-table]";
/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: FloorScreen, selector: string) {
  await el.updateComplete;
  const action = button(el, selector);
  await action.updateComplete;
  return {
    variant: action.variant,
    disabled: action.disabled,
    innerDisabled: action.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };

/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: FloorScreen, selector: string) {
  const inner = button(el, selector).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
async function type(el: FloorScreen, selector: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(selector)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

it("every stored table's Save and the add action open quiet and disabled, and a press sends nothing", async () => {
  const { el, api } = await mount();
  for (const selector of [save("t1"), save("t2"), save("t3"), add]) {
    expect(await state(el, selector)).toEqual(quiet);
    await press(el, selector);
  }
  expect(api.updateTable).not.toHaveBeenCalled();
  expect(api.createTable).not.toHaveBeenCalled();
});

it("an edited label wakes its own table's Save only, and typing the stored label back quiets it", async () => {
  const { el } = await mount();
  await type(el, '[data-test="table-label-t1"]', "4B");
  expect(await state(el, save("t1"))).toEqual(ready);
  expect(await state(el, save("t2"))).toEqual(quiet);
  expect(await state(el, add)).toEqual(quiet);
  await type(el, '[data-test="table-label-t1"]', "4");
  expect(await state(el, save("t1"))).toEqual(quiet);
});

it("a capacity typed into an empty one, or changed, wakes Save until the stored value is back", async () => {
  const { el } = await mount();
  await type(el, '[data-test="table-capacity-t2"]', "3");
  expect(await state(el, save("t2"))).toEqual(ready);
  await type(el, '[data-test="table-capacity-t2"]', "");
  expect(await state(el, save("t2"))).toEqual(quiet);
  await type(el, '[data-test="table-capacity-t1"]', "5");
  expect(await state(el, save("t1"))).toEqual(ready);
  await type(el, '[data-test="table-capacity-t1"]', "2");
  expect(await state(el, save("t1"))).toEqual(quiet);
});

it("a saved table's Save goes quiet again while the row stays on screen", async () => {
  const { el, api } = await mount();
  await type(el, '[data-test="table-label-t1"]', "4B");
  await press(el, save("t1"));
  expect(api.updateTable).toHaveBeenCalledOnce();
  await expect.poll(() => state(el, save("t1"))).toEqual(quiet);
});

it("a typed name wakes the add action, and clearing it or typing only spaces quiets it", async () => {
  const { el, api } = await mount();
  await type(el, "[data-new-table]", "12");
  expect(await state(el, add)).toEqual(ready);
  await type(el, "[data-new-table]", "");
  expect(await state(el, add)).toEqual(quiet);
  await type(el, "[data-new-table]", "   ");
  expect(await state(el, add)).toEqual(quiet);
  await press(el, add);
  expect(api.createTable).not.toHaveBeenCalled();
});

it("the add action goes quiet again after a table is created", async () => {
  const { el, api } = await mount();
  await type(el, "[data-new-table]", "12");
  await press(el, add);
  expect(api.createTable).toHaveBeenCalledWith({ label: "12" });
  await expect.poll(() => el.shadowRoot!.querySelector('[data-test="table-row-t9"]')).toBeTruthy();
  expect(await state(el, add)).toEqual(quiet);
});

// A host `.click()` reaches the listener even while the inner button is disabled, so these press the
// host: what they prove is that the handler itself sends nothing for an untouched form.
it("a press that reaches an untouched table's Save handler sends nothing", async () => {
  const { el, api } = await mount();
  button(el, save("t1")).click();
  await el.updateComplete;
  expect(api.updateTable).not.toHaveBeenCalled();
});

it("a press that reaches the add handler with only spaces typed sends nothing", async () => {
  const { el, api } = await mount();
  await type(el, "[data-new-table]", "   ");
  button(el, add).click();
  await el.updateComplete;
  expect(api.createTable).not.toHaveBeenCalled();
});

it("Disable, Enable and a picked zone are immediate, not gated on a change", async () => {
  const { el, api } = await mount();
  await press(el, 'wt-button[data-test="table-deactivate-t1"]');
  expect(api.deactivateTable).toHaveBeenCalledWith("t1");
  await press(el, 'wt-button[data-test="table-enable-t3"]');
  expect(api.updateTable).toHaveBeenCalledWith("t3", { active: true });
  await chooseOption(el.shadowRoot!.querySelector('[data-test="table-zone-t2"]')!, "z2");
  await expect.poll(() => api.updateTable).toHaveBeenCalledWith("t2", { zoneId: "z2" });
});
