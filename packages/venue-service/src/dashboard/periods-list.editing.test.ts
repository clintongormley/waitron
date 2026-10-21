import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, type WtDataTable } from "@waitron/ui";
import { CALENDAR_COLOURS } from "../hours-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi, type PaintedInRow } from "./opening-hours-client.js";
import type { PeriodDialog } from "./period-dialog.js";
import type { PeriodRow, PeriodsList } from "./periods-list.js";

import "./periods-list.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

/** Each bin lies inside the table's scroll box and the screen, and is what a tap at its centre hits. */
function expectBinsOnScreen(table: Element, rows: number) {
  const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(scroll.scrollWidth, "the table overflows its box").toBeGreaterThan(scroll.clientWidth);
  expect(scroll.scrollLeft).toBe(0);
  const box = scroll.getBoundingClientRect();
  const bins = [...table.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=delete-period]")];
  expect(bins).toHaveLength(rows);
  for (const [index, bin] of bins.entries()) {
    const at = bin.shadowRoot!.querySelector("button")!.getBoundingClientRect();
    expect(at.width, `row ${index}`).toBeGreaterThan(0);
    expect(at.right, `row ${index}`).toBeLessThanOrEqual(box.right);
    expect(at.left, `row ${index}`).toBeGreaterThanOrEqual(box.left);
    expect(at.right, `row ${index} against the screen`).toBeLessThanOrEqual(window.innerWidth);
    const hit = table.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
    expect(hit !== null && bin.contains(hit), `row ${index} is covered`).toBe(true);
  }
}

type Period = OpeningHoursModel["departments"][number]["periods"][number];
const lunch = (): Period => ({
  id: "p1",
  name: "Lunch",
  colour: "green",
  menuId: "lunch",
  staffMenuIds: ["staff"],
  endOffsetMinutes: 0,
  floorPlanSetId: null,
  weekdays: [1, 3],
  routingUses: [],
});

/** One active department, Restaurant, and an inactive Deli the list does not show. */
function model(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-12",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [
      { id: "lunch", name: "Lunch menu", active: true, includes: ["desserts", "drinks"] },
      { id: "desserts", name: "Desserts", active: true, includes: [] },
      { id: "drinks", name: "Drinks", active: true, includes: [] },
      { id: "staff", name: "Staff snacks", active: true, includes: [] },
    ],
    seasons: [{ id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" }],
    currentSeasonId: "winter",
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        zones: [],
        periods: [lunch()],
        seasonWeeks: [],
      },
      { id: "deli", name: "Deli", active: false, zones: [], periods: [], seasonWeeks: [] },
    ],
  };
}
function twoDepartments(): OpeningHoursModel {
  const data = model();
  data.departments = [
    ...data.departments,
    {
      id: "bar",
      name: "Bar",
      active: true,
      zones: [],
      periods: [{ ...lunch(), id: "p3", name: "All day", colour: "red" }],
      seasonWeeks: [],
    },
  ];
  return data;
}

const PAINTED_IN = "/management-api/venue-service/menu-periods/painted-in";
const unpainted = (): PaintedInRow[] => [{ periodId: "p1", seasons: [], specialDays: [] }];
/** Answers the list's Painted-in watch with `painted`; everything else goes to `request`. */
function withPaintedIn(
  request: DashboardRequest,
  painted: () => PaintedInRow[] = unpainted,
): DashboardRequest {
  return (async (path, method, body, options) =>
    method === "GET" && path === PAINTED_IN
      ? structuredClone(painted())
      : request(path, method, body, options)) as DashboardRequest;
}

async function mount(
  request: DashboardRequest = (async () => structuredClone(model())) as DashboardRequest,
  readOnly = false,
) {
  const el = document.createElement("periods-list") as PeriodsList;
  el.api = new OpeningHoursApi(withPaintedIn(request));
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => table(el)).not.toBeNull();
  await table(el)!.updateComplete;
  return el;
}
function table(el: PeriodsList) {
  return el.shadowRoot!.querySelector<WtDataTable<PeriodRow>>("wt-data-table");
}
const periodRow = (el: PeriodsList, id: string) =>
  table(el)!.rows.find((row) => row.kind === "period" && row.id === id) as
    (PeriodRow & { kind: "period" }) | undefined;
