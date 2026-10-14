import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, type WtDataTable } from "@waitron/ui";
import { CALENDAR_COLOURS } from "../hours-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi, type PaintedInRow } from "./opening-hours-client.js";
import type { PeriodRow, PeriodsScreen } from "./periods-screen.js";
import { seasonTints } from "./season-tint.js";

import "./periods-screen.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

type Period = OpeningHoursModel["departments"][number]["periods"][number];
const period = (id: string, name: string, overrides: Partial<Period> = {}): Period => ({
  id,
  name,
  colour: "green",
  menuId: "lunch",
  staffMenuIds: [],
  endOffsetMinutes: 0,
  weekdays: [],
  routingUses: [],
  ...overrides,
});

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
      { id: "lunch", name: "Lunch menu", active: true, includes: ["Desserts"] },
      { id: "desserts", name: "Desserts", active: true, includes: [] },
      { id: "staff", name: "Staff snacks", active: true, includes: [] },
      { id: "wine", name: "Wine list", active: true, includes: [] },
      { id: "bar", name: "Bar menu", active: true, includes: [] },
    ],
    seasons: [
      { id: "winter", name: "Winter", startsOn: "12-01" },
      { id: "summer", name: "Summer", startsOn: "06-01" },
    ],
    currentSeasonId: "winter",
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        zones: [],
        periods: [
          period("p1", "Lunch", { staffMenuIds: ["staff", "wine"] }),
          period("p2", "Christmas set menu", { colour: "red" }),
        ],
        seasonWeeks: [],
      },
      {
        id: "deli",
        name: "Deli",
        active: false,
        zones: [],
        periods: [period("p4", "Deli lunch")],
        seasonWeeks: [],
      },
      {
        id: "bar",
        name: "Bar",
        active: true,
        zones: [],
        periods: [period("p3", "All day", { colour: "purple", menuId: "bar" })],
        seasonWeeks: [],
      },
    ],
  };
}
function paintedIn(): PaintedInRow[] {
  return [
    {
      periodId: "p1",
      seasons: [
        { id: "summer", name: "Summer" },
        { id: "winter", name: "Winter" },
      ],
      specialDays: [{ id: "sd1", name: "Company dinners" }],
    },
    { periodId: "p2", seasons: [], specialDays: [] },
  ];
}

function answering(
  read: () => OpeningHoursModel | Promise<OpeningHoursModel> = model,
  painted: () => PaintedInRow[] | Promise<PaintedInRow[]> = paintedIn,
): DashboardRequest {
  return (async (path: string) =>
    path.endsWith("/menu-periods/painted-in")
      ? structuredClone(await painted())
      : structuredClone(await read())) as DashboardRequest;
}

async function mount(request: DashboardRequest = answering(), readOnly = false) {
  const el = document.createElement("dashboard-periods-screen") as PeriodsScreen;
  el.api = new OpeningHoursApi(request);
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
function table(el: PeriodsScreen) {
  return el.shadowRoot!.querySelector<WtDataTable<PeriodRow>>("wt-data-table");
}
async function loaded(el: PeriodsScreen) {
  await expect.poll(() => table(el)).not.toBeNull();
  const grid = table(el)!;
  await grid.updateComplete;
  return grid;
}
function cell(grid: WtDataTable<PeriodRow>, rowId: string, column: string) {
  const row = grid.shadowRoot!.querySelector(`tr[data-row-key="${rowId}"]`);
  const index = grid.columns.findIndex((c) => c.key === column);
  return row?.querySelectorAll("td")[index] ?? null;
}
const keys = (grid: WtDataTable<PeriodRow>) => grid.rows.map((row) => `${row.kind}:${row.id}`);

it("groups each active department's periods under it in one table, and leaves out inactive ones", async () => {
  const grid = await loaded(await mount());
  expect(keys(grid)).toEqual([
    "department:restaurant",
    "period:p1",
    "period:p2",
    "department:bar",
    "period:p3",
  ]);
  expect(grid.rowParent!(grid.rows[1]!)).toBe("department:restaurant");
  expect(grid.rowParent!(grid.rows[0]!)).toBeNull();
  expect(grid.rowCollapsible!(grid.rows[0]!)).toBe(false);
});

it("M3: department rows are group headings, bold on a shaded band across every cell, and an empty department says No periods", async () => {
  const data = model();
  data.departments = [
    ...data.departments,
    { id: "kiosk", name: "Terrace kiosk", active: true, zones: [], periods: [], seasonWeeks: [] },
  ];
  const el = await mount(answering(() => data));
  const grid = await loaded(el);
  const cells = (key: string) => [
    ...grid.shadowRoot!.querySelectorAll<HTMLElement>(`tr[data-row-key="${key}"] td`),
  ];
  for (const key of ["department:restaurant", "department:bar", "department:kiosk"])
    for (const td of cells(key)) expect(td.part.contains("department-cell"), key).toBe(true);
  for (const td of cells("period:p1")) expect(td.getAttribute("part")).toBeNull();
  const band = getComputedStyle(cells("department:bar")[0]!).backgroundColor;
  expect(band).not.toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(cells("department:bar").at(-1)!).backgroundColor).toBe(band);
  expect(getComputedStyle(cells("period:p3")[0]!).backgroundColor).not.toBe(band);
  expect(Number(getComputedStyle(cells("department:bar")[0]!).fontWeight)).toBeGreaterThanOrEqual(
    600,
  );
  expect(cell(grid, "department:kiosk", "period")!.textContent).toContain("No periods");
  expect(cell(grid, "department:bar", "period")!.textContent).not.toContain("No periods");
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  await grid.updateComplete;
  expect(cell(grid, "department:kiosk", "period")!.textContent).toContain("Sin periodos");
});

