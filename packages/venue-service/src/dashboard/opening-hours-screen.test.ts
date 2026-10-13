import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitElement } from "lit";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, NavigationGuard, type WtDataTable } from "@waitron/ui";
import { expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursYear } from "../opening-hours-calendar.js";
import type { SpecialDayDetail } from "../special-days.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { PeriodEditor } from "./period-editor.js";

import "./opening-hours-screen.js";

type Screen = LitElement & { api: OpeningHoursApi; readOnly: boolean };
const hosts: HTMLElement[] = [];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/opening-hours/view/periods");
});
afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
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
      { id: "lunch", name: "Lunch menu", active: true, includes: ["desserts", "drinks"] },
      { id: "desserts", name: "Desserts", active: true, includes: [] },
      { id: "drinks", name: "Drinks", active: true, includes: [] },
      { id: "staff", name: "Staff snacks", active: true, includes: [] },
    ],
    seasons: [],
    currentSeasonId: null,
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        zones: [],
        periods: [
          {
            id: "p1",
            name: "Lunch",
            colour: "green",
            menuId: "lunch",
            staffMenuIds: ["staff"],
            endOffsetMinutes: 0,
            weekdays: [1, 3],
            routingUses: [],
          },
        ],
        seasonWeeks: [],
      },
      {
        id: "deli",
        name: "Deli",
        active: false,
        zones: [],
        periods: [],
        seasonWeeks: [],
      },
    ],
  };
}

async function mount(request?: DashboardRequest, readOnly = false) {
  expect(
    customElements.get("dashboard-opening-hours-screen"),
    "Opening hours screen registered",
  ).toBeDefined();
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(
    withOpeningStations(request ?? ((async () => structuredClone(model())) as DashboardRequest)),
  );
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => el.shadowRoot?.querySelector("wt-tabs")).not.toBeNull();
  await el.updateComplete;
  return el;
}
function table(el: Screen) {
  return el.shadowRoot!.querySelector<
    WtDataTable<OpeningHoursModel["departments"][number]["periods"][number]>
  >("[data-test=periods]")!;
}

it("shows the period's colour, included menus, staff menus and placed weekdays", async () => {
  const el = await mount();
  const grid = table(el);
  expect(grid).not.toBeNull();
  await grid.updateComplete;
  expect(grid.shadowRoot!.textContent).toContain("Lunch menu · includes Desserts, Drinks");
  expect(grid.shadowRoot!.textContent).toContain("Staff snacks");
  expect(grid.shadowRoot!.textContent).toContain("Monday, Wednesday");
  expect(grid.shadowRoot!.querySelector("[part=period-colour]")?.getAttribute("data-colour")).toBe(
    "green",
  );
  expect(grid.columns.find((column) => column.key === "actions")?.pinned).toBe("end");
  const swatch = grid.shadowRoot!.querySelector<HTMLElement>("[part=period-colour]")!;
  expect(getComputedStyle(swatch).width).not.toBe("0px");
  expect(getComputedStyle(swatch).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
});

it("selects a linked inactive department and keeps view and department in the address", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/periods/department/deli");
  const el = await mount();
  const chooser =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!;
  expect(chooser.value).toBe("deli");
  await table(el).updateComplete;
  expect(table(el).shadowRoot!.textContent).toContain("No periods yet.");
  chooser.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "restaurant" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/opening-hours/view/periods/department/restaurant");
  const tabs = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;
  expect(tabs.items.map((item) => item.key)).toEqual(["year", "week", "periods"]);
  tabs.dispatchEvent(
    new CustomEvent("wt-tab-change", { detail: { value: "week" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/opening-hours/view/week/department/restaurant");
});

it("lets a venue viewer read periods without exposing create or row actions", async () => {
  const el = await mount(undefined, true);
  expect(table(el).columns.some((column) => column.key === "actions")).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=new-period]")).toBeNull();
  expect(el.shadowRoot!.querySelector("period-editor")).toBeNull();
});

it("falls back to an active department for an unknown link", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/unknown/department/missing");
  const el = await mount();
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!.value).toBe(
    "week",
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!
      .value,
  ).toBe("restaurant");
});

it("ignores another screen's department link while Opening hours is mounted", async () => {
  history.replaceState(null, "", "/manage/other-screen/view/periods/department/deli");
  const el = await mount();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!
      .value,
  ).toBe("restaurant");
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!.value).toBe(
    "week",
  );
});

async function edit(el: Screen, existing = false) {
  if (existing) {
    await table(el).updateComplete;
    const button = table(el).shadowRoot!.querySelector<HTMLElement>("[data-test=edit-period]");
    expect(button, "Edit period action").not.toBeNull();
    button!.click();
  } else el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-period]")!.click();
  await el.updateComplete;
  const editor = el.shadowRoot!.querySelector<PeriodEditor>("period-editor");
  expect(editor, "period dialog opens").not.toBeNull();
  await editor!.updateComplete;
  return editor!;
}
async function change(editor: PeriodEditor, name: string, value: string) {
  editor
    .shadowRoot!.querySelector<HTMLElement>(`[name=${name}]`)!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await editor.updateComplete;
}
function submit(editor: PeriodEditor) {
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
}
async function removePeriod(el: Screen) {
  await table(el).updateComplete;
  const button = table(el).shadowRoot!.querySelector<HTMLElement>("[data-test=delete-period]");
  expect(button, "Delete period action").not.toBeNull();
  button!.click();
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("wt-dialog");
  expect(dialog, "delete asks for confirmation").not.toBeNull();
  await dialog!.updateComplete;
  return dialog!;
}

it("creates the changed draft and closes it before refreshing the list", async () => {
  const writes: unknown[] = [];
  let reads = 0;
  const data = model();
  const el = await mount((async (path, method, body) => {
    if (method === "GET") {
      reads++;
      return structuredClone(data);
    }
    writes.push({ path, method, body });
    data.departments[0]!.periods = [
      ...data.departments[0]!.periods,
      {
        id: "p2",
        name: "Dinner",
        colour: "red",
        menuId: "lunch",
        staffMenuIds: [],
        endOffsetMinutes: 0,
        weekdays: [],
        routingUses: [],
      },
    ];
    return { id: "p2" };
  }) as DashboardRequest);
  const editor = await edit(el);
  await change(editor, "name", " Dinner ");
  await change(editor, "menuId", "lunch");
  submit(editor);
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => el.shadowRoot!.querySelector("period-editor")).toBeNull();
  await expect.poll(() => reads).toBe(2);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/departments/restaurant/menu-periods",
      method: "POST",
      body: {
        expectedClockRevision: 0,
        name: "Dinner",
        colour: "red",
        menuId: "lunch",
        staffMenuIds: [],
        endOffsetMinutes: 0,
      },
    },
  ]);
  await expect.poll(() => table(el).rows.length).toBe(2);
});

it("updates the existing period and preserves every other submitted value", async () => {
  const writes: unknown[] = [];
  const el = await mount((async (path, method, body) => {
    if (method === "GET") return model();
    writes.push({ path, method, body });
  }) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "name", "Late lunch");
  submit(editor);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/menu-periods/p1",
      method: "PATCH",
      body: {
        expectedClockRevision: 0,
        name: "Late lunch",
        colour: "green",
        menuId: "lunch",
        staffMenuIds: ["staff"],
        endOffsetMinutes: 0,
      },
    },
  ]);
  await expect.poll(() => el.shadowRoot!.querySelector("period-editor")).toBeNull();
});

it("keeps a field refusal under the name and permits retry", async () => {
  let writes = 0;
  const data = model();
  const el = await mount((async (_path, method) => {
    if (method === "GET") return structuredClone(data);
    writes++;
    throw { code: "menu_period.name_taken" };
  }) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "name", "Dinner");
  submit(editor);
  await expect
    .poll(
      () =>
        editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
    )
    .toBe("Another period of this department already has this name.");
  data.departments[0]!.periods = [
    { ...data.departments[0]!.periods[0]!, name: "New server label" },
  ];
  el.api.rereadWatches();
  await expect.poll(() => table(el).rows[0]?.name).toBe("New server label");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
  ).toBe("Another period of this department already has this name.");
  const save =
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-period]",
    )!;
  expect(save.disabled).toBe(false);
  submit(editor);
  await expect.poll(() => writes).toBe(2);
});

it("reports a failed refresh as a page load failure after the write closed the dialog", async () => {
  let reads = 0;
  const el = await mount((async (_path, method) => {
    if (method === "GET") {
      if (++reads > 1) throw new Error("offline");
      return model();
    }
  }) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "name", "Dinner");
  submit(editor);
  await expect.poll(() => el.shadowRoot!.querySelector("period-editor")).toBeNull();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")?.textContent)
    .toBe("Opening hours could not be loaded. It will be tried again.");
  expect(el.shadowRoot!.querySelector("[data-test=action-error]")).toBeNull();
});

it("does not reset an edited period when a background snapshot arrives", async () => {
  const data = model();
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "name", "My draft");
  data.departments[0]!.periods = [
    { ...data.departments[0]!.periods[0]!, name: "Someone else's edit" },
  ];
  el.api.rereadWatches();
  await expect.poll(() => table(el).rows[0]?.name).toBe("Someone else's edit");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("My draft");
});

it("requires confirmation before deletion and refreshes after it succeeds", async () => {
  const writes: unknown[] = [];
  const data = model();
  const el = await mount((async (path, method) => {
    if (method === "GET") return structuredClone(data);
    writes.push({ path, method });
    data.departments[0]!.periods = [];
  }) as DashboardRequest);
  const dialog = await removePeriod(el);
  expect(writes).toEqual([]);
  expect(dialog.textContent).toContain("Delete Lunch?");
  expect(dialog.querySelector("[data-test=routing-uses]")).toBeNull();
  expect(dialog.textContent).not.toContain("Routing");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    { path: "/management-api/venue-service/menu-periods/p1", method: "DELETE" },
  ]);
  await expect.poll(() => el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  await expect.poll(() => table(el).rows.length).toBe(0);
});