function editButton(el: PeriodsList, id = "p1") {
  const grid = table(el)!;
  const button = grid.shadowRoot!.querySelector<HTMLButtonElement>(
    `tr[data-row-key="period:${id}"] button.row-activate`,
  );
  expect(button, `Edit on ${id}`).not.toBeNull();
  return button!;
}
const dialogOf = (el: PeriodsList) => el.shadowRoot!.querySelector<PeriodDialog>("period-dialog");
async function edit(el: PeriodsList, existing?: string) {
  await table(el)!.updateComplete;
  if (existing) editButton(el, existing).click();
  else el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-period]")!.click();
  await el.updateComplete;
  const dialog = dialogOf(el);
  expect(dialog, "period dialog opens").not.toBeNull();
  await dialog!.updateComplete;
  return dialog!;
}
async function change(dialog: PeriodDialog, name: string, value: string) {
  dialog
    .shadowRoot!.querySelector<HTMLElement>(`[name=${name}]`)!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await dialog.updateComplete;
}
const saveButton = (dialog: PeriodDialog) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-period]")!;
function submit(dialog: PeriodDialog) {
  saveButton(dialog).click();
}
const nameField = (dialog: PeriodDialog) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
const checkedColour = (dialog: PeriodDialog) => {
  const value =
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
      "wt-colour-chooser[name=colour]",
    )?.value ?? "";
  return (CALENDAR_COLOURS as readonly string[]).includes(value) ? value : null;
};
const isHoursRead = (path: string, method: string) =>
  method === "GET" && path.endsWith("/opening-hours");

it("creates the changed draft and closes it before refreshing the list", async () => {
  const writes: unknown[] = [];
  let reads = 0;
  const data = model();
  const el = await mount((async (path, method, body) => {
    if (method === "GET") {
      if (isHoursRead(path, method)) reads++;
      return structuredClone(data);
    }
    writes.push({ path, method, body });
    data.departments[0]!.periods = [
      ...data.departments[0]!.periods,
      { ...lunch(), id: "p2", name: "Dinner", colour: "red", staffMenuIds: [], weekdays: [] },
    ];
    return { id: "p2" };
  }) as DashboardRequest);
  const dialog = await edit(el);
  await change(dialog, "name", " Dinner ");
  await change(dialog, "menuId", "lunch");
  submit(dialog);
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => dialogOf(el)).toBeNull();
  await expect.poll(() => reads).toBe(2);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/departments/restaurant/menu-periods",
      method: "POST",
      body: {
        name: "Dinner",
        colour: "red",
        menuId: "lunch",
        staffMenuIds: [],
      },
    },
  ]);
  await expect.poll(() => periodRow(el, "p2")?.name).toBe("Dinner");
});

it("updates the existing period and preserves every other submitted value", async () => {
  const writes: unknown[] = [];
  const el = await mount((async (path, method, body) => {
    if (method === "GET") return model();
    writes.push({ path, method, body });
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Late lunch");
  submit(dialog);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/menu-periods/p1",
      method: "PATCH",
      body: {
        name: "Late lunch",
        colour: "green",
        menuId: "lunch",
        staffMenuIds: ["staff"],
      },
    },
  ]);
  await expect.poll(() => dialogOf(el)).toBeNull();
});