it("shows each period's colour, customer menu, staff-only menus and a greyed floor plan", async () => {
  const el = await mount();
  const grid = await loaded(el);
  const text = grid.shadowRoot!.textContent!;
  expect(text).toContain("Lunch menu");
  expect(text).not.toContain("includes");
  expect(text).toContain("Staff snacks, Wine list");
  const swatch = grid.shadowRoot!.querySelector<HTMLElement>("[part~=swatch][data-colour=green]");
  expect(swatch).not.toBeNull();
  expect(getComputedStyle(swatch!).width).not.toBe("0px");
  expect(getComputedStyle(swatch!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  const floor = grid.shadowRoot!.querySelector<HTMLElement>("[part=unavailable]")!;
  expect(floor.textContent).toBe("—");
  expect(getComputedStyle(floor).color).not.toBe(getComputedStyle(grid).color);
});

it("paints every period colour's swatch and every season tint's chip", async () => {
  const data = model();
  data.seasons = Array.from({ length: 8 }, (_, index) => ({
    id: `s${index}`,
    name: `Season ${index}`,
    startsOn: `${String(index + 1).padStart(2, "0")}-01`,
  }));
  data.departments = [
    {
      ...data.departments[0]!,
      periods: CALENDAR_COLOURS.map((colour) => period(`p-${colour}`, colour, { colour })),
    },
  ];
  const painted = [
    {
      periodId: "p-red",
      seasons: data.seasons.map(({ id, name }) => ({ id, name })),
      specialDays: [],
    },
  ];
  const el = await mount(
    answering(
      () => data,
      () => painted,
    ),
  );
  const grid = await loaded(el);
  const transparent = "rgba(0, 0, 0, 0)";
  for (const colour of CALENDAR_COLOURS) {
    const swatch = grid.shadowRoot!.querySelector(`[part~=swatch][data-colour=${colour}]`)!;
    expect(getComputedStyle(swatch).backgroundColor, colour).not.toBe(transparent);
  }
  await expect.poll(() => grid.shadowRoot!.querySelectorAll("a[part~=chip]").length).toBe(8);
  const tints = new Set(seasonTints(data.seasons).values());
  expect(tints.size).toBeGreaterThan(1);
  for (const tint of tints) {
    const chip = grid.shadowRoot!.querySelector(`a[part~=tint-${tint}]`);
    expect(chip, `tint ${tint}`).not.toBeNull();
    expect(getComputedStyle(chip!).backgroundColor, `tint ${tint}`).not.toBe(transparent);
  }
});

it("Painted in lists the seasons in order, then the special days, each linking to its editor", async () => {
  const el = await mount();
  const grid = await loaded(el);
  await expect.poll(() => grid.shadowRoot!.querySelectorAll("a[part~=chip]").length).toBe(3);
  const chips = [...grid.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a[part~=chip]")];
  expect(chips.map((chip) => chip.textContent!.trim())).toEqual([
    "Summer",
    "Winter",
    "Company dinners",
  ]);
  expect(chips.map((chip) => chip.getAttribute("href"))).toEqual([
    "/manage/opening-hours/view/season/season/summer/department/restaurant",
    "/manage/opening-hours/view/season/season/winter/department/restaurant",
    "/manage/opening-hours/view/special-day/special-day/sd1",
  ]);
  const winter = chips[1]!;
  expect(getComputedStyle(winter).backgroundColor).not.toBe(
    getComputedStyle(chips[0]!).backgroundColor,
  );
});

it("a period painted nowhere says Not painted anywhere and is drawn unpainted; a period the painted-in read does not list yet shows nothing in Painted in", async () => {
  const el = await mount();
  const grid = await loaded(el);
  await expect
    .poll(() => cell(grid, "period:p2", "paintedIn")?.textContent)
    .toContain("Not painted anywhere");
  expect(cell(grid, "period:p2", "paintedIn")!.querySelector("[part=not-painted]")).not.toBeNull();
  expect(cell(grid, "period:p2", "period")!.querySelector("[part~=unpainted]")).not.toBeNull();
  expect(cell(grid, "period:p1", "period")!.querySelector("[part~=unpainted]")).toBeNull();
  expect(cell(grid, "period:p3", "paintedIn")!.textContent!.trim()).toBe("");
  expect(cell(grid, "period:p3", "period")!.querySelector("[part~=unpainted]")).toBeNull();
});

it("shows nothing in Painted in while the painted-in read has not answered", async () => {
  const el = await mount(answering(model, () => new Promise<PaintedInRow[]>(() => {})));
  const grid = await loaded(el);
  expect(cell(grid, "period:p2", "paintedIn")!.textContent!.trim()).toBe("");
  expect(cell(grid, "period:p2", "period")!.querySelector("[part~=unpainted]")).toBeNull();
});

it("the row menu column is keyed actions and pinned to the end, holding Edit, Open in Opening hours and Delete", async () => {
  const el = await mount();
  const grid = await loaded(el);
  expect(grid.columns.find((c) => c.key === "actions")?.pinned).toBe("end");
  expect(
    cell(grid, "department:restaurant", "actions")!.querySelector("wt-row-actions"),
  ).toBeNull();
  const menu = cell(grid, "period:p1", "actions")!.querySelector("wt-row-actions")!;
  expect(menu.getAttribute("label")).toBe("Actions: Lunch");
  expect(menu.querySelector("[data-test=edit-period]")!.textContent!.trim()).toBe("Edit");
  const open = menu.querySelector<HTMLAnchorElement>("a[data-test=open-hours]")!;
  expect(open.textContent!.trim()).toBe("Open in Opening hours");
  expect(open.getAttribute("href")).toBe("/manage/opening-hours/view/season/department/restaurant");
  expect(menu.querySelector("[data-test=delete-period]")!.textContent!.trim()).toBe("Delete");
  const bar = cell(grid, "period:p3", "actions")!.querySelector("a[data-test=open-hours]")!;
  expect(bar.getAttribute("href")).toBe("/manage/opening-hours/view/season/department/bar");
  expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Periods");
  expect(el.shadowRoot!.querySelector("[data-test=add-period]")!.textContent!.trim()).toBe(
    "+ Add period",
  );
});

it("a venue viewer sees the list and its links but no Add and no actions column", async () => {
  const el = await mount(answering(), true);
  const grid = await loaded(el);
  expect(grid.columns.some((c) => c.key === "actions")).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=add-period]")).toBeNull();
  expect(keys(grid)).toHaveLength(5);
  await expect.poll(() => grid.shadowRoot!.querySelectorAll("a[part~=chip]").length).toBe(3);
});

it("names a missing menu by its recorded id", async () => {
  const data = model();
  data.menus = [{ id: "lunch", name: "Lunch menu", active: true, includes: [] }];
  const el = await mount(answering(() => data));
  const grid = await loaded(el);
  expect(cell(grid, "period:p3", "customerMenu")!.textContent!.trim()).toBe("bar");
  expect(cell(grid, "period:p1", "staffMenus")!.textContent!.trim()).toBe("staff, wine");
  expect(cell(grid, "period:p2", "staffMenus")!.textContent!.trim()).toBe("—");
});

it("recovers a failed first read and ignores reads that answer after removal", async () => {
  let reads = 0;
  let resolve!: (data: OpeningHoursModel) => void;
  const el = await mount(
    answering(() => {
      if (++reads === 1) throw new Error("offline");
      if (reads === 2) return model();
      return new Promise<OpeningHoursModel>((done) => {
        resolve = done;
      });
    }),
  );
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=read-error]")!.textContent).toBe(
    "Periods could not be loaded. It will be tried again.",
  );
  el.api.rereadWatches();
  const grid = await loaded(el);
  expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  el.api.rereadWatches();
  el.remove();
  const data = model();
  data.departments = [];
  resolve(data);
  await new Promise((done) => setTimeout(done, 0));
  await el.updateComplete;
  expect(table(el)).toBe(grid);
  expect(keys(grid)).toHaveLength(5);
});

