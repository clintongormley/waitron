import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, NavigationGuard } from "@waitron/ui";
import { page } from "vitest/browser";
import {
  chooseOption,
  expectRowMenusOnScreen,
  formMessageOf,
} from "@waitron/ui/src/test-helpers.js";
import type { WtFormActions } from "@waitron/ui";
import type { MenuSlot, MenuTimetableModel } from "../menu-timetable-types.js";
import { MenuTimetableApi } from "./menu-timetable-client.js";
import type { MenuTimetableScreen } from "./menu-timetable-screen.js";
import "./menu-timetable-screen.js";

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/menu-timetable");
});
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});

const MENUS = [
  "Desayunos",
  "Almuerzo",
  "Cena",
  "Bebidas",
  "Café",
  "Cócteles",
  "Copas",
  "Deli para llevar",
  "Brunch de Navidad",
] as const;
type MenuName = (typeof MENUS)[number];
const m = (name: MenuName) => `m-${name}`;
const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});
const weekday = [
  slot("mananas", "08:00", "12:00"),
  slot("mediodia", "13:00", "16:00"),
  slot("noches", "20:00", "23:30"),
];
const late = [slot("noches", "20:00", "23:30"), slot("madrugada", "23:30", "03:00")];

function model(): MenuTimetableModel {
  return {
    menus: MENUS.map((name) => ({ id: m(name), name, active: true })),
    timeZone: "Europe/Madrid",
    clockReadable: true,
    civilDate: "2026-10-07",
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        menuIds: [
          m("Desayunos"),
          m("Almuerzo"),
          m("Cena"),
          m("Bebidas"),
          m("Café"),
          m("Cócteles"),
          m("Copas"),
          m("Brunch de Navidad"),
        ],
        allDayMenuId: m("Bebidas"),
        periods: [
          {
            id: "brunch",
            name: "Brunch navideño",
            menuId: m("Brunch de Navidad"),
            uses: [{ kind: "special_date", specialDateId: "navidad", date: "2025-12-25" }],
          },
          {
            id: "madrugada",
            name: "Madrugada",
            menuId: m("Copas"),
            uses: [
              { kind: "week", weekday: 5 },
              { kind: "week", weekday: 6 },
            ],
          },
          {
            id: "mananas",
            name: "Mañanas",
            menuId: m("Desayunos"),
            uses: [1, 2, 3, 4, 5].map((day) => ({ kind: "week" as const, weekday: day })),
          },
          {
            id: "mediodia",
            name: "Mediodía",
            menuId: m("Almuerzo"),
            uses: [1, 2, 3, 4, 5].map((day) => ({ kind: "week" as const, weekday: day })),
          },
          {
            id: "noches",
            name: "Noches",
            menuId: m("Cena"),
            uses: [1, 2, 3, 4, 5, 6].map((day) => ({ kind: "week" as const, weekday: day })),
          },
        ],
        week: [
          { weekday: 0, slots: [] },
          { weekday: 1, slots: weekday },
          { weekday: 2, slots: weekday },
          { weekday: 3, slots: weekday },
          { weekday: 4, slots: weekday },
          { weekday: 5, slots: [...weekday.slice(0, 2), ...late] },
          { weekday: 6, slots: late },
        ],
        zones: [
          {
            id: "barra",
            name: "Barra",
            active: true,
            allDayMenuId: null,
            periodMenus: [
              { periodId: "mananas", menuId: m("Café") },
              { periodId: "noches", menuId: m("Cócteles") },
            ],
          },
          { id: "sala", name: "Sala", active: true, allDayMenuId: null, periodMenus: [] },
          {
            id: "terraza",
            name: "Terraza",
            active: false,
            allDayMenuId: m("Café"),
            periodMenus: [],
          },
        ],
      },
      {
        id: "deli",
        name: "Deli",
        active: true,
        menuIds: [m("Deli para llevar")],
        allDayMenuId: m("Deli para llevar"),
        periods: [],
        week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ weekday: day, slots: [] })),
        zones: [
          {
            id: "mostrador",
            name: "Mostrador deli",
            active: true,
            allDayMenuId: null,
            periodMenus: [],
          },
        ],
      },
    ],
    specialDates: [
      {
        id: "navidad",
        date: "2025-12-25",
        name: "Navidad",
        timetables: [{ departmentId: "restaurant", slots: [slot("brunch", "11:00", "15:00")] }],
      },
      { id: "fiesta", date: "2026-10-12", name: "Fiesta Nacional", timetables: [] },
      {
        id: "cambio",
        date: "2026-10-25",
        name: "Cambio de hora",
        timetables: [{ departmentId: "restaurant", slots: [] }],
      },
    ],
  };
}