it("keeps a field refusal under the name and permits retry", async () => {
  let writes = 0;
  const data = model();
  const el = await mount((async (_path, method) => {
    if (method === "GET") return structuredClone(data);
    writes++;
    throw { code: "menu_period.name_taken" };
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Dinner");
  submit(dialog);
  await expect
    .poll(() => nameField(dialog).error)
    .toBe("Another period of this department already has this name.");
  data.departments[0]!.periods = [{ ...lunch(), name: "New server label" }];
  el.api.rereadWatches();
  await expect.poll(() => periodRow(el, "p1")?.name).toBe("New server label");
  expect(nameField(dialog).error).toBe("Another period of this department already has this name.");
  expect(saveButton(dialog).disabled).toBe(false);
  submit(dialog);
  await expect.poll(() => writes).toBe(2);
});

it("places a refused period name under Name with the bottom explanation and retry enabled", async () => {
  const writes: unknown[] = [];
  const el = await mount((async (_path, method, body) => {
    if (method === "GET") return model();
    writes.push(body);
    throw { code: "menu_timetable.invalid", params: { field: "name" } };
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Dinner");
  submit(dialog);
  await expect.poll(() => nameField(dialog).error).toBe("Check this value.");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  expect(saveButton(dialog).disabled).toBe(false);
  expect(nameField(dialog).value).toBe("Dinner");
  submit(dialog);
  await expect.poll(() => writes.length).toBe(2);
  const body = {
    name: "Dinner",
    colour: "green",
    menuId: "lunch",
    staffMenuIds: ["staff"],
  };
  expect(writes).toEqual([body, body]);
});

it("reports a failed refresh as a load failure after the write closed the dialog", async () => {
  let reads = 0;
  const el = await mount((async (path, method) => {
    if (method === "GET") {
      if (isHoursRead(path, method) && ++reads > 1) throw new Error("offline");
      return model();
    }
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Dinner");
  submit(dialog);
  await expect.poll(() => dialogOf(el)).toBeNull();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")?.textContent)
    .toBe("Periods could not be loaded. It will be tried again.");
  expect(el.shadowRoot!.querySelectorAll("[role=alert]")).toHaveLength(1);
});

it("does not reset an edited period when a background snapshot arrives", async () => {
  const data = model();
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "My draft");
  data.departments[0]!.periods = [{ ...lunch(), name: "Someone else's edit" }];
  el.api.rereadWatches();
  await expect.poll(() => periodRow(el, "p1")?.name).toBe("Someone else's edit");
  expect(nameField(dialog).value).toBe("My draft");
});

it("does not let a departed dialog's close event dismiss the new dialog", async () => {
  const el = await mount();
  const old = await edit(el, "p1");
  old.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  const current = await edit(el);
  old.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(dialogOf(el)).toBe(current);
  expect(current.open).toBe(true);
});

it("keeps input entered after submission and makes the written input its new baseline", async () => {
  let resolve!: () => void;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    await new Promise<void>((done) => {
      resolve = done;
    });
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Written lunch");
  submit(dialog);
  await change(dialog, "name", "Newer lunch");
  await expect.poll(() => typeof resolve).toBe("function");
  resolve();
  await expect.poll(() => dialog.busy).toBe(false);
  expect(dialogOf(el)).toBe(dialog);
  expect(nameField(dialog).value).toBe("Newer lunch");
  await change(dialog, "name", "Written lunch");
  expect(saveButton(dialog).disabled).toBe(true);
});

it("blocks duplicate pending writes and read-only submissions", async () => {
  let writes = 0;
  let resolve!: () => void;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    writes++;
    await new Promise<void>((done) => {
      resolve = done;
    });
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Dinner");
  submit(dialog);
  submit(dialog);
  expect(writes).toBe(1);
  resolve();
  await expect.poll(() => dialogOf(el)).toBeNull();
  const next = await edit(el, "p1");
  await change(next, "name", "Supper");
  el.readOnly = true;
  submit(next);
  await el.updateComplete;
  expect(writes).toBe(1);
});

it("ignores a late refused save after the screen disconnects", async () => {
  let reject!: (error: unknown) => void;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    await new Promise<void>((_done, fail) => {
      reject = fail;
    });
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Dinner");
  submit(dialog);
  el.remove();
  reject({ code: "menu_period.name_taken" });
  await el.updateComplete;
  expect(dialog.refusal).toBeUndefined();
});

it("saves a changed period through the visible native button", async () => {
  let writes = 0;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    writes++;
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "name", "Dinner");
  const button = saveButton(dialog);
  await button.updateComplete;
  const native = button.shadowRoot!.querySelector("button")!;
  expect(native.disabled).toBe(false);
  expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
  await userEvent.click(native);
  await expect.poll(() => writes).toBe(1);
  await expect.poll(() => dialogOf(el)).toBeNull();
});

it("on a phone a row tap opens its dialog and its bin is on screen", async () => {
  const initial = { width: window.innerWidth, height: window.innerHeight };
  try {
    await page.viewport(390, 844);
    expect(window.innerWidth).toBe(390);
    const el = await mount();
    const grid = table(el)!;
    const bin = grid.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      'tr[data-row-key="period:p1"] [data-test=delete-period]',
    )!;
    await bin.updateComplete;
    expectBinsOnScreen(grid, 1);
    const at = bin.shadowRoot!.querySelector("button")!.getBoundingClientRect();
    expect(at.width).toBeGreaterThan(0);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.right).toBeLessThanOrEqual(window.innerWidth);
    const index = grid.columns.findIndex((c) => c.key === "customerMenu");
    const menuCell = grid.shadowRoot!.querySelectorAll<HTMLElement>(
      'tr[data-row-key="period:p1"] td',
    )[index]!;
    await userEvent.click(menuCell, { force: true });
    await expect.poll(() => dialogOf(el)?.period?.id).toBe("p1");
  } finally {
    await page.viewport(initial.width, initial.height);
  }
});

it("blocks opening a second dialog from another row and from departed controls", async () => {
  const data = model();
  data.departments[0]!.periods = [lunch(), { ...lunch(), id: "p2", name: "Dinner", colour: "red" }];
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const add = el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-period]")!;
  const dialog = await edit(el, "p1");
  add.click();
  editButton(el, "p2").click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("period-dialog")).toHaveLength(1);
  expect(dialogOf(el)).toBe(dialog);
  expect(dialog.period?.id).toBe("p1");
  dialog.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(dialogOf(el)).toBeNull();
  el.remove();
  add.click();
  await el.updateComplete;
  expect(dialogOf(el)).toBeNull();
});

it.each([
  [[], "red"],
  [["red", "orange"], "amber"],
  [
    [
      "red",
      "orange",
      "amber",
      "yellow",
      "lime",
      "green",
      "teal",
      "cyan",
      "sky",
      "blue",
      "indigo",
      "purple",
      "magenta",
      "pink",
      "brown",
      "grey",
    ],
    "red",
  ],
] as const)(
  "starts a new period with the first unused colour of the chosen department (%j → %s)",
  async (used, expected) => {
    const data = model();
    data.departments[0]!.periods = used.map((colour, index) => ({
      ...lunch(),
      id: `p${index}`,
      colour,
    }));
    const writes: unknown[] = [];
    const el = await mount((async (path, method, body) => {
      if (method === "GET") return structuredClone(data);
      writes.push({ path, method, body });
      return { id: "new" };
    }) as DashboardRequest);
    const dialog = await edit(el);
    expect(
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!
        .value,
    ).toBe("restaurant");
    expect(checkedColour(dialog)).toBe(expected);
    expect(saveButton(dialog).variant).toBe("secondary");
    expect(saveButton(dialog).disabled).toBe(true);
    await change(dialog, "name", "Breakfast");
    await change(dialog, "menuId", "lunch");
    submit(dialog);
    await expect.poll(() => writes.length).toBe(1);
    expect(writes).toEqual([
      {
        path: "/management-api/venue-service/departments/restaurant/menu-periods",
        method: "POST",
        body: {
          name: "Breakfast",
          colour: expected,
          menuId: "lunch",
          staffMenuIds: [],
        },
      },
    ]);
  },
);

it("keeps a new period's selected colour through background reads and uses fresh colours on reopening", async () => {
  const data = model();
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const dialog = await edit(el);
  expect(checkedColour(dialog)).toBe("red");
  await change(dialog, "colour", "purple");
  data.departments[0]!.periods = [{ ...lunch(), colour: "red" }];
  el.api.rereadWatches();
  await expect.poll(() => periodRow(el, "p1")?.colour).toBe("red");
  expect(checkedColour(dialog)).toBe("purple");
  dialog.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  const reopened = await edit(el);
  expect(checkedColour(reopened)).toBe("orange");
  expect(saveButton(reopened).disabled).toBe(true);
});

it("marks the new period's missing name, menu and department above the buttons without submitting", async () => {
  const writes: unknown[] = [];
  const el = await mount((async (_path, method, body) => {
    if (method === "GET") return twoDepartments();
    writes.push(body);
  }) as DashboardRequest);
  const dialog = await edit(el);
  await change(dialog, "colour", "purple");
  submit(dialog);
  await dialog.updateComplete;
  expect(nameField(dialog).error).toBe("Enter a name.");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=menuId]")!.error,
  ).toBe("Choose a menu.");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!
      .error,
  ).toBe("Choose a department.");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  expect(saveButton(dialog).disabled).toBe(true);
  expect(writes).toEqual([]);
});