describe("deleting a period that routing names", () => {
  const uses = () => [...el().shadowRoot!.querySelectorAll("[data-test=routing-uses] li")];
  let host: Screen | undefined;
  const el = () => host!;

  it("lists each cell by row and zone, keeps the list current, and deletes on confirming", async () => {
    const writes: unknown[] = [];
    const data = model();
    data.departments[0]!.periods[0]!.routingUses = [
      { rowKind: "all", rowLabel: null, zoneName: "Terrace" },
      { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
    ];
    host = await mount((async (path, method) => {
      if (method === "GET") return structuredClone(data);
      writes.push({ path, method });
      data.departments[0]!.periods = [];
    }) as DashboardRequest);
    const dialog = await removePeriod(el());
    expect(dialog.textContent).toContain("Delete Lunch?");
    expect(dialog.querySelector("[data-test=routing-uses]")!.textContent).toContain(
      "Also removed from 2 routing cells:",
    );
    expect(uses().map((item) => item.textContent!.trim())).toEqual([
      "All categories · Terrace",
      "Cocktails · Every zone",
    ]);

    data.departments[0]!.periods[0]!.routingUses = [
      { rowKind: "product", rowLabel: "Mojito", zoneName: "Bar" },
    ];
    el().api.rereadWatches();
    await expect
      .poll(() => uses().map((item) => item.textContent!.trim()))
      .toEqual(["Mojito · Bar"]);
    expect(dialog.querySelector("[data-test=routing-uses]")!.textContent).toContain(
      "Also removed from 1 routing cell:",
    );

    el().shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await expect
      .poll(() => writes)
      .toEqual([{ path: "/management-api/venue-service/menu-periods/p1", method: "DELETE" }]);
    await expect.poll(() => el().shadowRoot!.querySelector("wt-dialog")).toBeNull();
  });

  it("says it in Spanish, naming the No category row", async () => {
    setLocale("es");
    const data = model();
    data.departments[0]!.periods[0]!.routingUses = [
      { rowKind: "no_category", rowLabel: null, zoneName: null },
      { rowKind: "all", rowLabel: null, zoneName: "Terraza" },
    ];
    host = await mount((async () => structuredClone(data)) as DashboardRequest);
    const dialog = await removePeriod(el());
    expect(dialog.querySelector("[data-test=routing-uses]")!.textContent).toContain(
      "También se quita de 2 celdas de asignación:",
    );
    expect(uses().map((item) => item.textContent!.trim())).toEqual([
      "Sin categoría · Todas las zonas",
      "Todas las categorías · Terraza",
    ]);
  });
});

it("explains an in-use deletion in one sentence and read recovery leaves it intact", async () => {
  const data = model();
  let failRead = false;
  const el = await mount((async (_path, method) => {
    if (method === "GET") {
      if (failRead) throw new Error("offline");
      return structuredClone(data);
    }
    throw {
      code: "menu_period.in_use",
      params: {
        uses: [
          { kind: "week", weekday: 1 },
          { kind: "special_day", specialDayId: "s1", name: "Navidad", date: "2026-12-25" },
        ],
      },
    };
  }) as DashboardRequest);
  await removePeriod(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=delete-error]")?.textContent)
    .toBe(
      "Lunch is still placed on Monday, Navidad (Fri, 25 Dec 2026). Take it off those days first.",
    );
  failRead = true;
  el.api.rereadWatches();
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=delete-error]")!.textContent).toContain(
    "Take it off those days first.",
  );
  failRead = false;
  data.departments[0]!.periods = [
    { ...data.departments[0]!.periods[0]!, name: "New server label" },
  ];
  el.api.rereadWatches();
  await expect.poll(() => table(el).rows[0]?.name).toBe("New server label");
  expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=delete-error]")!.textContent).toContain(
    "Take it off those days first.",
  );
});

it("ignores a departed delete confirmation after a different period is opened", async () => {
  const writes: string[] = [];
  const data = model();
  data.departments[0]!.periods = [
    ...data.departments[0]!.periods,
    { ...data.departments[0]!.periods[0]!, id: "p2", name: "Dinner" },
  ];
  const el = await mount((async (path, method) => {
    if (method === "GET") return data;
    writes.push(path);
  }) as DashboardRequest);
  const first = await removePeriod(el);
  const oldConfirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
  expect(await first.requestClose("cancel")).toBe(true);
  await expect.poll(() => el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  await el.updateComplete;
  await table(el).updateComplete;
  table(el).shadowRoot!.querySelectorAll<HTMLElement>("[data-test=delete-period]")[1]!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")!.textContent).toContain("Delete Dinner?");
  oldConfirm.click();
  await el.updateComplete;
  expect(writes).toEqual([]);
  expect(el.shadowRoot!.querySelector("wt-dialog")!.textContent).toContain("Delete Dinner?");
});

it("does not let a departed editor's close event dismiss the new editor", async () => {
  const el = await mount();
  const old = await edit(el, true);
  old.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  const current = await edit(el);
  old.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("period-editor")).toBe(current);
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
  const editor = await edit(el, true);
  await change(editor, "name", "Written lunch");
  submit(editor);
  // The native input may emit its last edit before the parent's pending state paints.
  await change(editor, "name", "Newer lunch");
  await expect.poll(() => typeof resolve).toBe("function");
  resolve();
  await expect.poll(() => editor.busy).toBe(false);
  expect(el.shadowRoot!.querySelector("period-editor")).toBe(editor);
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Newer lunch");
  await change(editor, "name", "Written lunch");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-period]")!
      .disabled,
  ).toBe(true);
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
  const editor = await edit(el, true);
  await change(editor, "name", "Dinner");
  submit(editor);
  submit(editor);
  expect(writes).toBe(1);
  resolve();
  await expect.poll(() => el.shadowRoot!.querySelector("period-editor")).toBeNull();
  const next = await edit(el, true);
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
  const editor = await edit(el, true);
  await change(editor, "name", "Dinner");
  submit(editor);
  el.remove();
  reject({ code: "menu_period.name_taken" });
  await el.updateComplete;
  expect(editor.refusal).toBeUndefined();
});

it("saves a changed period through the visible native button", async () => {
  let writes = 0;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    writes++;
  }) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "name", "Dinner");
  const button =
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-period]",
    )!;
  await button.updateComplete;
  const native = button.shadowRoot!.querySelector("button")!;
  expect(native.disabled).toBe(false);
  expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
  await userEvent.click(native);
  await expect.poll(() => writes).toBe(1);
  await expect.poll(() => el.shadowRoot!.querySelector("period-editor")).toBeNull();
});

it("keeps the row menu reachable on a phone and opens Edit with native controls", async () => {
  const initial = { width: window.innerWidth, height: window.innerHeight };
  try {
    await page.viewport(390, 844);
    const el = await mount();
    const grid = table(el);
    await grid.updateComplete;
    const menu =
      grid.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>("wt-row-actions")!;
    await menu.updateComplete;
    expectRowMenusOnScreen(grid, 1);
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    const edit = menu.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=edit-period]")!;
    await edit.updateComplete;
    await userEvent.click(edit.shadowRoot!.querySelector("button")!);
    await expect.poll(() => el.shadowRoot!.querySelector("period-editor")).not.toBeNull();
  } finally {
    await page.viewport(initial.width, initial.height);
  }
});

it("recovers a failed initial load and ignores model reads that settle after removal", async () => {
  let reads = 0;
  let resolve!: (data: OpeningHoursModel) => void;
  const el = document.createElement("dashboard-opening-hours-screen");
  el.api = new OpeningHoursApi(
    withOpeningStations((async () => {
      if (++reads === 1) throw new Error("offline");
      if (reads === 2) return model();
      return new Promise<OpeningHoursModel>((done) => {
        resolve = done;
      });
    }) as DashboardRequest),
  );
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")).not.toBeNull();
  el.api.rereadWatches();
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=periods]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  el.api.rereadWatches();
  el.remove();
  const data = model();
  data.departments = [];
  resolve(data);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-combobox")).not.toBeNull();
});

it("explains an empty venue and falls back to an inactive department when there is no active one", async () => {
  const data = model();
  data.departments = [];
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  expect(el.shadowRoot!.textContent).toContain("No departments yet.");
  expect(el.shadowRoot!.querySelector("wt-combobox")).toBeNull();
  data.departments = [
    {
      id: "deli",
      name: "Deli",
      active: false,
      zones: [],
      periods: [],
      seasonWeeks: [],
    },
  ];
  el.api.rereadWatches();
  await expect
    .poll(
      () =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")
          ?.value,
    )
    .toBe("deli");
});

it("names a missing menu by its recorded id instead of dropping a period's menu choice", async () => {
  const data = model();
  data.menus = [{ id: "lunch", name: "Lunch menu", active: true, includes: ["missing-included"] }];
  const el = await mount((async () => data) as DashboardRequest);
  await table(el).updateComplete;
  expect(table(el).shadowRoot!.textContent).toContain("Lunch menu · includes missing-included");
  expect(table(el).shadowRoot!.textContent).toContain("staff");
});

it.each([
  [{ code: "menu_period.not_found" }, "This period no longer exists."],
  [new Error("offline"), "This could not be saved. Try again."],
])("keeps a refused deletion's confirmation available for retry (%j)", async (error, message) => {
  let writes = 0;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    writes++;
    throw error;
  }) as DashboardRequest);
  await removePeriod(el);
  const confirm = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=confirm-delete]",
  )!;
  confirm.click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=delete-error]")?.textContent)
    .toBe(message);
  expect(confirm.disabled).toBe(false);
  confirm.click();
  await expect.poll(() => writes).toBe(2);
});

it("cancels deletion without writing and ignores the departed cancel control", async () => {
  let writes = 0;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    writes++;
  }) as DashboardRequest);
  await removePeriod(el);
  const cancel = el.shadowRoot!.querySelector<HTMLElement>("wt-dialog wt-button[slot=cancel]")!;
  cancel.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  await removePeriod(el);
  cancel.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")).not.toBeNull();
  expect(writes).toBe(0);
});