/** A value to answer with, a promise of one, or `{ reject }` to refuse with. */
type Answer = unknown;

function server() {
  const state = { model: model(), reads: [] as Answer[], writes: [] as Answer[] };
  const request = vi.fn<
    (
      path: string,
      method: string,
      body?: unknown,
      options?: { passive?: boolean },
    ) => Promise<unknown>
  >(async (_path, method) => {
    const queue = method === "GET" ? state.reads : state.writes;
    const next = queue.length > 0 ? queue.shift() : method === "GET" ? state.model : undefined;
    const value = await next;
    if (typeof value === "object" && value !== null && "reject" in value)
      throw (value as { reject: unknown }).reject;
    return structuredClone(value);
  });
  const api = new MenuTimetableApi(request as unknown as DashboardRequest);
  const writes = () =>
    request.mock.calls
      .filter((call) => call[1] !== "GET")
      .map((call) => [call[1], call[0], call[2]]);
  return { state, request, api, writes };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const refusal = (code: string, params: Record<string, unknown> = {}) => ({
  reject: Object.assign(new Error(code), { code, params }),
});

async function settle(el: HTMLElement & { updateComplete: Promise<unknown> }) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await el.updateComplete;
}

async function mount(api: MenuTimetableApi, readOnly = false): Promise<MenuTimetableScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("dashboard-menu-timetable-screen");
  el.api = api;
  el.readOnly = readOnly;
  host.append(el);
  await settle(el);
  return el;
}

/** Searches the screen's shadow root and every shadow root under it. */
function findAll<T extends Element = HTMLElement>(el: Element, selector: string): T[] {
  const found: T[] = [];
  const search = (root: ParentNode) => {
    found.push(...root.querySelectorAll<T>(selector));
    for (const child of root.querySelectorAll("*")) if (child.shadowRoot) search(child.shadowRoot);
  };
  search(el.shadowRoot!);
  return found;
}
const find = <T extends Element = HTMLElement>(el: Element, selector: string): T | null =>
  findAll<T>(el, selector)[0] ?? null;

type Field = HTMLElement & {
  value: string;
  error: string;
  disabled: boolean;
  placeholder: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};
const field = (el: Element, name: string) => find<Field>(el, `[name="${name}"]`);
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