it("sends a colour-only edit through the real period client and closes before a failed refresh", async () => {
  const writes: unknown[] = [];
  let reads = 0;
  const el = await mount((async (path, method, body) => {
    if (method === "GET") {
      if (isHoursRead(path, method) && ++reads > 1) throw { code: "connection.failed" };
      return structuredClone(model());
    }
    writes.push({ path, method, body });
  }) as DashboardRequest);
  const dialog = await edit(el, "p1");
  await change(dialog, "colour", "purple");
  submit(dialog);
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: "/management-api/venue-service/menu-periods/p1",
        method: "PATCH",
        body: {
          name: "Lunch",
          colour: "purple",
          menuId: "lunch",
          staffMenuIds: ["staff"],
        },
      },
    ]);
  await expect.poll(() => dialogOf(el)).toBeNull();
  await expect.poll(() => reads).toBe(2);
});

it("+ Add period on a venue with two departments asks for the department and creates the period in the one chosen", async () => {
  const writes: unknown[] = [];
  const el = await mount((async (path, method, body) => {
    if (method === "GET") return twoDepartments();
    writes.push({ path, method, body });
    return { id: "p9" };
  }) as DashboardRequest);
  const dialog = await edit(el);
  expect(
    dialog.departments?.map(({ id, name, colourUsers }) => ({ id, name, colourUsers })),
  ).toEqual([
    { id: "restaurant", name: "Restaurant", colourUsers: [{ name: "Lunch", colour: "green" }] },
    { id: "bar", name: "Bar", colourUsers: [{ name: "All day", colour: "red" }] },
  ]);
  expect(dialog.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Add period");
  expect(saveButton(dialog).textContent!.trim()).toBe("Save");
  emit(dialog, "period-save", {
    periodId: null,
    input: {
      name: "No department",
      colour: "red",
      menuId: "lunch",
      staffMenuIds: [],
    },
  });
  await el.updateComplete;
  expect(writes).toEqual([]);
  await change(dialog, "departmentId", "bar");
  await change(dialog, "name", "Dinner");
  await change(dialog, "menuId", "lunch");
  submit(dialog);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/departments/bar/menu-periods",
      method: "POST",
      body: {
        name: "Dinner",
        colour: "orange",
        menuId: "lunch",
        staffMenuIds: [],
      },
    },
  ]);
  await expect.poll(() => dialogOf(el)).toBeNull();
});