it("offers a visible native Cancel button in the delete confirmation", async () => {
  const el = await mount();
  const dialog = await removePeriod(el);
  expect(
    dialog.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-delete]")!.variant,
  ).toBe("danger");
  const cancel = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "wt-button[variant=secondary]",
  )!;
  await cancel.updateComplete;
  const native = cancel.shadowRoot!.querySelector("button")!;
  expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
  await userEvent.click(native);
  await expect.poll(() => el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
});

it("blocks opening a second editor from another period action and from departed page controls", async () => {
  const el = await mount();
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-period]")!;
  const editor = await edit(el, true);
  button.click();
  table(el).shadowRoot!.querySelector<HTMLElement>("[data-test=delete-period]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("period-editor")).toBe(editor);
  expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  editor.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  await removePeriod(el);
  button.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("period-editor")).toBeNull();
  el.remove();
  button.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("period-editor")).toBeNull();
});

it("does not show a late deletion refusal on a disconnected screen", async () => {
  let reject!: (error: unknown) => void;
  const el = await mount((async (_path, method) => {
    if (method === "GET") return model();
    await new Promise<void>((_done, fail) => {
      reject = fail;
    });
  }) as DashboardRequest);
  await removePeriod(el);
  const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
  confirm.click();
  el.remove();
  reject({ code: "menu_period.in_use", params: { uses: [{ kind: "week", weekday: 1 }] } });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=delete-error]")).toBeNull();
});

it.each([
  [[], "red"],
  [["red", "green"], "amber"],
  [["red", "amber", "grey", "blue", "green", "purple"], "red"],
] as const)(
  "starts a new period with the first unused colour (%j → %s)",
  async (used, expected) => {
    const data = model();
    data.departments[0]!.periods = used.map((colour, index) => ({
      ...model().departments[0]!.periods[0]!,
      id: `p${index}`,
      colour,
    }));
    const writes: unknown[] = [];
    const el = await mount((async (path, method, body) => {
      if (method === "GET") return structuredClone(data);
      writes.push({ path, method, body });
      return { id: "new" };
    }) as DashboardRequest);
    const editor = await edit(el);
    const colour =
      editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=colour]")!;
    const save =
      editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=save-period]",
      )!;
    expect(colour.value).toBe(expected);
    expect(save.variant).toBe("secondary");
    expect(save.disabled).toBe(true);
    await change(editor, "name", "Breakfast");
    await change(editor, "menuId", "lunch");
    submit(editor);
    await expect.poll(() => writes.length).toBe(1);
    expect(writes).toEqual([
      {
        path: "/management-api/venue-service/departments/restaurant/menu-periods",
        method: "POST",
        body: {
          expectedClockRevision: 0,
          name: "Breakfast",
          colour: expected,
          menuId: "lunch",
          staffMenuIds: [],
          endOffsetMinutes: 0,
        },
      },
    ]);
  },
);

it("keeps a new period's selected colour through background reads and uses fresh colours on reopening", async () => {
  const data = model();
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const editor = await edit(el);
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=colour]")!.value,
  ).toBe("red");
  await change(editor, "colour", "purple");
  data.departments[0]!.periods = [{ ...data.departments[0]!.periods[0]!, colour: "red" }];
  el.api.rereadWatches();
  await expect.poll(() => table(el).rows[0]?.colour).toBe("red");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=colour]")!.value,
  ).toBe("purple");
  editor.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  const reopened = await edit(el);
  expect(
    reopened.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=colour]")!
      .value,
  ).toBe("amber");
  expect(
    reopened.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-period]",
    )!.disabled,
  ).toBe(true);
});

it("marks the new period's missing name and menu above the buttons without submitting", async () => {
  const writes: unknown[] = [];
  const el = await mount((async (_path, method, body) => {
    if (method === "GET") return model();
    writes.push(body);
  }) as DashboardRequest);
  const editor = await edit(el);
  await change(editor, "colour", "purple");
  submit(editor);
  await editor.updateComplete;
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
  ).toBe("Enter a name.");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=menuId]")!.error,
  ).toBe("Choose a menu.");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-period]")!
      .disabled,
  ).toBe(true);
  expect(writes).toEqual([]);
});

it("places a refused period name under Name with the bottom explanation and retry enabled", async () => {
  const writes: unknown[] = [];
  const el = await mount((async (_path, method, body) => {
    if (method === "GET") return model();
    writes.push(body);
    throw { code: "menu_timetable.invalid", params: { field: "name" } };
  }) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "name", "Dinner");
  submit(editor);
  const name = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await expect.poll(() => name.error).toBe("Check this value.");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-period]")!
      .disabled,
  ).toBe(false);
  expect(name.value).toBe("Dinner");
  submit(editor);
  await expect.poll(() => writes.length).toBe(2);
  expect(writes).toEqual([
    {
      expectedClockRevision: 0,
      name: "Dinner",
      colour: "green",
      menuId: "lunch",
      staffMenuIds: ["staff"],
      endOffsetMinutes: 0,
    },
    {
      expectedClockRevision: 0,
      name: "Dinner",
      colour: "green",
      menuId: "lunch",
      staffMenuIds: ["staff"],
      endOffsetMinutes: 0,
    },
  ]);
});

it("names every weekday and special day preventing deletion in one sentence", async () => {
  const data = model();
  data.departments[0]!.periods = [{ ...data.departments[0]!.periods[0]!, name: "Madrugada" }];
  const writes: unknown[] = [];
  const el = await mount((async (path, method, body) => {
    if (method === "GET") return structuredClone(data);
    writes.push({ path, method, body });
    throw {
      code: "menu_period.in_use",
      params: {
        periodId: "p1",
        uses: [
          { kind: "week", weekday: 5 },
          { kind: "week", weekday: 6 },
          { kind: "special_day", specialDayId: "navidad", name: "Navidad", date: "2025-12-25" },
        ],
      },
    };
  }) as DashboardRequest);
  await removePeriod(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=delete-error]")?.textContent)
    .toBe(
      "Madrugada is still placed on Friday, Saturday, Navidad (Thu, 25 Dec 2025). Take it off those days first.",
    );
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/menu-periods/p1",
      method: "DELETE",
      body: undefined,
    },
  ]);
  expect(el.shadowRoot!.querySelector("wt-dialog")).not.toBeNull();
});

it("keeps department selection on Back and Forward through the shared navigation guard", async () => {
  history.replaceState(null, "", "/manage/before-hours");
  const guard = new NavigationGuard(window, {
    isDirty: () => false,
    request: async () => "proceeded",
  });
  try {
    await guard.write("/manage/opening-hours/view/periods");
    const el = await mount();
    const chooser = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!;
    expect(chooser().value).toBe("restaurant");
    chooser().dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "deli" }, bubbles: true, composed: true }),
    );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/periods/department/deli");
    expect(new URL(guard.href).pathname).toBe(location.pathname);
    expect(chooser().value).toBe("deli");
    history.back();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/periods");
    await expect.poll(() => chooser().value).toBe("restaurant");
    expect(new URL(guard.href).pathname).toBe("/manage/opening-hours/view/periods");
    history.forward();
    await expect.poll(() => chooser().value).toBe("deli");
    expect(new URL(guard.href).pathname).toBe("/manage/opening-hours/view/periods/department/deli");
  } finally {
    guard.dispose();
  }
});

it.each([
  [
    "en",
    "Lunch is still placed on Monday, Nochevieja (Tue, 31 Dec 2030). Take it off those days first.",
  ],
  [
    "es",
    "Lunch sigue colocado en Lunes, Nochevieja (mar, 31 dic 2030). Quítalo de esos días primero.",
  ],
] as const)("names a special day preventing deletion with its date (%s)", async (locale, text) => {
  setLocale(locale);
  const el = await mount((async (_path, method) => {
    if (method === "GET") return structuredClone(model());
    throw {
      code: "menu_period.in_use",
      params: {
        periodId: "p1",
        uses: [
          { kind: "week", weekday: 1 },
          {
            kind: "special_day",
            specialDayId: "nochevieja",
            name: "Nochevieja",
            date: "2030-12-31",
          },
        ],
      },
    };
  }) as DashboardRequest);
  await removePeriod(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=delete-error]")?.textContent)
    .toBe(text);
});

it("shows the Spanish Opening hours title and named-period actions", async () => {
  setLocale("es");
  const el = await mount();
  expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Horario de apertura");
  expect(el.shadowRoot!.querySelector("[data-test=new-period]")!.textContent).toBe(
    "Añadir un periodo",
  );
  await table(el).updateComplete;
  expect(table(el).shadowRoot!.textContent).toContain("Lunes, Miércoles");
});

it.each([-15, 0, 14])("shows a signed offset column for %s minutes", async (offset) => {
  const data = model();
  data.departments[0]!.periods[0]!.endOffsetMinutes = offset;
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  const grid = table(el);
  await grid.updateComplete;
  const column = grid.columns.find((column) => column.key === "endOffsetMinutes");
  expect(column).toBeDefined();
  expect(column!.label).toBe("End offset (min)");
  expect(grid.shadowRoot!.textContent).toContain(offset > 0 ? `+${offset}` : String(offset));
});

it("sends an offset-only edit through the real period client and closes before a failed refresh", async () => {
  const writes: unknown[] = [];
  let reads = 0;
  const el = await mount((async (path, method, body) => {
    if (method === "GET") {
      if (++reads > 1) throw { code: "connection.failed" };
      return structuredClone(model());
    }
    writes.push({ path, method, body });
  }) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "endOffsetMinutes", "-15");
  submit(editor);
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: "/management-api/venue-service/menu-periods/p1",
        method: "PATCH",
        body: {
          expectedClockRevision: 0,
          name: "Lunch",
          colour: "green",
          menuId: "lunch",
          staffMenuIds: ["staff"],
          endOffsetMinutes: -15,
        },
      },
    ]);
  await expect.poll(() => el.shadowRoot!.querySelector("period-editor")).toBeNull();
  await expect.poll(() => reads).toBe(2);
});