async function setField(el: MenuTimetableScreen, name: string, value: string) {
  const target = field(el, name)!;
  expect(target, name).not.toBeNull();
  target.value = value;
  target.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function choose(el: MenuTimetableScreen, name: string, value: string) {
  const target = field(el, name)!;
  expect(target, name).not.toBeNull();
  await chooseOption(target, value);
  await settle(el);
}
async function click(el: MenuTimetableScreen, target: HTMLElement | null) {
  expect(target).not.toBeNull();
  target!.click();
  await settle(el);
}
const byTest = (el: MenuTimetableScreen, test: string) => find(el, `[data-test="${test}"]`);

/** Opens a `wt-row-actions` menu and clicks its action. */
async function menuAction(el: MenuTimetableScreen, scope: Element, test: string) {
  const action = scope.querySelector<HTMLElement>(`[data-test="${test}"]`);
  expect(action, test).not.toBeNull();
  action!
    .closest("wt-row-actions")!
    .shadowRoot!.querySelector<HTMLButtonElement>("button")!
    .click();
  action!.click();
  await settle(el);
}
/** The row of a `wt-data-table` whose first cell reads `first`. */
function row(el: MenuTimetableScreen, table: string, first: string): HTMLElement {
  const rows = findAll(el, `wt-data-table[data-test="${table}"]`).flatMap((t) => [
    ...t.shadowRoot!.querySelectorAll<HTMLElement>("tbody tr"),
  ]);
  const found = rows.find((tr) => text(tr.querySelector("td, th")) === first);
  expect(found, first).toBeDefined();
  return found!;
}

const modal = (el: MenuTimetableScreen) => el.shadowRoot!.querySelector<HTMLElement>("wt-modal");
const saveButton = (el: MenuTimetableScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>('[data-test="save-editor"]')!;
const actions = (el: MenuTimetableScreen) =>
  el.shadowRoot!.querySelector<WtFormActions>("wt-modal wt-form-actions")!;
async function bottomMessage(el: MenuTimetableScreen): Promise<string> {
  return text(await formMessageOf(actions(el)));
}
const listed = (el: MenuTimetableScreen) =>
  [...el.shadowRoot!.querySelectorAll('[data-test="menu-list"] li')].map(text);
const draftList = (el: MenuTimetableScreen) =>
  [...el.shadowRoot!.querySelectorAll('wt-modal [data-test="menu-row"] .menu-name')].map(text);
const weekRow = (el: MenuTimetableScreen, day: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(
    `table[data-test="menu-week"] tr[data-weekday="${day}"]`,
  )!;
const zoneCell = (el: MenuTimetableScreen, zone: string, period: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(
    `table[data-test="zone-menus"] tr[data-period="${period}"] td[data-zone="${zone}"]`,
  )!;

describe("Menu timetable: what a department shows", () => {
  it("shows the first department's list, periods, Monday-first week, special dates and zones", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(text(el.shadowRoot!.querySelector("h1"))).toBe("Menu timetable");
    expect(field(el, "departmentId")!.value).toBe("restaurant");
    expect(text(byTest(el, "clock-note"))).toContain("Europe/Madrid");

    expect(listed(el)).toEqual([
      "Desayunos",
      "Almuerzo",
      "Cena",
      "Bebidas",
      "Café",
      "Cócteles",
      "Copas",
      "Brunch de Navidad",
    ]);
    expect(text(row(el, "periods", "Mañanas"))).toContain(
      "Monday, Tuesday, Wednesday, Thursday, Friday",
    );
    expect(text(row(el, "periods", "Brunch navideño"))).toContain("Thu, 25 Dec 2025");

    const days = [...el.shadowRoot!.querySelectorAll('table[data-test="menu-week"] tbody tr')];
    expect(days.map((tr) => text(tr.querySelector("th")))).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday Today",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(text(weekRow(el, 1).querySelector("td"))).toBe(
      "08:00–12:00 Mañanas, 13:00–16:00 Mediodía, 20:00–23:30 Noches",
    );
    expect(text(weekRow(el, 0).querySelector("td"))).toBe("All-day menu");

    expect(text(row(el, "menu-dates", "Thu, 25 Dec 2025"))).toContain(
      "11:00–15:00 Brunch navideño",
    );
    expect(text(row(el, "menu-dates", "Mon, 12 Oct 2026"))).toContain("Normal week");
    expect(text(row(el, "menu-dates", "Sun, 25 Oct 2026"))).toContain("All-day menu");

    const table = el.shadowRoot!.querySelector('table[data-test="zone-menus"]')!;
    expect([...table.querySelectorAll("thead th")].map(text)).toEqual([
      "Period",
      "Department",
      "Barra",
      "Sala",
      "Terraza (inactive)",
    ]);
    expect([...table.querySelectorAll("tbody th")].map(text)).toEqual([
      "All day",
      "Brunch navideño",
      "Madrugada",
      "Mañanas",
      "Mediodía",
      "Noches",
    ]);
    const override = field(el, "zones.barra.periods.mananas.menuId")!;
    expect(override.value).toBe(m("Café"));
    const inherit = field(el, "zones.sala.periods.mananas.menuId")!;
    expect(inherit.value).toBe("");
    expect(inherit.placeholder).toBe("Desayunos (department's)");
    expect(field(el, "zones.sala.allDayMenuId")!.placeholder).toBe("Bebidas (department's)");
    expect(field(el, "zones.terraza.allDayMenuId")!.value).toBe(m("Café"));
    expect(field(el, "department.allDayMenuId")!.value).toBe(m("Bebidas"));
    expect(field(el, "periods.mananas.menuId")!.value).toBe(m("Desayunos"));
  });

  it("follows the department chosen, and the one a link names", async () => {
    const { api } = server();
    history.replaceState(null, "", "/manage/menu-timetable/department/deli");
    const el = await mount(api);
    expect(field(el, "departmentId")!.value).toBe("deli");
    expect(listed(el)).toEqual(["Deli para llevar"]);
    expect(text(byTest(el, "no-periods"))).toBe("No periods yet.");
    await choose(el, "departmentId", "restaurant");
    expect(listed(el)[0]).toBe("Desayunos");
    expect(location.pathname).toBe("/manage/menu-timetable/department/restaurant");
  });

  it("writes a department picked by hand through the navigation guard, as a new history entry", async () => {
    history.replaceState(null, "", "/manage/before-menus");
    const guard = new NavigationGuard(window, {
      isDirty: () => false,
      request: async () => "proceeded",
    });
    onTestFinished(() => guard.dispose());
    await guard.write("/manage/menu-timetable");
    const { api } = server();
    const el = await mount(api);
    expect(field(el, "departmentId")!.value).toBe("restaurant");
    await choose(el, "departmentId", "deli");
    expect(location.pathname).toBe("/manage/menu-timetable/department/deli");
    expect(new URL(guard.href).pathname).toBe("/manage/menu-timetable/department/deli");
    expect(listed(el)).toEqual(["Deli para llevar"]);
    history.back();
    await expect.poll(() => location.pathname).toBe("/manage/menu-timetable");
    await expect.poll(() => field(el, "departmentId")!.value).toBe("restaurant");
    expect(new URL(guard.href).pathname).toBe("/manage/menu-timetable");
    history.forward();
    await expect.poll(() => field(el, "departmentId")!.value).toBe("deli");
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const { api } = server();
    const el = await mount(api);
    expect(text(el.shadowRoot!.querySelector("h1"))).toBe("Horario de cartas");
    expect(text(weekRow(el, 0).querySelector("td"))).toBe("Carta de todo el día");
  });

  it("says when the timetable cannot be read", async () => {
    const { api, state } = server();
    state.reads.push({ reject: new Error("offline") });
    const el = await mount(api);
    expect(text(byTest(el, "page-alert"))).toBe(
      "The menu timetable could not be loaded. It will be tried again.",
    );
  });

  it("shows a venue viewer the same timetable with no controls", async () => {
    const { api } = server();
    const el = await mount(api, true);
    expect(listed(el)).toHaveLength(8);
    for (const control of ["wt-button", "wt-input", "wt-row-actions", "button.cell"])
      expect(findAll(el, control), control).toEqual([]);
    expect(findAll(el, "wt-combobox").map((box) => box.getAttribute("name"))).toEqual([
      "departmentId",
    ]);
    expect(text(zoneCell(el, "barra", "mananas"))).toBe("Café");
    expect(text(zoneCell(el, "sala", "mananas"))).toContain("Desayunos");
    expect(zoneCell(el, "sala", "mananas").querySelector(".inherited")).not.toBeNull();
  });
});

describe("Menu timetable: the department's list", () => {
  it("saves a reordered list with one call to the list route", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await click(el, byTest(el, "edit-menus"));
    const rows = el.shadowRoot!.querySelectorAll<HTMLElement>('wt-modal [data-test="menu-row"]');
    await click(el, rows[1]!.querySelector('[data-test="move-up"]'));
    expect(draftList(el).slice(0, 2)).toEqual(["Almuerzo", "Desayunos"]);
    await click(el, saveButton(el));
    expect(writes()).toEqual([
      [
        "PUT",
        "/management-api/venue-service/departments/restaurant/menus",
        {
          menuIds: [
            m("Almuerzo"),
            m("Desayunos"),
            m("Cena"),
            m("Bebidas"),
            m("Café"),
            m("Cócteles"),
            m("Copas"),
            m("Brunch de Navidad"),
          ],
        },
      ],
    ]);
    expect(modal(el)).toBeNull();
  });

  it("adds a menu only from those not on the list, and removes one", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await click(el, byTest(el, "edit-menus"));
    expect(field(el, "addMenu")!.options.map((option) => option.label)).toEqual([
      "Deli para llevar",
    ]);
    await choose(el, "addMenu", m("Deli para llevar"));
    await click(el, byTest(el, "add-menu"));
    expect(draftList(el).at(-1)).toBe("Deli para llevar");
    const rows = el.shadowRoot!.querySelectorAll<HTMLElement>('wt-modal [data-test="menu-row"]');
    await click(el, rows[0]!.querySelector('[data-test="remove-menu"]'));
    await click(el, saveButton(el));
    expect((writes()[0]![2] as { menuIds: string[] }).menuIds).toEqual([
      m("Almuerzo"),
      m("Cena"),
      m("Bebidas"),
      m("Café"),
      m("Cócteles"),
      m("Copas"),
      m("Brunch de Navidad"),
      m("Deli para llevar"),
    ]);
  });

  it("says beside the list which zone still uses a removed menu, and keeps the draft", async () => {
    const { api, state } = server();
    state.writes.push(
      refusal("department_menu.in_use", {
        departmentId: "restaurant",
        menuId: m("Café"),
        uses: [{ kind: "zone_period", zoneId: "barra", periodId: "mananas" }],
      }),
    );
    const el = await mount(api);
    await click(el, byTest(el, "edit-menus"));
    const cafe = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>('wt-modal [data-test="menu-row"]'),
    ][4]!;
    await click(el, cafe.querySelector('[data-test="remove-menu"]'));
    await click(el, saveButton(el));
    const refused = byTest(el, "list-refusal")!;
    expect(text(refused)).toContain(
      "Café cannot leave the list yet: change each of these first, or add it back.",
    );
    expect(findAll(el, '[data-test="menu-use"]').map(text)).toEqual(["Barra · Mañanas"]);
    expect(draftList(el)).not.toContain("Café");
    expect(modal(el)).not.toBeNull();
    expect(await bottomMessage(el)).toBe(
      "Add that menu back, or change what still uses it, before saving.",
    );
    expect(saveButton(el).disabled).toBe(false);
  });

  it("names a past special date that still places a removed menu's period, and offers its normal week", async () => {
    const { api, state, writes } = server();
    state.writes.push(
      refusal("department_menu.in_use", {
        departmentId: "restaurant",
        menuId: m("Brunch de Navidad"),
        uses: [{ kind: "period", periodId: "brunch" }],
      }),
    );
    const el = await mount(api);
    await click(el, byTest(el, "edit-menus"));
    const rows = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>('wt-modal [data-test="menu-row"]'),
    ];
    await click(el, rows.at(-1)!.querySelector('[data-test="remove-menu"]'));
    await click(el, saveButton(el));
    expect(findAll(el, '[data-test="menu-use"]').map(text)).toEqual([
      "Brunch navideño, on Thu, 25 Dec 2025 Use normal week",
    ]);
    await click(el, byTest(el, "use-normal-week"));
    expect(text(modal(el)!.querySelector('[data-test="confirm-text"]'))).toBe(
      "Use Restaurant's normal week on Thu, 25 Dec 2025? Its own menus for that date are removed.",
    );
    await click(el, saveButton(el));
    expect(writes().at(-1)).toEqual([
      "DELETE",
      "/management-api/venue-service/special-dates/navidad/menu-timetables/restaurant",
      undefined,
    ]);
    expect(modal(el)!.getAttribute("heading")).toBe("Menus for Restaurant");
    expect(draftList(el)).not.toContain("Brunch de Navidad");
    expect(draftList(el)).toHaveLength(7);
  });

  it("goes back to the list draft when the normal week is not chosen after all", async () => {
    const { api, state } = server();
    state.writes.push(
      refusal("department_menu.in_use", {
        departmentId: "restaurant",
        menuId: m("Brunch de Navidad"),
        uses: [{ kind: "period", periodId: "brunch" }],
      }),
    );
    const el = await mount(api);
    await click(el, byTest(el, "edit-menus"));
    const rows = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>('wt-modal [data-test="menu-row"]'),
    ];
    await click(el, rows.at(-1)!.querySelector('[data-test="remove-menu"]'));
    await click(el, saveButton(el));
    await click(el, byTest(el, "use-normal-week"));
    await click(el, el.shadowRoot!.querySelector('[data-test="cancel-editor"]'));
    await expect.poll(() => modal(el)!.getAttribute("heading")).toBe("Menus for Restaurant");
    expect(draftList(el)).not.toContain("Brunch de Navidad");
  });
});