it("says when where periods are painted cannot be read, and clears it on a good read", async () => {
  let reads = 0;
  const el = await mount(
    answering(model, () => {
      if (++reads === 1) throw new Error("offline");
      return paintedIn();
    }),
  );
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=painted-in-error]")?.textContent)
    .toBe("Where periods are painted could not be loaded. It will be tried again.");
  expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  el.api.rereadWatches();
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=painted-in-error]")).toBeNull();
  const grid = await loaded(el);
  await expect.poll(() => grid.shadowRoot!.querySelectorAll("a[part~=chip]").length).toBe(3);
});

it("explains a venue with no departments", async () => {
  const data = model();
  data.departments = [];
  const el = await mount(answering(() => data));
  await expect
    .poll(() => el.shadowRoot!.textContent)
    .toContain("No departments yet. Add one in Departments and zones.");
  expect(table(el)).toBeNull();
});

it("Spanish: Periodos, Carta de clientes, Pintado en, Sin pintar en ningún sitio", async () => {
  setLocale("es");
  const el = await mount();
  const grid = await loaded(el);
  expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Periodos");
  expect(el.shadowRoot!.querySelector("[data-test=add-period]")!.textContent!.trim()).toBe(
    "+ Añadir periodo",
  );
  const headers = [...grid.shadowRoot!.querySelectorAll("thead th")].map((th) =>
    th.textContent!.trim(),
  );
  expect(headers).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Periodo"),
      expect.stringContaining("Carta de clientes"),
      expect.stringContaining("Cartas solo para el personal"),
      expect.stringContaining("Plano de sala"),
      expect.stringContaining("Pintado en"),
    ]),
  );
  await expect.poll(() => grid.shadowRoot!.textContent).toContain("Sin pintar en ningún sitio");
  expect(
    cell(grid, "period:p1", "actions")!
      .querySelector("a[data-test=open-hours]")!
      .textContent!.trim(),
  ).toBe("Abrir en Horario de apertura");
});