function pickerModel(): OpeningHoursModel {
  const data = model();
  data.departments[0]!.zones = [{ id: "terrace", name: "Terrace", seasonWeeks: [] }];
  return {
    ...data,
    departments: [
      ...data.departments,
      {
        id: "bar",
        name: "Bar",
        active: true,
        zones: [],
        periods: [],
        seasonWeeks: [],
      },
    ],
  };
}
const picker = (el: Screen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!;
function pick(el: Screen, value: string) {
  picker(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
it("lists All departments then active departments with their zones on Week only", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/week");
  const el = await mount((async () => structuredClone(pickerModel())) as DashboardRequest);
  expect(picker(el).options).toEqual([
    { value: "all", label: "All departments" },
    { value: "restaurant", label: "Restaurant" },
    { value: "zone:terrace", label: "Restaurant › Terrace" },
    { value: "bar", label: "Bar" },
  ]);
  const tabs = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;
  tabs.dispatchEvent(
    new CustomEvent("wt-tab-change", {
      detail: { value: "periods" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(picker(el).options).toEqual([
    { value: "restaurant", label: "Restaurant" },
    { value: "bar", label: "Bar" },
  ]);
});
it("keeps a zone through Back and Forward and clears it when choosing a department", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/week/department/restaurant");
  const guard = new NavigationGuard(window, {
    isDirty: () => false,
    request: async () => "proceeded",
  });
  try {
    const el = await mount((async () => structuredClone(pickerModel())) as DashboardRequest);
    pick(el, "zone:terrace");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/week/department/restaurant/zone/terrace");
    expect(picker(el).value).toBe("zone:terrace");
    const zoneWeek =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-zone-week"]>(
        "opening-hours-zone-week",
      );
    expect(zoneWeek?.zone.name).toBe("Terrace");
    expect(zoneWeek?.zone.id).toBe("terrace");
    expect(zoneWeek?.department.id).toBe("restaurant");
    expect(el.shadowRoot!.querySelector("opening-hours-week")).toBeNull();
    history.back();
    await expect.poll(() => picker(el).value).toBe("restaurant");
    history.forward();
    await expect.poll(() => picker(el).value).toBe("zone:terrace");
    pick(el, "bar");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/week/department/bar");
    expect(el.shadowRoot!.querySelector("[data-test=zone-placeholder]")).toBeNull();
  } finally {
    guard.dispose();
  }
});
it("links All departments headings to a department and returns to the all view", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/week/department/all");
  const el = await mount((async () => structuredClone(pickerModel())) as DashboardRequest);
  expect(picker(el).value).toBe("all");
  const all = el.shadowRoot!.querySelector<LitElement>("opening-hours-all");
  expect(all).not.toBeNull();
  await all!.updateComplete;
  const link = all!.shadowRoot!.querySelector<HTMLElement>("[data-department=bar]");
  expect(link).not.toBeNull();
  link!.click();
  await expect.poll(() => picker(el).value).toBe("bar");
  expect(location.pathname).toBe("/manage/opening-hours/view/week/department/bar");
  pick(el, "all");
  await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/week/department/all");
  expect(el.shadowRoot!.querySelector("opening-hours-week")).toBeNull();
});
it("draws the picked season's standard week for All departments", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/week/department/all/season/summer");
  const data = pickerModel();
  const monday = (startsAt: string) => [
    { weekday: 1, slots: [{ periodId: "p1", startsAt, endsAt: "14:00" }] },
  ];
  const el = await mount((async () =>
    structuredClone({
      ...data,
      seasons: [
        { id: "autumn", name: "Autumn", startsOn: "09-01" },
        { id: "summer", name: "Summer", startsOn: "06-01" },
      ],
      currentSeasonId: "autumn",
      departments: data.departments.map((department) =>
        department.id === "restaurant"
          ? {
              ...department,
              seasonWeeks: [
                { seasonId: "autumn", week: monday("10:00") },
                { seasonId: "summer", week: monday("12:00") },
              ],
            }
          : department,
      ),
    })) as DashboardRequest);
  const all = el.shadowRoot!.querySelector<LitElement>("opening-hours-all")!;
  await all.updateComplete;
  expect(
    all.shadowRoot!.querySelector("service-grid")!.columns.find((c) => c.key === "1:restaurant")!
      .slots,
  ).toEqual([{ periodId: "p1", startsAt: "12:00", endsAt: "14:00" }]);
});
it("ignores a zone belonging to another department and unknown picker values", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/week/department/bar/zone/terrace");
  const el = await mount((async () => structuredClone(pickerModel())) as DashboardRequest);
  expect(picker(el).value).toBe("bar");
  expect(el.shadowRoot!.querySelector("[data-test=zone-placeholder]")).toBeNull();
  pick(el, "zone:missing");
  await el.updateComplete;
  expect(picker(el).value).toBe("bar");
  expect(location.pathname).toBe("/manage/opening-hours/view/week/department/bar/zone/terrace");
});

it("still offers All departments when no department is available", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/week/department/all");
  const data = { ...model(), departments: [] };
  const el = await mount((async () => structuredClone(data)) as DashboardRequest);
  expect(picker(el)).not.toBeNull();
  expect(picker(el).options).toEqual([{ value: "all", label: "All departments" }]);
  expect(el.shadowRoot!.textContent).toContain("No departments");
});

function yearRead(
  year: number,
  days: OpeningHoursYear["days"] = [],
  overrides: Partial<OpeningHoursYear> = {},
): OpeningHoursYear {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-07",
    pending: null,
    year,
    timeZone: "Europe/Madrid",
    today: "2026-10-07",
    seasons: [],
    days,
    publicHolidaysAvailable: true,
    missingHolidays: [],
    holidayCoverage: [],
    area: {
      addressKey: "fixture-address",
      readiness: "ready",
      options: [],
      required: false,
      chosen: null,
    },
    ...overrides,
  };
}
const yearHeading = (el: Screen) =>
  el.shadowRoot!.querySelector("opening-hours-year")?.shadowRoot?.querySelector("[data-test=year]")
    ?.textContent;

it("restores the Year URL and writes year navigation without a department picker", async () => {
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours/view/year/year/2027?keep=yes");
  const years: string[] = [];
  const el = await mount((async (path: string) => {
    const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (asked) {
      years.push(asked[1]!);
      return yearRead(Number(asked[1]));
    }
    if (path.endsWith("/special-days")) return [];
    return model();
  }) as DashboardRequest);
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!.value).toBe(
    "year",
  );
  const year = el.shadowRoot!.querySelector("opening-hours-year");
  expect(year).not.toBeNull();
  await expect.poll(() => yearHeading(el)).toBe("2027");
  expect(el.shadowRoot!.querySelector("[name=departmentId]")).toBeNull();
  expect(years[0]).toBe("2027");
  (year!.shadowRoot!.querySelector("[data-test=next-year]") as HTMLElement).click();
  await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
  expect(location.search).toBe("?keep=yes");
  await expect.poll(() => yearHeading(el)).toBe("2028");
  expect(el.shadowRoot!.querySelector("opening-hours-year")).toBe(year);
  history.replaceState(null, "", "/manage/opening-hours/view/year/year/2025");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => yearHeading(el)).toBe("2025");
  expect(el.shadowRoot!.querySelector("opening-hours-year")).toBe(year);
  history.replaceState(null, "", "/manage/opening-hours/view/year/year/2027-13");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => yearHeading(el)).toBe("2026");
  expect(years).toEqual(["2027", "2028", "2025", "2026"]);
});

describe("Year venue year fallback", () => {
  /** At 2027-01-01T12:00Z the venue's business day is still 2026-12-31; the browser's is 2027. */
  function venueModel(readable = true, timeZone = "Pacific/Pago_Pago") {
    return {
      ...model(),
      businessDayClock: { timeZone, dayCutover: "06:00", cutoverChanges: [] },
      timeZone,
      clockReadable: readable,
    };
  }
  function yearRequest(years: string[], opening: () => OpeningHoursModel) {
    return (async (path: string) => {
      const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
      if (asked) {
        years.push(asked[1]!);
        return yearRead(Number(asked[1]));
      }
      if (path.endsWith("/special-days")) return [];
      return opening();
    }) as DashboardRequest;
  }
  it("replaces the browser's year with the venue's year when no year is chosen", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year");
    const years: string[] = [];
    const el = await mount(yearRequest(years, () => venueModel()));
    await expect.poll(() => yearHeading(el)).toBe("2026");
    expect(years).toEqual(["2026"]);
    expect(location.pathname).toBe("/manage/opening-hours/view/year");
  });
  it("uses the venue's year after an invalid-year popstate", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028");
    const el = await mount(yearRequest([], () => venueModel()));
    await expect.poll(() => yearHeading(el)).toBe("2028");
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028x");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => yearHeading(el)).toBe("2026");
  });
  it("keeps a valid explicit year across later venue-date reads", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028");
    let timeZone = "Pacific/Pago_Pago";
    const years: string[] = [];
    const el = await mount(yearRequest(years, () => venueModel(true, timeZone)));
    await expect.poll(() => yearHeading(el)).toBe("2028");
    timeZone = "Pacific/Kiritimati";
    el.api.rereadWatches();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(yearHeading(el)).toBe("2028");
    expect(new Set(years)).toEqual(new Set(["2028"]));
  });
  it("keeps an operator's year choice when the venue's first readable date arrives", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year");
    let readable = false;
    const el = await mount(yearRequest([], () => venueModel(readable)));
    await expect.poll(() => yearHeading(el)).toBe("2027");
    el.shadowRoot!.querySelector("opening-hours-year")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!
      .click();
    await expect.poll(() => yearHeading(el)).toBe("2028");
    readable = true;
    el.api.rereadWatches();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(yearHeading(el)).toBe("2028");
    expect(location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028x");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => yearHeading(el)).toBe("2026");
  });
});