describe("Menu timetable: named periods", () => {
  it("adds a period with a name and a menu from the list, and renames one", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await click(el, byTest(el, "new-period"));
    await click(el, saveButton(el));
    expect(field(el, "name")!.error).toBe("Enter a name.");
    expect(field(el, "menuId")!.error).toBe("Choose a menu.");
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(true);
    expect(field(el, "menuId")!.options.map((option) => option.label)).not.toContain(
      "Deli para llevar",
    );
    await setField(el, "name", "Merienda");
    await choose(el, "menuId", m("Café"));
    await click(el, saveButton(el));
    await menuAction(el, row(el, "periods", "Noches"), "edit-period");
    expect(field(el, "name")!.value).toBe("Noches");
    await setField(el, "name", "Cenas");
    await click(el, saveButton(el));
    expect(writes()).toEqual([
      [
        "POST",
        "/management-api/venue-service/departments/restaurant/menu-periods",
        { name: "Merienda", menuId: m("Café") },
      ],
      [
        "PUT",
        "/management-api/venue-service/menu-periods/noches",
        { name: "Cenas", menuId: m("Cena") },
      ],
    ]);
  });

  it("puts a taken name under the name field", async () => {
    const { api, state } = server();
    state.writes.push(
      refusal("menu_period.name_taken", { departmentId: "restaurant", name: "Mañanas" }),
    );
    const el = await mount(api);
    await click(el, byTest(el, "new-period"));
    await setField(el, "name", "Mañanas");
    await choose(el, "menuId", m("Café"));
    await click(el, saveButton(el));
    expect(field(el, "name")!.error).toBe(
      "Another period of this department already has this name.",
    );
  });

  it("puts a name refused for itself, not as taken, under the name field as a value to check", async () => {
    const { api, state } = server();
    state.writes.push(refusal("menu_timetable.invalid", { field: "name" }));
    const el = await mount(api);
    await menuAction(el, row(el, "periods", "Noches"), "edit-period");
    await setField(el, "name", "Cenas");
    await click(el, saveButton(el));
    expect(field(el, "name")!.error).toBe("Check this value.");
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
  });

  it("refuses to delete a period still placed, naming its days", async () => {
    const { api, state } = server();
    state.writes.push(
      refusal("menu_period.in_use", {
        periodId: "madrugada",
        uses: [
          { kind: "week", weekday: 5 },
          { kind: "week", weekday: 6 },
          { kind: "special_date", specialDateId: "navidad", date: "2025-12-25" },
        ],
      }),
    );
    const el = await mount(api);
    await menuAction(el, row(el, "periods", "Madrugada"), "delete-period");
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe(
      "Madrugada is still placed on Friday, Saturday, Thu, 25 Dec 2025. Take it off those days first.",
    );
    expect(findAll(el, 'wt-modal [data-test="use-normal-week"]')).toHaveLength(1);
    expect(modal(el)).not.toBeNull();
  });
});