it("+ Add period: a chosen department a live update deactivates is no longer sent, and a department.not_found refusal shows under Department", async () => {
  const data = twoDepartments();
  const writes: unknown[] = [];
  const el = await mount((async (path, method) => {
    if (method === "GET") return structuredClone(data);
    writes.push(path);
    throw { code: "department.not_found", params: { departmentId: "restaurant" } };
  }) as DashboardRequest);
  const dialog = await edit(el);
  const department = () =>
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!;
  await change(dialog, "departmentId", "bar");
  await change(dialog, "name", "Dinner");
  await change(dialog, "menuId", "lunch");
  data.departments.find(({ id }) => id === "bar")!.active = false;
  el.api.rereadWatches();
  await expect.poll(() => dialog.departments?.map(({ id }) => id)).toEqual(["restaurant"]);
  await dialog.updateComplete;
  submit(dialog);
  await dialog.updateComplete;
  expect(writes).toEqual([]);
  expect(department().error).toBe("Choose a department.");
  expect(saveButton(dialog).disabled).toBe(true);
  expect(nameField(dialog).value).toBe("Dinner");

  await change(dialog, "departmentId", "restaurant");
  submit(dialog);
  await expect
    .poll(() => writes)
    .toEqual(["/management-api/venue-service/departments/restaurant/menu-periods"]);
  await expect.poll(() => department().error).toBe("This department no longer exists.");
  expect(dialogOf(el)).toBe(dialog);
});