describe("Year special-day actions", () => {
  const stored = {
    id: "annual/day",
    name: "Anniversary",
    repeatsYearly: true,
    dates: [
      { date: "2025-10-13", closedAllDay: false },
      { date: "2025-10-14", closedAllDay: true },
    ],
    paint: [
      {
        departmentId: "restaurant",
        date: "2025-10-13",
        ranges: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }],
      },
    ],
    zonePaint: [],
  };
  const feast = {
    id: "feast/2025",
    name: "Public feast",
    repeatsYearly: false,
    dates: [{ date: "2025-10-12", closedAllDay: true, holidayName: "Public feast" }],
    paint: [],
    zonePaint: [],
  };
  const olderFeast = {
    id: "feast/2024",
    name: "Public feast",
    repeatsYearly: false,
    dates: [{ date: "2024-10-12", closedAllDay: false }],
  };
  async function yearMount(
    options: {
      withFeast?: boolean;
      refuse?: unknown;
      readFails?: boolean;
      listFails?: boolean;
      oneOff?: boolean;
    } = {},
  ) {
    const {
      withFeast = false,
      refuse,
      readFails = false,
      listFails = false,
      oneOff = false,
    } = options;
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2026");
    const writes: unknown[][] = [];
    let reads = 0;
    let stationReads = 0;
    const el = await mount((async (path, method, body) => {
      if (method !== "GET") {
        writes.push([path, method, body]);
        if (refuse) throw refuse;
        return { id: "new" };
      }
      if (path.includes("/hours?")) stationReads++;
      if (path.endsWith("/special-days") && listFails) throw { code: "connection.failed" };
      if (path.endsWith("/special-days"))
        return withFeast
          ? [
              { ...olderFeast },
              { id: feast.id, name: feast.name, repeatsYearly: false, dates: feast.dates },
              { id: stored.id, name: stored.name, repeatsYearly: true, dates: stored.dates },
            ]
          : [{ id: stored.id, name: stored.name, repeatsYearly: true, dates: stored.dates }];
      if (path.endsWith("/special-days/annual%2Fday")) {
        if (readFails) throw { code: "connection.failed" };
        return { ...structuredClone(stored), repeatsYearly: !oneOff };
      }
      if (path.endsWith("/special-days/feast%2F2025")) return structuredClone(feast);
      if (path.endsWith("/opening-hours/year?year=2026")) {
        reads++;
        return yearRead(2026, [
          {
            date: "2026-10-13",
            seasonId: null,
            specialDay: { id: stored.id, name: stored.name },
            holidays: [],
            tone: "special_day",
            closed: false,
          },
          {
            date: "2026-10-12",
            seasonId: null,
            specialDay: null,
            holidays: [
              {
                id: "public",
                date: "2026-10-12",
                name: "Public feast",
                scope: "national",
                sourceId: "official",
              },
            ],
            tone: "public_holiday",
            closed: false,
          },
        ]);
      }
      return model();
    }) as DashboardRequest);
    const cal = el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect
      .poll(() => cal.shadowRoot!.querySelector("td[data-date='2026-10-13']"))
      .not.toBeNull();
    return { el, cal, writes, reads: () => reads, stationReads: () => stationReads };
  }
  async function action(
    cal: HTMLElementTagNameMap["opening-hours-year"],
    date: string,
    kind: string,
  ) {
    const trigger = cal.shadowRoot!.querySelector<HTMLElement>(`td[data-date='${date}'] button`);
    expect(trigger, "the year offers the date").not.toBeNull();
    trigger!.click();
    await cal.updateComplete;
    const button = cal.shadowRoot!.querySelector<HTMLElement>(`[data-test=special-${kind}]`);
    expect(button, `${kind} offered for ${date}`).not.toBeNull();
    button!.click();
  }
  async function dialog(el: Screen) {
    await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).not.toBeNull();
    const form = el.shadowRoot!.querySelector("special-day-dialog")!;
    await form.updateComplete;
    return form;
  }
  function field(form: HTMLElementTagNameMap["special-day-dialog"], name: string) {
    return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!;
  }
  async function change(
    form: HTMLElementTagNameMap["special-day-dialog"],
    name: string,
    value: string,
  ) {
    field(form, name).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await form.updateComplete;
  }
  const save = (form: HTMLElementTagNameMap["special-day-dialog"]) =>
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=save-special-day]")!.click();

  it("Edit opens the stored special day and a name change sends its dates unchanged and no paint", async () => {
    const { el, cal, writes, reads, stationReads } = await yearMount();
    await action(cal, "2026-10-13", "edit");
    const form = await dialog(el);
    expect(form.specialDay?.id).toBe("annual/day");
    expect(field(form, "name").value).toBe("Anniversary");
    await change(form, "name", "New anniversary");
    save(form);
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/annual%2Fday",
          "PUT",
          {
            expectedClockRevision: 0,
            name: "New anniversary",
            repeatsYearly: true,
            dates: stored.dates,
          },
        ],
      ]);
    await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).toBeNull();
    await expect.poll(reads).toBe(2);
    expect(stationReads()).toBe(0);
  });
  it("a public holiday opens pre-filled with its name and date and creates a special day", async () => {
    const { el, cal, writes, reads } = await yearMount();
    await action(cal, "2026-10-12", "add");
    const form = await dialog(el);
    expect(form.shadowRoot!.querySelector("[data-test=add-to]")).toBeNull();
    expect(field(form, "name").value).toBe("Public feast");
    save(form);
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days",
          "POST",
          {
            expectedClockRevision: 0,
            name: "Public feast",
            repeatsYearly: false,
            dates: [{ date: "2026-10-12", closedAllDay: false }],
          },
        ],
      ]);
    await expect.poll(reads).toBe(2);
  });
  it("Add to <name> saves the venue's latest same-named special day with the date added and nothing else changed", async () => {
    const { el, cal, writes, reads } = await yearMount({ withFeast: true });
    await action(cal, "2026-10-12", "add");
    const form = await dialog(el);
    await expect.poll(() => form.shadowRoot!.querySelector("[data-test=add-to]")).not.toBeNull();
    expect(form.shadowRoot!.querySelector("[data-test=add-to]")!.textContent).toContain(
      "Add to Public feast",
    );
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to]")!.click();
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/feast%2F2025",
          "PUT",
          {
            expectedClockRevision: 0,
            name: "Public feast",
            repeatsYearly: false,
            dates: [
              { date: "2025-10-12", closedAllDay: true },
              { date: "2026-10-12", closedAllDay: false },
            ],
          },
        ],
      ]);
    await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).toBeNull();
    await expect.poll(reads).toBe(2);
  });
  it("opens a public holiday's dialog with no offer when the special-day list cannot be read", async () => {
    const { el, cal } = await yearMount({ withFeast: true, listFails: true });
    await action(cal, "2026-10-12", "add");
    const form = await dialog(el);
    expect(form.shadowRoot!.querySelector("[data-test=add-to]")).toBeNull();
    expect(field(form, "name").value).toBe("Public feast");
    expect(el.shadowRoot!.querySelector("[data-test=special-read-error]")).toBeNull();
  });
  it("shows a refused Add to in the offer, keeping the dialog open", async () => {
    const { el, cal, writes } = await yearMount({
      withFeast: true,
      refuse: { code: "hours.clock_changed" },
    });
    await action(cal, "2026-10-12", "add");
    const form = await dialog(el);
    await expect.poll(() => form.shadowRoot!.querySelector("[data-test=add-to]")).not.toBeNull();
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to]")!.click();
    await expect.poll(() => writes.length).toBe(1);
    await expect
      .poll(() => form.shadowRoot!.querySelector("[data-error=offer]")?.textContent)
      .toBe("The change could not be saved.");
    expect(el.shadowRoot!.querySelector("special-day-dialog")).toBe(form);
  });
  it("shows the holiday-name note when a date added in the dialog is a holiday the year shows", async () => {
    const { el, cal } = await yearMount();
    await action(cal, "2026-10-11", "add");
    const form = await dialog(el);
    expect(form.shadowRoot!.querySelector("[data-test=holiday-note]")).toBeNull();
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-dates]")!.click();
    await form.updateComplete;
    await change(form, "addFrom", "2026-10-12");
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-dates-confirm]")!.click();
    await form.updateComplete;
    expect(form.shadowRoot!.querySelector("[data-test=holiday-note]")).not.toBeNull();
  });
  it("says when the special day cannot be read, and clears it on another tab", async () => {
    const { el, cal } = await yearMount({ readFails: true });
    await action(cal, "2026-10-13", "edit");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=special-read-error]")?.textContent)
      .toContain("Opening hours could not be loaded.");
    expect(el.shadowRoot!.querySelector("special-day-dialog")).toBeNull();
    el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: "periods" } }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=special-read-error]"))
      .toBeNull();
  });
  it("Make on a plain date creates a special day and refreshes the year", async () => {
    const { el, cal, writes, reads } = await yearMount();
    await action(cal, "2026-10-16", "add");
    const form = await dialog(el);
    await change(form, "name", "World cup final");
    save(form);
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days",
          "POST",
          {
            expectedClockRevision: 0,
            name: "World cup final",
            repeatsYearly: false,
            dates: [{ date: "2026-10-16", closedAllDay: false }],
          },
        ],
      ]);
    await expect.poll(reads).toBe(2);
  });
  it("Delete names the repeating special day, warns that every year goes and refreshes", async () => {
    const { el, cal, writes, reads } = await yearMount();
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .not.toBeNull();
    const confirm = el.shadowRoot!.querySelector("[data-test=delete-special-day]")!;
    expect(confirm.textContent).toContain("Anniversary");
    expect(confirm.textContent).toContain("every year");
    expect(writes).toEqual([]);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-special-delete]")!.click();
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/annual%2Fday",
          "DELETE",
          { expectedClockRevision: 0 },
        ],
      ]);
    await expect.poll(reads).toBe(2);
  });
  it("a refused Delete says so and stays open; Cancel then closes it without another write", async () => {
    const { el, cal, writes } = await yearMount({ refuse: { code: "hours.clock_changed" } });
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .not.toBeNull();
    const confirm = el.shadowRoot!.querySelector("[data-test=delete-special-day]")!;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-special-delete]")!.click();
    await expect
      .poll(() => confirm.querySelector("[role=alert]")?.textContent)
      .toBe("The change could not be saved.");
    expect(writes).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=delete-special-day]")).toBe(confirm);
    confirm.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .toBeNull();
    expect(writes).toHaveLength(1);
  });
  it("Delete names a one-off special day with no every-year warning", async () => {
    const { el, cal } = await yearMount({ oneOff: true });
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() =>
        el.shadowRoot!.querySelector("[data-test=delete-special-day] p")?.textContent?.trim(),
      )
      .toBe("Delete Anniversary?");
  });
  it("closing the Delete confirmation from the dialog itself deletes nothing", async () => {
    const { el, cal, writes } = await yearMount();
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .not.toBeNull();
    el.shadowRoot!.querySelector("[data-test=delete-special-day]")!.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .toBeNull();
    expect(writes).toEqual([]);
  });
});

