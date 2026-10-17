import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, type WtDataTable, type WtModal } from "@waitron/ui";
import { CALENDAR_COLOURS } from "../hours-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi, type PaintedInRow } from "./opening-hours-client.js";
import type { PeriodDialog } from "./period-dialog.js";
import type { PeriodRow, PeriodsList } from "./periods-list.js";
import { seasonTints } from "./season-tint.js";

import "@waitron/ui/src/components/wt-modal.js";
import "./periods-list.js";

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
      { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" },
      { id: "summer", name: "Summer", startsOn: "06-01", colour: "amber" },
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
  const el = document.createElement("periods-list") as PeriodsList;
  el.api = new OpeningHoursApi(request);
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
function table(el: PeriodsList) {
  return el.shadowRoot!.querySelector<WtDataTable<PeriodRow>>("wt-data-table");
}
async function loaded(el: PeriodsList) {
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

it("shows each period's colour, customer menu and staff-only menus, and no Floor plan column", async () => {
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
  expect(grid.columns.map((c) => c.key)).toEqual([
    "period",
    "customerMenu",
    "staffMenus",
    "paintedIn",
    "actions",
  ]);
  expect(grid.shadowRoot!.querySelector("[part=unavailable]")).toBeNull();
});

it("paints every period colour's swatch and every season tint's chip", async () => {
  const data = model();
  data.seasons = Array.from({ length: 8 }, (_, index) => ({
    id: `s${index}`,
    name: `Season ${index}`,
    startsOn: `${String(index + 1).padStart(2, "0")}-01`,
    colour: CALENDAR_COLOURS[index]!,
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

it("an unused period shows its colour and a plain name, and says Not painted anywhere; a period the painted-in read does not list yet shows nothing in Painted in", async () => {
  const el = await mount(
    answering(() => {
      const m = model();
      m.departments[0]!.periods[1]!.colour = "green";
      return m;
    }),
  );
  const grid = await loaded(el);
  await expect
    .poll(() => cell(grid, "period:p2", "paintedIn")?.textContent)
    .toContain("Not painted anywhere");
  expect(cell(grid, "period:p2", "paintedIn")!.querySelector("[part=not-painted]")).not.toBeNull();
  const swatch = (id: string) =>
    cell(grid, id, "period")!.querySelector<HTMLElement>("[part~=swatch]")!;
  const name = (id: string) =>
    cell(grid, id, "period")!.querySelector<HTMLElement>("[part~=name]")!;
  expect(getComputedStyle(swatch("period:p2")).backgroundColor).toBe(
    getComputedStyle(swatch("period:p1")).backgroundColor,
  );
  expect(getComputedStyle(swatch("period:p1")).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(name("period:p2")).color).toBe(getComputedStyle(name("period:p1")).color);
  expect(cell(grid, "period:p3", "paintedIn")!.textContent!.trim()).toBe("");
  expect(getComputedStyle(name("period:p3")).color).toBe(getComputedStyle(name("period:p1")).color);
});

it("shows nothing in Painted in while the painted-in read has not answered", async () => {
  let answer!: (rows: PaintedInRow[]) => void;
  const pending = new Promise<PaintedInRow[]>((done) => {
    answer = done;
  });
  const el = await mount(answering(model, () => pending));
  const grid = await loaded(el);
  expect(cell(grid, "period:p2", "paintedIn")!.textContent!.trim()).toBe("");
  const swatch = (id: string) =>
    cell(grid, id, "period")!.querySelector<HTMLElement>("[part~=swatch]")!;
  const name = (id: string) =>
    cell(grid, id, "period")!.querySelector<HTMLElement>("[part~=name]")!;
  expect(getComputedStyle(swatch("period:p2")).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  const unanswered = getComputedStyle(name("period:p2")).color;
  expect(unanswered).toBe(getComputedStyle(name("period:p1")).color);
  answer(paintedIn());
  await expect
    .poll(() => cell(grid, "period:p2", "paintedIn")?.textContent)
    .toContain("Not painted anywhere");
  expect(getComputedStyle(name("period:p2")).color).toBe(unanswered);
  expect(getComputedStyle(name("period:p1")).color).toBe(unanswered);
});

it.each(["en", "es"])("heading and + Add period share the top row (%s)", async (locale) => {
  setLocale(locale);
  const el = await mount();
  await loaded(el);
  const heading = el.shadowRoot!.querySelector("h2")!;
  expect(heading.textContent).toBe(locale === "en" ? "Periods" : "Periodos");
  expect(el.shadowRoot!.querySelector("h1")).toBeNull();
  const h = heading.getBoundingClientRect();
  const add = el.shadowRoot!.querySelector("[data-test=add-period]")!.getBoundingClientRect();
  const middle = (h.top + h.bottom) / 2;
  expect(add.top).toBeLessThanOrEqual(middle);
  expect(add.bottom).toBeGreaterThanOrEqual(middle);
  expect(add.left).toBeGreaterThan(h.right);
});

const dialogOf = (el: PeriodsList) => el.shadowRoot!.querySelector<PeriodDialog>("period-dialog");

it("a period row opens its dialog; a department row opens nothing; the pinned actions column holds a bin per period", async () => {
  const read = answering();
  const el = await mount((async (path: string, ...rest: unknown[]) =>
    path.endsWith("/delete-impact")
      ? new Promise(() => {})
      : (read as (...args: unknown[]) => unknown)(path, ...rest)) as DashboardRequest);
  const grid = await loaded(el);
  for (const row of grid.rows)
    expect(grid.rowActivation!(row), `${row.kind}:${row.id}`).toBe(
      row.kind === "period" ? "click" : "none",
    );
  const activator = (key: string) =>
    grid.shadowRoot!.querySelector<HTMLButtonElement>(
      `tr[data-row-key="${key}"] button.row-activate`,
    );
  expect(activator("period:p1")!.getAttribute("aria-label")).toBe("Edit Lunch");
  expect(activator("department:restaurant")).toBeNull();
  expect(activator("department:bar")).toBeNull();
  await userEvent.click(cell(grid, "period:p1", "customerMenu")!, { force: true });
  await expect.poll(() => dialogOf(el)?.period?.id).toBe("p1");
  dialogOf(el)!.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await expect.poll(() => dialogOf(el)).toBeNull();

  expect(grid.columns.find((c) => c.key === "actions")?.pinned).toBe("end");
  for (const key of ["department:restaurant", "department:bar"])
    expect(cell(grid, key, "actions")!.querySelector("[data-test=delete-period]"), key).toBeNull();
  expect(grid.shadowRoot!.querySelectorAll("[data-test=delete-period]")).toHaveLength(3);
  for (const [key, name] of [
    ["period:p1", "Lunch"],
    ["period:p2", "Christmas set menu"],
    ["period:p3", "All day"],
  ]) {
    const bins = cell(grid, key!, "actions")!.querySelectorAll("[data-test=delete-period]");
    expect(bins, key).toHaveLength(1);
    expect(bins[0]!.getAttribute("aria-label")).toBe(`Delete ${name}`);
    expect(bins[0]!.querySelector("wt-icon[name=bin]"), key).not.toBeNull();
  }
  expect(grid.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
  const bin = cell(grid, "period:p1", "actions")!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=delete-period]",
  )!;
  await userEvent.click(bin.shadowRoot!.querySelector("button")!);
  await expect
    .poll(() => el.shadowRoot!.querySelector("period-delete-dialog")?.period?.id)
    .toBe("p1");
  expect(dialogOf(el)).toBeNull();
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Periods");
  expect(el.shadowRoot!.querySelector("[data-test=add-period]")!.textContent!.trim()).toBe(
    "+ Add period",
  );
});

it("a Painted in chip in a clickable row follows its link and opens no period dialog", async () => {
  const el = await mount();
  const grid = await loaded(el);
  await expect.poll(() => grid.shadowRoot!.querySelectorAll("a[part~=chip]").length).toBe(3);
  const chip = cell(grid, "period:p1", "paintedIn")!.querySelector<HTMLAnchorElement>(
    "a[part~=chip]",
  )!;
  const clicks: { target: EventTarget | undefined; defaultPrevented: boolean }[] = [];
  const record = (event: Event) => {
    clicks.push({ target: event.composedPath()[0], defaultPrevented: event.defaultPrevented });
    event.preventDefault();
  };
  window.addEventListener("click", record);
  try {
    await userEvent.click(chip);
    expect(clicks).toEqual([{ target: chip, defaultPrevented: false }]);
    await el.updateComplete;
    expect(dialogOf(el)).toBeNull();
    await userEvent.click(cell(grid, "period:p1", "customerMenu")!, { force: true });
    await expect.poll(() => dialogOf(el)?.period?.id).toBe("p1");
  } finally {
    window.removeEventListener("click", record);
  }
});

it("a venue viewer sees the list and its links but no Add and no actions column", async () => {
  const el = await mount(answering(), true);
  const grid = await loaded(el);
  expect(grid.columns.some((c) => c.key === "actions")).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=add-period]")).toBeNull();
  expect(keys(grid)).toHaveLength(5);
  await expect.poll(() => grid.shadowRoot!.querySelectorAll("a[part~=chip]").length).toBe(3);
  expect(grid.shadowRoot!.querySelectorAll("button.row-activate")).toHaveLength(0);
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
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Periodos");
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
      expect.stringContaining("Pintado en"),
    ]),
  );
  expect(headers).not.toEqual(expect.arrayContaining([expect.stringContaining("Plano de sala")]));
  await expect.poll(() => grid.shadowRoot!.textContent).toContain("Sin pintar en ningún sitio");
  expect(
    cell(grid, "period:p1", "actions")!
      .querySelector("[data-test=delete-period]")!
      .getAttribute("aria-label"),
  ).toBe("Eliminar Lunch");
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
        { id: "spring", name: "Primavera", startsOn: "03-01", colour: "green" },
        { id: "summer", name: "Verano", startsOn: "06-01", colour: "amber" },
        { id: "autumn", name: "Otoño", startsOn: "09-01", colour: "orange" },
        { id: "winter", name: "Invierno", startsOn: "12-01", colour: "blue" },
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
      // The Periods window: an unsized, so wide, modal.
      const frame = document.createElement("wt-modal") as WtModal;
      frame.open = true;
      applyTokens(frame);
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