it("+ Add period is disabled until the periods have been read, and after a failed first read", async () => {
  let fail!: (error: unknown) => void;
  let reads = 0;
  const el = document.createElement("periods-list") as PeriodsList;
  el.api = new OpeningHoursApi(
    withPaintedIn((() =>
      ++reads === 1
        ? new Promise<OpeningHoursModel>((_done, reject) => {
            fail = reject;
          })
        : Promise.resolve(model())) as unknown as DashboardRequest),
  );
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  const add = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=add-period]")!;
  expect(add().disabled).toBe(true);
  fail(new Error("offline"));
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")).not.toBeNull();
  expect(add().disabled).toBe(true);
  add().click();
  await el.updateComplete;
  expect(dialogOf(el)).toBeNull();
  el.api.rereadWatches();
  await expect.poll(() => table(el)).not.toBeNull();
  expect(add().disabled).toBe(false);
  expect((await edit(el)).departments?.map(({ id }) => id)).toEqual(["restaurant"]);
});

it("Opening a period shows Painted in as links from the list's own read, with no extra request", async () => {
  const paintedReads: string[] = [];
  const el = document.createElement("periods-list") as PeriodsList;
  el.api = new OpeningHoursApi((async (path: string, method: string) => {
    if (path === PAINTED_IN) {
      paintedReads.push(method);
      return [
        {
          periodId: "p1",
          seasons: [{ id: "winter", name: "Winter" }],
          specialDays: [{ id: "sd1", name: "Company dinners" }],
        },
      ];
    }
    return model();
  }) as DashboardRequest);
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => table(el)).not.toBeNull();
  await expect.poll(() => paintedReads).toEqual(["GET"]);
  const dialog = await edit(el, "p1");
  const chips = () =>
    [...dialog.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=painted-in] .chip")].map(
      (chip) => ({
        text: chip.textContent!.trim(),
        tag: chip.localName,
        href: chip.getAttribute("href"),
      }),
    );
  expect(chips()).toEqual([
    {
      text: "Winter",
      tag: "a",
      href: "/manage/opening-hours/view/season/season/winter/department/restaurant",
    },
    {
      text: "Company dinners",
      tag: "a",
      href: "/manage/opening-hours/view/special-day/special-day/sd1",
    },
  ]);
  expect(dialog.paintedInLinks).toBe(true);
  await el.updateComplete;
  expect(paintedReads).toEqual(["GET"]);
});

class LeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("periods-editing-leave-app", LeaveApp);

function liveFixture(): OpeningHoursModel {
  return {
    ...model(),
    menus: [{ id: "m1", name: "Menu", active: true, includes: [] }],
    departments: ["d1", "d2"].map((id, index) => ({
      id,
      name: id,
      active: true,
      zones: [],
      periods: [
        {
          id: `p${index + 1}`,
          name: "Lunch",
          colour: "blue" as const,
          menuId: "m1",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          floorPlanSetId: null,
          weekdays: [1],
          routingUses: [],
        },
      ],
      seasonWeeks: [],
    })),
  };
}
async function live(write: () => Promise<unknown> = async () => undefined) {
  const app = document.createElement("periods-editing-leave-app") as LeaveApp;
  applyTokens(app);
  hosts.push(app);
  document.body.append(app);
  await app.updateComplete;
  const liveData = new LiveData();
  let current = liveFixture();
  const writes: unknown[][] = [];
  const screen = document.createElement("periods-list") as PeriodsList;
  screen.api = new OpeningHoursApi(
    withPaintedIn((async (path, method, body) => {
      if (method === "GET") return structuredClone(current);
      writes.push([path, method, body]);
      return write();
    }) as DashboardRequest),
    liveData,
  );
  app.append(screen);
  await expect.poll(() => table(screen)).not.toBeNull();
  async function replace(next: OpeningHoursModel) {
    current = next;
    liveData.invalidate([{ type: "departments" }, { type: "floor_zones" }]);
    await expect
      .poll(() => table(screen)!.rows.length)
      .toBe(
        next.departments
          .filter((department) => department.active)
          .reduce((count, department) => count + 1 + department.periods.length, 0),
      );
    await screen.updateComplete;
  }
  async function staged() {
    const dialog = await edit(screen, "p1");
    await change(dialog, "name", "Staged lunch");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    return dialog;
  }
  return { app, screen, writes, replace, staged };
}
function emit(el: Element, name: string, detail: unknown) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