it("an opened period keeps its revision through a passive replacement and submits the edited offset", async () => {
  const data = model();
  data.clockRevision = 7;
  const writes: unknown[] = [];
  const el = await mount((async (_path, method, body) => {
    if (method === "GET") return structuredClone(data);
    writes.push(body);
    throw { code: "hours.clock_changed" };
  }) as DashboardRequest);
  const editor = await edit(el, true);
  await change(editor, "endOffsetMinutes", "15");
  data.clockRevision = 8;
  data.departments[0]!.periods[0]!.name = "Refreshed Lunch";
  el.api.rereadWatches();
  await expect.poll(() => table(el).rows[0]?.name).toBe("Refreshed Lunch");
  submit(editor);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ endOffsetMinutes: 15, expectedClockRevision: 7 });
  await expect.poll(() => editor.refusal?.code).toBe("hours.clock_changed");
});
it("pre-fills the holiday's name when the sender names only the date's own holidays, as the Day view does", async () => {
  const { namedWeekModel } = await import("../testing/real-week-model.js");
  history.replaceState(null, "", "/manage/opening-hours/view/year");
  const el = await mount((async (path, method) => {
    if (method !== "GET") throw new Error(`unexpected ${method} ${path}`);
    if (path.endsWith("/special-days")) return [];
    if (path.includes("/opening-hours/year?")) return yearRead(2026);
    return structuredClone(path.includes("named-days?") ? namedWeekModel() : model());
  }) as DashboardRequest);
  const child = el.shadowRoot!.querySelector("opening-hours-year")!;
  child.dispatchEvent(
    new CustomEvent("special-day-action", {
      detail: {
        kind: "open",
        date: "2026-11-04",
        holidays: [
          {
            id: "h",
            date: "2026-11-04",
            name: "Town feast",
            scope: "local",
            sourceId: "official",
          },
        ],
        returnTo: () => child,
      },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).not.toBeNull();
  const editor = el.shadowRoot!.querySelector("special-day-dialog")!;
  await editor.updateComplete;
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Town feast");
});
it("a special-day editor opened from the Year keeps its revision through a passive replacement", async () => {
  const { namedWeekModel } = await import("../testing/real-week-model.js");
  const data = model();
  data.clockRevision = 7;
  const calendar = namedWeekModel();
  calendar.clockRevision = 7;
  const writes: unknown[] = [];
  let openingReads = 0;
  history.replaceState(null, "", "/manage/opening-hours/view/year");
  const el = await mount((async (path, method, body) => {
    if (method === "GET") {
      if (path.endsWith("/opening-hours")) openingReads++;
      if (path.endsWith("/special-days")) return [];
      if (path.includes("/opening-hours/year?"))
        return yearRead(2026, [], { clockRevision: calendar.clockRevision });
      return structuredClone(path.includes("named-days?") ? calendar : data);
    }
    writes.push(body);
    throw { code: "hours.clock_changed" };
  }) as DashboardRequest);
  const child = el.shadowRoot!.querySelector("opening-hours-year")!;
  child.dispatchEvent(
    new CustomEvent("special-day-action", {
      detail: { kind: "open", date: "2026-11-04", holidays: [], returnTo: () => child },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const editor = el.shadowRoot!.querySelector("special-day-dialog")!;
  await editor.updateComplete;
  editor.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Festival" },
      bubbles: true,
      composed: true,
    }),
  );
  await editor.updateComplete;
  data.clockRevision = 8;
  calendar.clockRevision = 8;
  data.departments[0]!.name = "Updated Restaurant";
  el.api.rereadWatches();
  await expect.poll(() => openingReads).toBe(2);
  await el.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-special-day]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    name: "Festival",
    dates: [{ date: "2026-11-04", closedAllDay: false }],
    expectedClockRevision: 7,
  });
  await expect.poll(() => editor.refusal?.code).toBe("hours.clock_changed");
});