// Verdana is about as wide as CI's Linux system font.
it.each(
  ["en", "es"].flatMap((locale) => ["", 'Verdana, "DejaVu Sans"'].map((font) => [locale, font])),
)(
  "M1: at 1280 the table fits its frame with five long Painted in chips (%s, font %j)",
  async (locale, font) => {
    const previous = [window.innerWidth, window.innerHeight];
    await page.viewport(1280, 900);
    setLocale(locale);
    try {
      // The LOOK's demo venue: its names, menus and four seasons, plus a special day.
      const data = model();
      data.menus = [
        { id: "casa", name: "Casa Delgado", active: true, includes: [] },
        { id: "deli", name: "Deli takeaway", active: true, includes: [] },
      ];
      data.seasons = [
        { id: "spring", name: "Primavera", startsOn: "03-01" },
        { id: "summer", name: "Verano", startsOn: "06-01" },
        { id: "autumn", name: "Otoño", startsOn: "09-01" },
        { id: "winter", name: "Invierno", startsOn: "12-01" },
      ];
      data.departments = [
        {
          ...data.departments[0]!,
          name: "Restaurant and bar",
          periods: [
            period("p1", "Open", { menuId: "casa", staffMenuIds: ["deli"] }),
            period("p2", "Breakfast", { menuId: "casa", staffMenuIds: ["deli"] }),
          ],
        },
      ];
      const painted = [
        {
          periodId: "p1",
          seasons: data.seasons.map(({ id, name }) => ({ id, name })),
          specialDays: [{ id: "sd1", name: "Nochevieja" }],
        },
        { periodId: "p2", seasons: [], specialDays: [] },
      ];
      const frame = document.createElement("div");
      // The table's frame on the dashboard at 1280 px, measured in the A506-11 LOOK.
      frame.style.inlineSize = "898px";
      document.body.append(frame);
      hosts.push(frame);
      const el = await mount(
        answering(
          () => data,
          () => painted,
        ),
      );
      if (font) {
        const family = getComputedStyle(el).getPropertyValue("--wt-font-family");
        expect(family).not.toBe("");
        el.style.setProperty("--wt-font-family", `${font}, ${family}`);
      }
      frame.append(el);
      const grid = await loaded(el);
      await expect.poll(() => grid.shadowRoot!.querySelectorAll("a[part~=chip]").length).toBe(5);
      await grid.updateComplete;
      const scroll = grid.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
      expect(scroll.clientWidth).toBeGreaterThan(800);
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
      for (const cell of grid.shadowRoot!.querySelectorAll<HTMLElement>("th, td"))
        expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth + 1);
      for (const chip of grid.shadowRoot!.querySelectorAll<HTMLElement>("a[part~=chip]"))
        expect(getComputedStyle(chip).whiteSpace).toBe("nowrap");
    } finally {
      await page.viewport(previous[0]!, previous[1]!);
    }
  },
);