describe("Menu timetable: the week and special dates", () => {
  it("saves one day of the week with the rest unchanged, each slot naming a period", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await click(el, weekRow(el, 0).querySelector("button.cell"));
    await choose(el, "sunday.mode", "periods");
    await choose(el, "sunday.periods.0.periodId", "mediodia");
    await setField(el, "sunday.periods.0.opensAt", "13:00");
    await setField(el, "sunday.periods.0.closesAt", "17:00");
    await click(el, saveButton(el));
    const [[method, path, body]] = writes() as [[string, string, { days: unknown[] }]];
    expect([method, path]).toEqual([
      "PUT",
      "/management-api/venue-service/departments/restaurant/menu-week",
    ]);
    expect(body.days[0]).toEqual({ weekday: 0, slots: [slot("mediodia", "13:00", "17:00")] });
    expect(body.days[1]).toEqual({ weekday: 1, slots: weekday });
    expect(body.days).toHaveLength(7);
  });

  it("says a day can be changed, and draws each day as something to press", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(text(byTest(el, "week-note"))).toBe(
      "A day with no periods offers the all-day menu all day. Choose a day to change it.",
    );
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-primary-text)";
    el.parentElement!.append(probe);
    const button = weekRow(el, 1).querySelector<HTMLElement>("button.cell")!;
    expect(getComputedStyle(button).color).toBe(getComputedStyle(probe).color);
    expect(getComputedStyle(button).textDecorationLine).toBe("underline");
    probe.remove();
  });

  it("marks an overlapping slot's field and the line above the buttons, and sends nothing", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await click(el, weekRow(el, 1).querySelector("button.cell"));
    await setField(el, "monday.periods.1.opensAt", "11:00");
    await click(el, saveButton(el));
    expect(field(el, "monday.periods.1.opensAt")!.error).toBe(
      "This time overlaps another one on the same day.",
    );
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(true);
    expect(writes()).toEqual([]);
  });

  it("asks for a period on a new slot", async () => {
    const { api } = server();
    const el = await mount(api);
    await click(el, weekRow(el, 1).querySelector("button.cell"));
    await click(el, byTest(el, "add-period"));
    await setField(el, "monday.periods.3.opensAt", "17:00");
    await setField(el, "monday.periods.3.closesAt", "19:00");
    await click(el, saveButton(el));
    expect(field(el, "monday.periods.3.periodId")!.error).toBe("Choose a period.");
  });

  it("puts the server's refusal of a slot's time under that time", async () => {
    const { api, state } = server();
    state.writes.push(refusal("menu_timetable.invalid", { field: "days.1.slots.2.endsAt" }));
    const el = await mount(api);
    await click(el, weekRow(el, 1).querySelector("button.cell"));
    await click(el, saveButton(el));
    expect(field(el, "monday.periods.2.closesAt")!.error).toBe("Check this value.");
  });

  it("gives a special date its own slots, and notes a time the clock shows twice", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await menuAction(el, row(el, "menu-dates", "Sun, 25 Oct 2026"), "edit-date-menus");
    expect(field(el, "date.mode")!.value).toBe("all_day");
    await choose(el, "date.mode", "periods");
    await choose(el, "date.periods.0.periodId", "madrugada");
    await setField(el, "date.periods.0.opensAt", "01:00");
    await setField(el, "date.periods.0.closesAt", "02:30");
    expect(text(byTest(el, "repeat-note"))).toBe(
      "The clock shows 02:30 twice on this date; both follow this timetable.",
    );
    await click(el, saveButton(el));
    expect(writes()).toEqual([
      [
        "PUT",
        "/management-api/venue-service/special-dates/cambio/menu-timetables/restaurant",
        { slots: [slot("madrugada", "01:00", "02:30")] },
      ],
    ]);
  });

  it("puts a special date back on the normal week with a DELETE, from its row", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    expect(
      row(el, "menu-dates", "Mon, 12 Oct 2026").querySelector('[data-test="use-normal-week"]'),
    ).toBeNull();
    await menuAction(el, row(el, "menu-dates", "Sun, 25 Oct 2026"), "use-normal-week");
    await click(el, saveButton(el));
    expect(writes()).toEqual([
      [
        "DELETE",
        "/management-api/venue-service/special-dates/cambio/menu-timetables/restaurant",
        undefined,
      ],
    ]);
  });

  it("says why the normal week cannot go back on a date", async () => {
    const { api, state } = server();
    state.writes.push(
      refusal("menu_timetable.invalid", {
        field: "date",
        date: "2026-10-26",
        departmentId: "restaurant",
        reason: "overlap",
      }),
    );
    const el = await mount(api);
    await menuAction(el, row(el, "menu-dates", "Sun, 25 Oct 2026"), "use-normal-week");
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe(
      "The normal week would overlap the menus on Mon, 26 Oct 2026 past midnight.",
    );
  });
});