describe("Year view", () => {
  type YearModel = OpeningHoursYear;
  function yearModel(year: number, overrides: Partial<YearModel> = {}): YearModel {
    return {
      businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
      clockRevision: 4,
      currentBusinessDay: "2026-10-12",
      pending: null,
      year,
      timeZone: "Europe/Madrid",
      today: "2026-10-12",
      seasons: [{ id: "all", name: "All year", startsOn: "01-01", lastDay: "12-31" }],
      days: [
        {
          date: `${year}-10-13`,
          seasonId: "all",
          specialDay: { id: "annual/day", name: "Anniversary" },
          holidays: [],
          tone: "special_day",
          closed: false,
        },
      ],
      publicHolidaysAvailable: true,
      missingHolidays: [],
      holidayCoverage: [],
      area: {
        addressKey: "fixture-address",
        readiness: "ready",
        options: [
          { key: "bcn", name: "Barcelona" },
          { key: "gir", name: "Girona" },
        ],
        required: false,
        chosen: "bcn",
      },
      ...overrides,
    };
  }
  async function yearMount(address: string, readOnly = false, failYear = 0) {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", address);
    const years: string[] = [];
    const writes: unknown[][] = [];
    let openingReads = 0;
    let listReads: unknown[] = [];
    let failures = failYear;
    const el = await mount(
      (async (path: string, method: string, body: unknown, options) => {
        if (method !== "GET") {
          writes.push([path, method, body]);
          return { id: "new" };
        }
        if (path.includes("/opening-hours/month?")) {
          const { monthModel } = await import("../testing/opening-hours-month-fixture.js");
          return monthModel({ month: new URL(path, location.href).searchParams.get("month")! });
        }
        const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
        if (asked) {
          years.push(asked[1]!);
          if (failures-- > 0) throw { code: "connection.failed" };
          return yearModel(Number(asked[1]));
        }
        if (path.endsWith("/special-days")) {
          listReads = [...listReads, options];
          return [
            { id: "annual/day", name: "Anniversary", repeatsYearly: true, dates: [] },
            { id: "later", name: "Later fair", repeatsYearly: true, dates: [] },
          ];
        }
        if (path.endsWith("/opening-hours")) openingReads++;
        return model();
      }) as DashboardRequest,
      readOnly,
    );
    const view = () => el.shadowRoot!.querySelector("opening-hours-year");
    return {
      el,
      view,
      years,
      writes,
      openingReads: () => openingReads,
      listReads: () => listReads,
    };
  }
  const tabs = (el: Screen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;

  it("opens on the venue's current year when the address names no view and no week parameter", async () => {
    const { el, view, years } = await yearMount("/manage/opening-hours");
    expect(tabs(el).value).toBe("year");
    expect(tabs(el).items.map((item) => item.key)).toEqual(["year", "week", "periods"]);
    expect(tabs(el).items[0]!.label).toBe("Year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(years).toEqual(["2026"]);
    expect(el.shadowRoot!.querySelector("[name=departmentId]")).toBeNull();
    expect(el.shadowRoot!.querySelector("hours-calendar")).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours");
  });

  it.each([
    ["a department", "/manage/opening-hours/department/restaurant"],
    ["a season", "/manage/opening-hours/season/winter"],
    ["a zone", "/manage/opening-hours/zone/z1"],
    ["an unknown view", "/manage/opening-hours/view/nonsense"],
  ])("keeps the Week when the address names %s", async (_, address) => {
    const { el, years } = await yearMount(address);
    expect(tabs(el).value).toBe("week");
    expect(el.shadowRoot!.querySelector("opening-hours-year")).toBeNull();
    expect(years).toEqual([]);
  });

  it("hands the year view its model, the season writes and the area writes, and every special day once a season dialog opens", async () => {
    const { el, view, years, listReads } = await yearMount(
      "/manage/opening-hours/view/year/year/2027",
    );
    await expect.poll(() => view()?.model?.year).toBe(2027);
    expect(view()!.api).toBe(el.api);
    expect(view()!.readOnly).toBe(false);
    const chips = view()!.shadowRoot!.querySelector("season-chips")!;
    expect(chips.clockRevision).toBe(4);
    el.api.rereadWithSpecialDays();
    await expect.poll(() => years).toEqual(["2027", "2027"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listReads()).toEqual([]);
    expect(view()!.specialDays).toEqual([]);
    chips.shadowRoot!.querySelector<HTMLElement>("[data-season=all]")!.click();
    await expect
      .poll(() => view()!.specialDays)
      .toEqual([
        { id: "annual/day", name: "Anniversary" },
        { id: "later", name: "Later fair" },
      ]);
    expect(listReads()).toEqual([{ passive: true }]);
  });

  async function heldMount(address: string, hold: (path: string) => boolean) {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", address);
    const held: { path: string; release: (value: unknown) => void }[] = [];
    const el = await mount((async (path: string) => {
      const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
      const answer = asked
        ? yearModel(Number(asked[1]))
        : path.endsWith("/special-days")
          ? []
          : model();
      if (!hold(path)) return answer;
      return new Promise<unknown>((release) => held.push({ path, release }));
    }) as DashboardRequest);
    const view = () => el.shadowRoot!.querySelector("opening-hours-year")!;
    return { el, view, held };
  }

  it.each(["slow", "instant"])(
    "keeps keyboard focus on › while the next year loads (%s read)",
    async (speed) => {
      const { el, view, held } = await heldMount(
        "/manage/opening-hours/view/year/year/2027",
        (path) => speed === "slow" && path.endsWith("year=2028"),
      );
      await expect.poll(() => view().model?.year).toBe(2027);
      const next = () => view().shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!;
      const focused = () => view().shadowRoot!.activeElement?.getAttribute("data-test");
      next().focus();
      expect(focused()).toBe("next-year");
      next().click();
      await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
      if (speed === "slow") {
        await expect.poll(() => held.length).toBe(1);
        await el.updateComplete;
        await view().updateComplete;
        expect(focused()).toBe("next-year");
        held[0]!.release(yearModel(2028));
      }
      await expect.poll(() => view().model?.year).toBe(2028);
      await view().updateComplete;
      expect(el.shadowRoot!.activeElement).toBe(view());
      expect(focused()).toBe("next-year");
    },
  );

  it("steps ‹ and › from the year asked for while that year is still loading", async () => {
    const { view } = await heldMount("/manage/opening-hours/view/year/year/2027", (path) =>
      /year=20(28|29)$/.test(path),
    );
    await expect.poll(() => view().model?.year).toBe(2027);
    const press = (test: string) =>
      userEvent.click(view().shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!);
    await press("next-year");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
    await press("next-year");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2029");
    expect(view().model?.year).toBe(2027);
    await press("previous-year");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
  });

  it("stops drawing the last year when the next year cannot be read", async () => {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2027");
    const el = await mount((async (path: string) => {
      const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
      if (asked?.[1] === "2028") throw { code: "connection.failed" };
      if (asked) return yearModel(Number(asked[1]));
      return path.endsWith("/special-days") ? [] : model();
    }) as DashboardRequest);
    const view = () => el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect.poll(() => view().model?.year).toBe(2027);
    view().shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=year-read-error]")?.textContent)
      .toBe("Opening hours could not be loaded. It will be tried again.");
    await el.updateComplete;
    expect(view().model).toBeUndefined();
    expect(view().shadowRoot!.querySelector("table, [data-test=year]")).toBeNull();
  });

  it("applies only the newest special-day list when an older read answers last", async () => {
    const { view, held } = await heldMount("/manage/opening-hours/view/year/year/2027", (path) =>
      path.endsWith("/special-days"),
    );
    await expect.poll(() => view().model?.year).toBe(2027);
    const chips = view().shadowRoot!.querySelector("season-chips")!;
    const open = () => chips.shadowRoot!.querySelector<HTMLElement>("[data-season=all]")!.click();
    open();
    await expect.poll(() => held.length).toBe(1);
    await chips.updateComplete;
    chips
      .shadowRoot!.querySelector("season-dialog")!
      .dispatchEvent(new CustomEvent("season-close"));
    await chips.updateComplete;
    open();
    await expect.poll(() => held.length).toBe(2);
    const list = (id: string, name: string) => [{ id, name, repeatsYearly: true, dates: [] }];
    held[1]!.release(list("new", "New fair"));
    await expect.poll(() => view().specialDays).toEqual([{ id: "new", name: "New fair" }]);
    held[0]!.release(list("old", "Old fair"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await view().updateComplete;
    expect(view().specialDays).toEqual([{ id: "new", name: "New fair" }]);
  });

  it("drops the year from the address when another tab is chosen, as a month's name does", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/year/year/2027?keep=yes");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    tabs(el).dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "periods" } }));
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/periods");
    expect(location.search).toBe("?keep=yes");
    tabs(el).dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "year" } }));
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
  });

  it("opens the Year from an old Calendar address", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/calendar");
    expect(tabs(el).value).toBe("year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
  });

  it("opens the Year from an old Calendar address that names a month", async () => {
    const { el, view, years } = await yearMount(
      "/manage/opening-hours/view/calendar/month/2027-02",
    );
    expect(tabs(el).value).toBe("year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(years).toEqual(["2026"]);
  });

  it.each(["0000", "9999"])(
    "opens the current year when the address names the out-of-range year %s",
    async (year) => {
      const { view, years } = await yearMount(`/manage/opening-hours/view/year/year/${year}`);
      await expect.poll(() => view()?.model?.year).toBe(2026);
      expect(years).toEqual(["2026"]);
    },
  );

  it("passes read-only to the year view", async () => {
    const { view } = await yearMount("/manage/opening-hours/view/year", true);
    await expect.poll(() => view()?.model).toBeDefined();
    expect(view()!.readOnly).toBe(true);
  });

  it("steps years through the address, reads each, and falls back to the current year on a bad one", async () => {
    const { view, years } = await yearMount("/manage/opening-hours/view/year/year/2027?keep=yes");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    const shown = view()!;
    shown.shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
    expect(location.search).toBe("?keep=yes");
    await expect.poll(() => view()?.model?.year).toBe(2028);
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-year]")!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/20x7");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(view()).toBe(shown);
    expect(years).toEqual(["2027", "2028", "2027", "2026"]);
  });

  it("opens that month when a month's name is chosen", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/year/year/2027");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    view()!.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=month-name]")[2]!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2027-03");
    await expect
      .poll(() => el.shadowRoot!.querySelector("opening-hours-month")?.month)
      .toBe("2027-03");
    expect(tabs(el).value).toBe("year");
  });

  it("re-reads the year and the opening hours after a season change", async () => {
    const { view, years, openingReads } = await yearMount("/manage/opening-hours/view/year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    const before = openingReads();
    view()!
      .shadowRoot!.querySelector("season-chips")!
      .dispatchEvent(new CustomEvent("season-changed", { bubbles: true, composed: true }));
    await expect.poll(() => years).toEqual(["2026", "2026"]);
    await expect.poll(openingReads).toBe(before + 1);
  });

  it("re-reads the year after the year view saves the holiday area", async () => {
    const { view, years, writes } = await yearMount("/manage/opening-hours/view/year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    await view()!.updateComplete;
    view()!
      .shadowRoot!.querySelector("[name=holidayArea]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "gir" }, bubbles: true, composed: true }),
      );
    await expect
      .poll(() => writes)
      .toEqual([["/management-api/venue-service/holiday-area", "PUT", { areaKey: "gir" }]]);
    await expect.poll(() => years).toEqual(["2026", "2026"]);
  });

  it("says when the year cannot be read, and clears it once a reread succeeds", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/year", false, 1);
    const alert = () =>
      el.shadowRoot!.querySelector("[slot=year] [data-test=year-read-error]")?.textContent;
    await expect.poll(alert).toBe("Opening hours could not be loaded. It will be tried again.");
    expect(view()!.model).toBeUndefined();
    expect(view()!.shadowRoot!.querySelector("table, [data-test=year]")).toBeNull();
    el.api.rereadWithSpecialDays();
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(alert()).toBeUndefined();
  });

  it("+ Special day opens an empty special-day dialog", async () => {
    const { el, view, writes } = await yearMount("/manage/opening-hours/view/year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=add-special-day]")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).not.toBeNull();
    const form = el.shadowRoot!.querySelector("special-day-dialog")!;
    await form.updateComplete;
    expect(form.specialDay).toBeUndefined();
    expect(form.date).toBe("");
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
    ).toBe("");
    expect(writes).toEqual([]);
  });
});