it.each(["department", "inactive department", "period"])(
  "remote %s deletion retires the dirty retained period dialog",
  async (kind) => {
    const { app, screen, writes, replace, staged } = await live();
    const dialog = await staged();
    const data = liveFixture();
    await replace(
      kind === "department"
        ? { ...data, departments: data.departments.slice(1) }
        : {
            ...data,
            departments: data.departments.map((d) =>
              d.id !== "d1"
                ? d
                : kind === "period"
                  ? { ...d, periods: [] }
                  : { ...d, active: false },
            ),
          },
    );
    expect(dialogOf(screen)).toBeNull();
    expect(dialog.isConnected).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    emit(dialog, "period-save", { periodId: "p1", input: { name: "Stale" } });
    await screen.updateComplete;
    expect(writes).toEqual([]);
  },
);

it("a live change to another department preserves the retained dirty period dialog", async () => {
  const { app, screen, replace, staged } = await live();
  const dialog = await staged();
  const data = liveFixture();
  await replace({ ...data, departments: data.departments.slice(0, 1) });
  expect(dialogOf(screen)).toBe(dialog);
  expect(nameField(dialog).value).toBe("Staged lunch");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});

it("voluntary period close waits for the native close event after discarding its draft", async () => {
  const { app, screen, staged } = await live();
  const dialog = await staged();
  const modal = dialog.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  const closed = new Promise<void>((done) =>
    modal.addEventListener("wt-close", () => done(), { once: true }),
  );
  const result = modal.requestClose("cancel");
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await result).toBe(true);
  await closed;
  await screen.updateComplete;
  expect(dialogOf(screen)).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a late period save cannot revive the removed department's retained dialog", async () => {
  let finish!: () => void;
  const { app, screen, writes, replace, staged } = await live(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  const dialog = await staged();
  submit(dialog);
  await expect.poll(() => writes.length).toBe(1);
  const data = liveFixture();
  await replace({ ...data, departments: data.departments.slice(1) });
  finish();
  await new Promise((done) => setTimeout(done, 0));
  await screen.updateComplete;
  expect(dialog.isConnected).toBe(false);
  expect(dialogOf(screen)).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("editing a period marks the colours its department's other periods use, never its own", async () => {
  const data = model();
  data.departments[0]!.periods = [
    { ...lunch(), colour: "red" },
    { ...lunch(), id: "p2", name: "Dinner", colour: "red" },
    { ...lunch(), id: "p3", name: "Brunch", colour: "blue" },
  ];
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const dialog = await edit(el, "p1");
  const chooser = dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
    "wt-colour-chooser[name=colour]",
  )!;
  const marks = Object.fromEntries(chooser.choices.map((c) => [c.value, c.usedBy ?? []]));
  expect(marks.red).toEqual(["Dinner"]);
  expect(marks.blue).toEqual(["Brunch"]);
  expect(checkedColour(dialog)).toBe("red");
});

it("a list redraw that changes neither the periods nor the period edited hands the dialog the same colour arrays", async () => {
  const data = model();
  data.departments[0]!.periods = [lunch(), { ...lunch(), id: "p2", name: "Dinner", colour: "red" }];
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const dialog = await edit(el, "p1");
  const chooser = () =>
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
      "wt-colour-chooser[name=colour]",
    )!;
  const users = dialog.colourUsers;
  const choices = chooser().choices;
  el.requestUpdate();
  await el.updateComplete;
  await dialog.updateComplete;
  expect(dialog.colourUsers).toBe(users);
  expect(chooser().choices).toBe(choices);
  data.departments[0]!.periods[1]!.colour = "blue";
  el.api.rereadWatches();
  await expect.poll(() => dialog.colourUsers).not.toBe(users);
  expect(dialog.colourUsers).toEqual([{ name: "Dinner", colour: "blue" }]);
});

it("a list redraw hands a dialog asking for the department the same department list", async () => {
  const el = await mount((async () => twoDepartments()) as DashboardRequest);
  const dialog = await edit(el);
  const departments = dialog.departments;
  const users = dialog.colourUsers;
  el.requestUpdate();
  await el.updateComplete;
  expect(dialog.departments).toBe(departments);
  expect(dialog.colourUsers).toBe(users);
});