describe("Menu timetable: menus by zone", () => {
  it("offers a zone only the department's menus, blank first", async () => {
    const { api, state } = server();
    const el = await mount(api);
    const labels = () =>
      field(el, "zones.sala.periods.mananas.menuId")!.options.map((o) => o.label);
    expect(labels()).not.toContain("Deli para llevar");
    expect(labels()[0]).toBe("Desayunos (department's)");
    expect(field(el, "zones.sala.periods.mananas.menuId")!.options[0]!.value).toBe("");
    state.model.departments[0]!.menuIds.push(m("Deli para llevar"));
    api.rereadWatches();
    await settle(el);
    expect(labels()).toContain("Deli para llevar");
  });

  it("tells following the department apart from choosing the same menu, and clears a zone's choice with it", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    const options = field(el, "zones.barra.periods.mananas.menuId")!.options;
    expect(options[0]).toEqual({ value: "", label: "Desayunos (department's)" });
    expect(options.filter((option) => option.label === "Desayunos")).toEqual([
      { value: m("Desayunos"), label: "Desayunos" },
    ]);
    expect(field(el, "zones.barra.allDayMenuId")!.options[0]).toEqual({
      value: "",
      label: "Bebidas (department's)",
    });
    await choose(el, "zones.barra.periods.mananas.menuId", "");
    expect(writes()).toEqual([
      ["PUT", "/management-api/venue-service/zones/barra/period-menus/mananas", { menuId: null }],
    ]);
    setLocale("es");
    const spanish = await mount(server().api);
    expect(field(spanish, "zones.sala.periods.mananas.menuId")!.options[0]!.label).toBe(
      "Desayunos (del departamento)",
    );
  });

  it("keeps each zone choice disabled until its own save is answered", async () => {
    const { api, state } = server();
    const first = deferred();
    const second = deferred();
    state.writes.push(first.promise, second.promise);
    const el = await mount(api);
    await choose(el, "zones.sala.periods.mananas.menuId", m("Café"));
    await choose(el, "zones.sala.periods.mediodia.menuId", m("Café"));
    expect(field(el, "zones.sala.periods.mananas.menuId")!.disabled).toBe(true);
    expect(field(el, "zones.sala.periods.mediodia.menuId")!.disabled).toBe(true);
    first.resolve(undefined);
    await settle(el);
    expect(field(el, "zones.sala.periods.mananas.menuId")!.disabled).toBe(false);
    expect(field(el, "zones.sala.periods.mediodia.menuId")!.disabled).toBe(true);
    second.resolve(undefined);
    await settle(el);
    expect(field(el, "zones.sala.periods.mediodia.menuId")!.disabled).toBe(false);
  });

  it("scrolls the periods and special dates sideways at phone width, row menus in view", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(390, 844);
      const { api } = server();
      const el = await mount(api);
      for (const [name, rows] of [
        ["periods", 5],
        ["menu-dates", 3],
      ] as const) {
        const table = el.shadowRoot!.querySelector(`wt-data-table[data-test="${name}"]`)!;
        table.scrollIntoView({ block: "center" });
        expectRowMenusOnScreen(table, rows);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it("keeps the period names in view while the zones scroll sideways at phone width", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(390, 844);
      const { api } = server();
      const el = await mount(api);
      const table = el.shadowRoot!.querySelector<HTMLElement>('table[data-test="zone-menus"]')!;
      const box = table.parentElement!;
      expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
      box.scrollLeft = 300;
      await settle(el);
      expect(box.scrollLeft).toBeGreaterThan(0);
      const left = box.getBoundingClientRect().left;
      for (const header of table.querySelectorAll<HTMLElement>(
        'th[scope="row"], thead th:first-child',
      ))
        expect(Math.round(header.getBoundingClientRect().left)).toBe(Math.round(left));
      const row = table.querySelector<HTMLElement>('tbody th[scope="row"]')!;
      expect(getComputedStyle(row).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
      await page.viewport(width, height);
    }
  });

  it("saves a zone's choice as it is made, and a blank choice as following the department", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await choose(el, "zones.sala.periods.mananas.menuId", m("Café"));
    await choose(el, "zones.barra.periods.noches.menuId", "");
    await choose(el, "zones.terraza.allDayMenuId", "");
    await choose(el, "department.allDayMenuId", m("Cena"));
    await choose(el, "periods.mediodia.menuId", m("Bebidas"));
    expect(writes()).toEqual([
      [
        "PUT",
        "/management-api/venue-service/zones/sala/period-menus/mananas",
        { menuId: m("Café") },
      ],
      ["PUT", "/management-api/venue-service/zones/barra/period-menus/noches", { menuId: null }],
      ["PUT", "/management-api/venue-service/zones/terraza/all-day-menu", { menuId: null }],
      [
        "PUT",
        "/management-api/venue-service/departments/restaurant/all-day-menu",
        { menuId: m("Cena") },
      ],
      ["PUT", "/management-api/venue-service/menu-periods/mediodia", { menuId: m("Bebidas") }],
    ]);
  });

  it("sends only the menu when a period's menu is chosen in the table, so a rename saved elsewhere is not undone", async () => {
    const { api, writes } = server();
    const el = await mount(api);
    await choose(el, "periods.noches.menuId", m("Cócteles"));
    expect(writes()).toEqual([
      ["PUT", "/management-api/venue-service/menu-periods/noches", { menuId: m("Cócteles") }],
    ]);
  });

  it("puts a refusal under the zone's choice that was refused", async () => {
    const { api, state } = server();
    state.writes.push(
      refusal("department_menu.not_found", { departmentId: "restaurant", menuId: m("Café") }),
    );
    const el = await mount(api);
    await choose(el, "zones.sala.periods.mananas.menuId", m("Café"));
    expect(field(el, "zones.sala.periods.mananas.menuId")!.error).toBe(
      "This menu is no longer on the department's list.",
    );
    expect(field(el, "zones.barra.periods.mananas.menuId")!.error).toBe("");
  });
});