describe("Month view", () => {
  const company: SpecialDayDetail = {
    id: "company",
    name: "Company dinners",
    repeatsYearly: false,
    dates: [{ date: "2026-12-14", closedAllDay: false }],
    paint: [],
    zonePaint: [],
  };
  async function monthMount(address: string, readOnly = false) {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", address);
    const { DEPARTMENTS, monthModel } = await import("../testing/opening-hours-month-fixture.js");
    const data: OpeningHoursModel = { ...model(), departments: structuredClone(DEPARTMENTS) };
    const months: string[] = [];
    const writes: unknown[][] = [];
    let failures = 0;
    const el = await mount(
      (async (path: string, method: string, body: unknown) => {
        if (method !== "GET") {
          writes.push([path, method, body]);
          return { id: "new" };
        }
        const asked = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
        if (asked) {
          months.push(asked[1]!);
          if (failures-- > 0) throw { code: "connection.failed" };
          return monthModel({ month: asked[1]! });
        }
        if (path.endsWith("/special-days"))
          return [
            { id: "company", name: "Company dinners", repeatsYearly: false, dates: company.dates },
            { id: "xmas", name: "Christmas Day", repeatsYearly: true, dates: [] },
          ];
        if (path.endsWith("/special-days/company")) return structuredClone(company);
        if (path.includes("/opening-hours/year?")) return yearRead(2026);
        return structuredClone(data);
      }) as DashboardRequest,
      readOnly,
    );
    const view = () => el.shadowRoot!.querySelector("opening-hours-month");
    return {
      el,
      view,
      data,
      months,
      writes,
      failNext: (count: number) => (failures = count),
    };
  }
  const tabs = (el: Screen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;
  const dateButton = (view: HTMLElementTagNameMap["opening-hours-month"], date: string) =>
    view.shadowRoot!.querySelector<HTMLElement>(`td[data-date="${date}"] button`)!;
  async function shown(
    view: () => HTMLElementTagNameMap["opening-hours-month"] | null,
    month = "2026-12",
  ) {
    await expect.poll(() => view()?.model?.month).toBe(month);
    await view()!.updateComplete;
    return view()!;
  }
  async function ordinary(el: Screen, view: HTMLElementTagNameMap["opening-hours-month"]) {
    dateButton(view, "2026-12-10").click();
    await expect.poll(() => el.shadowRoot!.querySelector("ordinary-date-dialog")?.open).toBe(true);
    const dialog = el.shadowRoot!.querySelector("ordinary-date-dialog")!;
    await dialog.updateComplete;
    return dialog;
  }
  async function specialDialog(el: Screen) {
    await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).not.toBeNull();
    const form = el.shadowRoot!.querySelector("special-day-dialog")!;
    await form.updateComplete;
    return form;
  }

  it("draws the month the address names from that month's read, under the Year tab", async () => {
    const { el, view, data, months } = await monthMount(
      "/manage/opening-hours/view/month/month/2026-12",
    );
    const month = await shown(view);
    expect(months).toEqual(["2026-12"]);
    expect(month.month).toBe("2026-12");
    expect(month.departments).toEqual(data.departments);
    expect(month.departmentId).toBe("");
    expect(month.readOnly).toBe(false);
    expect(month.api).toBe(el.api);
    expect(tabs(el).value).toBe("year");
    expect(tabs(el).items.map((item) => item.key)).toEqual(["year", "week", "periods"]);
    expect(el.shadowRoot!.querySelector("[slot=year] opening-hours-month")).toBe(month);
    expect(el.shadowRoot!.querySelector("opening-hours-year")).toBeNull();
    expect(el.shadowRoot!.querySelector("[name=departmentId]")).toBeNull();
  });

  it.each([
    ["no month", "/manage/opening-hours/view/month"],
    ["a month that is not one", "/manage/opening-hours/view/month/month/2026-13"],
    ["the first year's January", "/manage/opening-hours/view/month/month/0100-01"],
  ])("opens the venue's current month when the address names %s", async (_, address) => {
    const { view, months } = await monthMount(address);
    await shown(view, "2026-10");
    expect(months).toEqual(["2026-10"]);
  });

  it("steps months through the address, goes back to the year, and writes the chosen department", async () => {
    const { view, months } = await monthMount(
      "/manage/opening-hours/view/month/month/2026-12?keep=yes",
    );
    await shown(view);
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=next-month]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2027-01");
    expect(location.search).toBe("?keep=yes");
    await shown(view, "2027-01");
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-month]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2026-12");
    await shown(view);
    view()!
      .shadowRoot!.querySelector("[name=departmentId]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "bar" }, bubbles: true, composed: true }),
      );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/department/bar/month/2026-12");
    await expect.poll(() => view()?.departmentId).toBe("bar");
    view()!
      .shadowRoot!.querySelector("[name=departmentId]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "all" }, bubbles: true, composed: true }),
      );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2026-12");
    await expect.poll(() => view()?.departmentId).toBe("");
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=year-back]")!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2026");
    await expect.poll(view).toBeNull();
    expect(months).toEqual(["2026-12", "2027-01", "2026-12"]);
  });

  it("says when the month cannot be read, and clears it once a reread succeeds", async () => {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const { el, view, failNext } = await monthMount("/manage/opening-hours/view/periods");
    failNext(1);
    tabs(el).dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "year" } }));
    history.replaceState(null, "", "/manage/opening-hours/view/month/month/2026-12");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const alert = () =>
      el.shadowRoot!.querySelector("[slot=year] [data-test=month-read-error]")?.textContent;
    await expect.poll(alert).toBe("Opening hours could not be loaded. It will be tried again.");
    expect(view()!.model).toBeUndefined();
    el.api.rereadWithSpecialDays();
    await expect.poll(() => view()?.model?.month).toBe("2026-12");
    expect(alert()).toBeUndefined();
  });

  it("an ordinary date opens its dialog with the date's season and the venue's special days", async () => {
    const { el, view } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    const dialog = await ordinary(el, await shown(view));
    expect(dialog.date).toBe("2026-12-10");
    expect(dialog.season).toEqual({ id: "winter", name: "Winter" });
    expect(dialog.tint).toBe("2");
    await expect
      .poll(() => dialog.specialDays)
      .toEqual([
        { id: "company", name: "Company dinners" },
        { id: "xmas", name: "Christmas Day" },
      ]);
    expect(dialog.returnTo!()).toBe(dateButton(view()!, "2026-12-10"));
    dialog.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await expect
      .poll(() => el.shadowRoot!.querySelector("ordinary-date-dialog")?.open ?? false)
      .toBe(false);
  });

  it("Edit the Winter week goes to the Week with that season, keeping the month's department", async () => {
    const { el, view } = await monthMount(
      "/manage/opening-hours/view/month/department/bar/month/2026-12",
    );
    const dialog = await ordinary(el, await shown(view));
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-week]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/week/department/bar/season/winter");
    await expect.poll(() => tabs(el).value).toBe("week");
    expect(el.shadowRoot!.querySelector("ordinary-date-dialog")?.open ?? false).toBe(false);
  });

  it("Make this a special day opens a new special day holding the date", async () => {
    const { el, view, writes } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    const dialog = await ordinary(el, await shown(view));
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=make-special]")!.click();
    const form = await specialDialog(el);
    expect(form.specialDay).toBeUndefined();
    expect(form.date).toBe("2026-12-10");
    expect(writes).toEqual([]);
  });

  it("Add to a special day opens that special day with the date added, written only on Save", async () => {
    const { el, view, writes } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    const dialog = await ordinary(el, await shown(view));
    await expect.poll(() => dialog.specialDays.length).toBe(2);
    dialog.shadowRoot!.querySelector("[name=specialDayId]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "company" },
        bubbles: true,
        composed: true,
      }),
    );
    await dialog.updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to-special]")!.click();
    const form = await specialDialog(el);
    expect(form.specialDay?.id).toBe("company");
    const dates = () =>
      [...form.shadowRoot!.querySelectorAll<HTMLElement>("[data-date]")].map(
        (row) => row.dataset.date,
      );
    expect(dates()).toEqual(["2026-12-10", "2026-12-14"]);
    const save = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-special-day]",
    )!;
    expect(save.disabled).toBe(false);
    expect(writes).toEqual([]);
    save.click();
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/company",
          "PUT",
          {
            expectedClockRevision: 0,
            name: "Company dinners",
            repeatsYearly: false,
            dates: [
              { date: "2026-12-10", closedAllDay: false },
              { date: "2026-12-14", closedAllDay: false },
            ],
          },
        ],
      ]);
    await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).toBeNull();
  });

  it("a special date opens its special day, whose Edit hours on this date opens the per-date editor", async () => {
    const { el, view } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    dateButton(await shown(view), "2026-12-14").click();
    const form = await specialDialog(el);
    expect(form.specialDay?.id).toBe("company");
    expect(form.offerEditDate).toBe(true);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-date-hours]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/date/date/2026-12-14");
    await expect.poll(() => el.shadowRoot!.querySelector("special-day-dialog")).toBeNull();
    const day = el.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-day"]>(
      "[slot=year] opening-hours-day",
    )!;
    expect(day.date).toBe("2026-12-14");
    expect(view()).toBeNull();
    expect(tabs(el).value).toBe("year");
  });

  it("offers no Edit hours on this date from the per-date editor itself", async () => {
    const { el } = await monthMount("/manage/opening-hours/view/date/date/2026-12-14");
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-day")).not.toBeNull();
    const day = el.shadowRoot!.querySelector("opening-hours-day")!;
    day.dispatchEvent(
      new CustomEvent("special-day-action", {
        detail: {
          kind: "open",
          date: "2026-12-14",
          specialDay: { id: "company", name: "Company dinners" },
          holidays: [],
          returnTo: () => day,
        },
        bubbles: true,
        composed: true,
      }),
    );
    const form = await specialDialog(el);
    expect(form.specialDay?.id).toBe("company");
    expect(form.offerEditDate).toBe(false);
    expect(form.shadowRoot!.querySelector("[data-test=edit-date-hours]")).toBeNull();
  });

  it("shows the month when the date view names no valid date", async () => {
    const { el, view } = await monthMount("/manage/opening-hours/view/date/date/2026-02-30");
    await shown(view, "2026-10");
    expect(el.shadowRoot!.querySelector("opening-hours-day")).toBeNull();
  });

  it("passes read-only to the month and opens nothing from it", async () => {
    const { el, view } = await monthMount("/manage/opening-hours/view/month/month/2026-12", true);
    const month = await shown(view);
    expect(month.readOnly).toBe(true);
    month.dispatchEvent(
      new CustomEvent("ordinary-date-open", {
        detail: { date: "2026-12-10", seasonId: "winter", returnTo: () => null },
        bubbles: true,
        composed: true,
      }),
    );
    month.dispatchEvent(
      new CustomEvent("special-day-action", {
        detail: {
          kind: "open",
          date: "2026-12-14",
          specialDay: company,
          holidays: [],
          returnTo: () => null,
        },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("ordinary-date-dialog")?.open ?? false).toBe(false);
    expect(el.shadowRoot!.querySelector("special-day-dialog")).toBeNull();
  });
});

describe("no Day tab and no real week", () => {
  it("offers no Real week switch, ignores a week in the address and passes the Week no week start", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/week?week=2026-10-12");
    const el = await mount();
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-week")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[name=realWeek]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=previous-week]")).toBeNull();
    expect(el.shadowRoot!.querySelector("opening-hours-week")!.weekStart).toBe("");
    expect(location.search).toBe("?week=2026-10-12");
  });

  it("opens the Year when the address names only a week", async () => {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12");
    const el = await mount((async (path: string) =>
      path.includes("/opening-hours/year?")
        ? yearRead(2026)
        : structuredClone(model())) as DashboardRequest);
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
  });

  it("treats the retired Day view as an unknown view", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/day/date/2026-12-25");
    const el = await mount();
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-week")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("opening-hours-day")).toBeNull();
    expect(
      el
        .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!
        .items.map((item) => item.key),
    ).toEqual(["year", "week", "periods"]);
  });
});
