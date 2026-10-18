import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, type WtDataTable } from "@waitron/ui";
import type { FloorPlanSetsModel } from "../floor-plan-set-types.js";
import { casaMarina } from "./floor-plans-fixture.js";
import { VenueServiceApi } from "./client.js";
import type { FloorPlansScreen } from "./floor-plans-screen.js";
import "./floor-plans-screen.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const FLOOR_PLAN_SETS = "/management-api/venue-service/floor-plan-sets";
type Write = { path: string; method: string; body: unknown };
async function mountScreen(
  options: {
    readOnly?: boolean;
    model?: FloorPlanSetsModel;
    /** Answers a write; a throw is the request's refusal. */
    write?: (write: Write) => unknown;
    /** Answers a read other than the page's own; a throw is the read's failure. */
    read?: (path: string) => unknown;
    /** Answers each of the page's own reads, in place of `model`. */
    page?: () => FloorPlanSetsModel;
  } = {},
): Promise<{
  screen: FloorPlansScreen;
  table: WtDataTable<unknown>;
  paths: string[];
  writes: Write[];
}> {
  const paths: string[] = [];
  const writes: Write[] = [];
  const request = (async (path: string, method: string, body: unknown, init?: unknown) => {
    if (method !== "GET") {
      writes.push({ path, method, body });
      return options.write?.({ path, method, body });
    }
    paths.push(`${path} ${JSON.stringify(init ?? {})}`);
    if (options.read && path !== FLOOR_PLAN_SETS) return options.read(path);
    return options.page?.() ?? options.model ?? casaMarina();
  }) as DashboardRequest;
  const screen = document.createElement("dashboard-floor-plans-screen") as FloorPlansScreen;
  screen.api = new VenueServiceApi(request);
  screen.readOnly = options.readOnly ?? false;
  applyTokens(screen);
  document.body.append(screen);
  hosts.push(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
  const table = screen.shadowRoot!.querySelector("wt-data-table") as WtDataTable<unknown>;
  await table.updateComplete;
  return { screen, table, paths, writes };
}

function cell(table: WtDataTable<unknown>, rowKey: string, column: string) {
  const row = table.shadowRoot!.querySelector(`tr[data-row-key="${rowKey}"]`);
  expect(row, `${rowKey} is shown`).not.toBeNull();
  const index = table.columns.findIndex(({ key }) => key === column);
  expect(index, `column ${column}`).toBeGreaterThanOrEqual(0);
  return row!.querySelectorAll("td")[index]!;
}
const text = (element: Element) => element.textContent!.replace(/\s+/g, " ").trim();

it("lists each department's sets, the periods using each and each zone's counts", async () => {
  const { table, paths } = await mountScreen();
  expect(paths).toEqual(['/management-api/venue-service/floor-plan-sets {"passive":true}']);
  expect(
    [...table.shadowRoot!.querySelectorAll("tbody tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key"),
    ),
  ).toEqual([
    "department:restaurant",
    "set:standard",
    "zone:standard:inside",
    "zone:standard:terrace",
    "set:dinner",
    "zone:dinner:inside",
    "zone:dinner:terrace",
    "set:private",
    "zone:private:inside",
    "zone:private:terrace",
    "department:bar",
    "set:bar-standard",
    "zone:bar-standard:bar-zone",
    "department:deli",
  ]);
  expect(text(cell(table, "department:restaurant", "name"))).toBe("Restaurant");
  expect(text(cell(table, "set:standard", "name"))).toBe("Standard Default");
  expect(text(cell(table, "set:standard", "usedBy"))).toBe("Lunch");
  expect(cell(table, "set:standard", "usedBy").querySelector("[data-colour=blue]")).not.toBeNull();
  expect(text(cell(table, "zone:standard:inside", "tables"))).toBe("12 on the plan");
  expect(text(cell(table, "zone:standard:terrace", "tables"))).toBe("10 on the plan · 6 spare");
  expect(text(cell(table, "set:dinner", "name"))).toBe("Dinner");
  expect(text(cell(table, "set:dinner", "usedBy"))).toBe("Dinner");
  expect(text(cell(table, "zone:dinner:inside", "tables"))).toBe("11 on the plan");
  expect(text(cell(table, "zone:dinner:terrace", "tables"))).toBe("8 on the plan · 8 spare");
  expect(text(cell(table, "set:private", "usedBy"))).toBe("Not used");
  expect(text(cell(table, "zone:private:inside", "tables"))).toBe("4 on the plan · 7 spare");
  expect(text(cell(table, "zone:private:terrace", "tables"))).toBe(
    "No tables on the plan · 16 spare",
  );
  expect(text(cell(table, "zone:bar-standard:bar-zone", "tables"))).toBe("No tables yet");
  expect(text(cell(table, "department:deli", "name"))).toBe("Deli No sets yet");
});

it("says a layout places no table when the zone has tables but none counts as spare", async () => {
  const model = casaMarina();
  model.departments[1]!.zones[0]!.tableCount = 2;
  const { table } = await mountScreen({ model });
  const counts = cell(table, "zone:bar-standard:bar-zone", "tables");
  expect(text(counts)).toBe("No tables on the plan");
  expect(counts.querySelector("[part~=empty]")).not.toBeNull();
  expect(cell(table, "zone:standard:inside", "tables").querySelector("[part~=empty]")).toBeNull();
});

it("draws department and set rows flush left, and indents only the zone links", async () => {
  const { table } = await mountScreen();
  const contentLeft = (td: HTMLElement) =>
    td.getBoundingClientRect().left + parseFloat(getComputedStyle(td).paddingInlineStart);
  const department = cell(table, "department:restaurant", "name");
  const set = cell(table, "set:standard", "name");
  const zone = cell(table, "zone:standard:inside", "name");
  const setName = set.querySelector("[part~=set-name]")!.getBoundingClientRect().left;
  expect(setName).toBeCloseTo(contentLeft(set), 0);
  expect(contentLeft(department)).toBeCloseTo(contentLeft(set), 0);
  expect(zone.querySelector("a")!.getBoundingClientRect().left).toBeGreaterThan(setName);
});

it("links each zone row to its set's layout in the editor, and back to this page", async () => {
  const { table } = await mountScreen();
  const link = cell(table, "zone:dinner:terrace", "name").querySelector("a")!;
  expect(text(link)).toBe("Terrace");
  expect(link.getAttribute("href")).toBe(
    "/manage/floor-plan/set/dinner/zone/terrace?back=%2Fmanage%2Ffloor-plans",
  );
  expect(link.getAttribute("aria-label")).toBe("Terrace · Dinner");
  expect(cell(table, "zone:standard:inside", "name").querySelector("a")!.getAttribute("href")).toBe(
    "/manage/floor-plan/set/standard/zone/inside?back=%2Fmanage%2Ffloor-plans",
  );
});

it("gives a set row a pinned menu, and a zone or department row none", async () => {
  const { screen, table } = await mountScreen();
  expect(screen.shadowRoot!.querySelector("[data-test=add-set]")!.textContent!.trim()).toBe(
    "+ Add set",
  );
  const actions = table.columns.find(({ key }) => key === "actions")!;
  expect(actions.pinned).toBe("end");
  for (const key of ["set:standard", "set:dinner", "set:private", "set:bar-standard"])
    expect(cell(table, key, "actions").querySelector("wt-row-actions"), key).not.toBeNull();
  expect(
    cell(table, "set:dinner", "actions").querySelector("wt-row-actions")!.getAttribute("label"),
  ).toBe("Dinner: Actions");
  for (const key of ["department:restaurant", "zone:standard:inside", "zone:dinner:terrace"])
    expect(cell(table, key, "actions").querySelector("wt-row-actions"), key).toBeNull();
});

it("shows a venue.view reader the list with no Add set and no row menus", async () => {
  const { screen, table } = await mountScreen({ readOnly: true });
  expect(screen.shadowRoot!.querySelector("[data-test=add-set]")).toBeNull();
  expect(table.columns.some(({ key }) => key === "actions")).toBe(false);
  expect(table.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
  expect(text(cell(table, "zone:dinner:terrace", "tables"))).toBe("8 on the plan · 8 spare");
  expect(cell(table, "zone:dinner:terrace", "name").querySelector("a")).not.toBeNull();
});

it("says so when there is no department", async () => {
  const screen = document.createElement("dashboard-floor-plans-screen") as FloorPlansScreen;
  screen.api = new VenueServiceApi((async () => ({ departments: [] })) as DashboardRequest);
  document.body.append(screen);
  hosts.push(screen);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=no-departments]")?.textContent)
    .toBe("No departments yet. Add one in Departments and zones.");
});

it("says the read failed, and clears it when the next timed read succeeds", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let fail = true;
    const screen = document.createElement("dashboard-floor-plans-screen") as FloorPlansScreen;
    screen.api = new VenueServiceApi((async () => {
      if (fail) throw new Error("offline");
      return casaMarina();
    }) as DashboardRequest);
    document.body.append(screen);
    hosts.push(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]")?.textContent)
      .toBe("Floor plans could not be loaded. It will be tried again.");
    fail = false;
    await vi.advanceTimersByTimeAsync(60_000);
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("speaks Spanish", async () => {
  setLocale("es");
  const { screen, table } = await mountScreen();
  expect(screen.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe("Planos de sala");
  expect(screen.shadowRoot!.querySelector("[data-test=add-set]")!.textContent!.trim()).toBe(
    "+ Añadir conjunto",
  );
  expect(table.columns.find(({ key }) => key === "usedBy")!.label).toBe("Usado por");
  expect(text(cell(table, "set:standard", "name"))).toBe("Standard Predeterminado");
  expect(text(cell(table, "set:private", "usedBy"))).toBe("Sin usar");
  expect(text(cell(table, "zone:standard:inside", "tables"))).toBe("12 en el plano");
  expect(text(cell(table, "zone:standard:terrace", "tables"))).toBe(
    "10 en el plano · 6 de reserva",
  );
  expect(text(cell(table, "zone:private:terrace", "tables"))).toBe(
    "Ninguna mesa en el plano · 16 de reserva",
  );
  expect(text(cell(table, "zone:bar-standard:bar-zone", "tables"))).toBe("Aún no hay mesas");
  expect(text(cell(table, "department:deli", "name"))).toBe("Deli Aún no hay conjuntos");
  expect(
    cell(table, "set:dinner", "actions").querySelector("wt-row-actions")!.getAttribute("label"),
  ).toBe("Dinner: Acciones");
});

it("tells a screen reader each zone sits under its set, and each set under its department", async () => {
  const { table } = await mountScreen();
  const level = (key: string) =>
    table.shadowRoot!.querySelector(`tr[data-row-key="${key}"]`)!.getAttribute("aria-level");
  expect(level("department:restaurant")).toBe("1");
  expect(level("set:dinner")).toBe("2");
  expect(level("zone:dinner:terrace")).toBe("3");
  expect(level("department:deli")).toBe("1");
  expect(table.shadowRoot!.querySelector(".tree-toggle, .expand-all")).toBeNull();
});

const menuItems = (table: WtDataTable<unknown>, setKey: string) => [
  ...cell(table, setKey, "actions").querySelectorAll<HTMLElementTagNameMap["wt-button"]>(
    "wt-row-actions wt-button",
  ),
];
const dialogOf = (screen: FloorPlansScreen) =>
  screen.shadowRoot!.querySelector("dashboard-floor-plan-set-dialog");
async function fill(screen: FloorPlansScreen, name: string, value: string) {
  const dialog = dialogOf(screen)!;
  dialog
    .shadowRoot!.querySelector(`[name=${name}]`)!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await dialog.updateComplete;
}
async function saveDialog(screen: FloorPlansScreen) {
  dialogOf(screen)!.shadowRoot!.querySelector<HTMLElement>("[data-test=save-set]")!.click();
}

it("offers Rename… and Copy… on each set row", async () => {
  const { table } = await mountScreen();
  expect(menuItems(table, "set:standard").map((item) => text(item))).toEqual(["Rename…", "Copy…"]);
  expect(menuItems(table, "set:dinner").map((item) => text(item))).toEqual([
    "Rename…",
    "Copy…",
    "Make default",
    "Delete…",
  ]);
});

it("+ Add set for a department with no set sends no fromSetId, then reads the page again", async () => {
  const { screen, paths, writes } = await mountScreen({ write: () => ({ setId: "new" }) });
  expect(dialogOf(screen)).toBeNull();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-set]")!.click();
  await screen.updateComplete;
  expect(dialogOf(screen)!.mode).toBe("add");
  await fill(screen, "departmentId", "deli");
  expect(dialogOf(screen)!.shadowRoot!.querySelector("[name=fromSetId]")).toBeNull();
  await fill(screen, "name", "Standard");
  await saveDialog(screen);
  await expect.poll(() => dialogOf(screen)).toBeNull();
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/floor-plan-sets",
      method: "POST",
      body: { departmentId: "deli", name: "Standard" },
    },
  ]);
  await expect.poll(() => paths.length).toBe(2);
});

it("+ Add set for Restaurant starts from its default set", async () => {
  const { screen, writes } = await mountScreen({ write: () => ({ setId: "new" }) });
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-set]")!.click();
  await screen.updateComplete;
  await fill(screen, "departmentId", "restaurant");
  const from =
    dialogOf(screen)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=fromSetId]",
    )!;
  expect(from.value).toBe("standard");
  await fill(screen, "name", "Brunch");
  await saveDialog(screen);
  await expect.poll(() => dialogOf(screen)).toBeNull();
  expect(writes.map(({ body }) => body)).toEqual([
    { departmentId: "restaurant", name: "Brunch", fromSetId: "standard" },
  ]);
});

it("Rename… and Copy… send the set's routes", async () => {
  const { screen, table, writes } = await mountScreen({ write: () => ({ setId: "new" }) });
  menuItems(table, "set:dinner")[0]!.click();
  await screen.updateComplete;
  expect(dialogOf(screen)!.mode).toBe("rename");
  await fill(screen, "name", "Evening");
  await saveDialog(screen);
  await expect.poll(() => dialogOf(screen)).toBeNull();
  menuItems(table, "set:dinner")[1]!.click();
  await screen.updateComplete;
  expect(dialogOf(screen)!.mode).toBe("copy");
  await fill(screen, "name", "Party");
  await saveDialog(screen);
  await expect.poll(() => dialogOf(screen)).toBeNull();
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/floor-plan-sets/dinner",
      method: "PATCH",
      body: { name: "Evening" },
    },
    {
      path: "/management-api/venue-service/floor-plan-sets/dinner/copy",
      method: "POST",
      body: { name: "Party" },
    },
  ]);
});

it("keeps the dialog open and marks Name when the name is taken", async () => {
  const { screen, table } = await mountScreen({
    write: () => {
      throw Object.assign(new Error("taken"), {
        code: "floor_plan_set.name_taken",
        params: { departmentId: "restaurant", name: "Standard" },
      });
    },
  });
  menuItems(table, "set:dinner")[1]!.click();
  await screen.updateComplete;
  await fill(screen, "name", "Standard");
  await saveDialog(screen);
  const dialog = dialogOf(screen)!;
  await expect
    .poll(
      () =>
        dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
    )
    .toBe("Another set of this department already has this name.");
  expect(dialog.busy).toBe(false);
});

it("offers Make default and Delete… on a set that is not the default, and neither on the default", async () => {
  const { table } = await mountScreen();
  expect(menuItems(table, "set:standard").map((item) => text(item))).toEqual(["Rename…", "Copy…"]);
  expect(menuItems(table, "set:dinner").map((item) => text(item))).toEqual([
    "Rename…",
    "Copy…",
    "Make default",
    "Delete…",
  ]);
  expect(menuItems(table, "set:bar-standard").map((item) => text(item))).toEqual([
    "Rename…",
    "Copy…",
  ]);
});

it("Make default sends one request and the list follows its live read", async () => {
  let model = casaMarina();
  const { table, writes, paths } = await mountScreen({
    write: () => {
      model = casaMarina();
      const sets = model.departments[0]!.sets;
      sets[0]!.isDefault = false;
      sets[1]!.isDefault = true;
      return undefined;
    },
    page: () => model,
  });
  menuItems(table, "set:dinner")
    .find((item) => text(item) === "Make default")!
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    { path: `${FLOOR_PLAN_SETS}/dinner/make-default`, method: "POST", body: undefined },
  ]);
  await expect.poll(() => paths.length).toBe(2);
  await expect.poll(() => text(cell(table, "set:dinner", "name"))).toBe("Dinner Default");
  expect(text(cell(table, "set:standard", "name"))).toBe("Standard");
});

it("says so when Make default is refused", async () => {
  const { screen, table } = await mountScreen({
    write: () => {
      throw Object.assign(new Error("gone"), { code: "floor_plan_set.not_found", params: {} });
    },
  });
  menuItems(table, "set:dinner")
    .find((item) => text(item) === "Make default")!
    .click();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=action-error]")?.textContent)
    .toBe("This set no longer exists.");
});

const deleteDialogOf = (screen: FloorPlansScreen) =>
  screen.shadowRoot!.querySelector("dashboard-floor-plan-set-delete-dialog");
const dinnerImpact = {
  periods: [{ id: "dinner-period", name: "Dinner" }],
  zonesShowing: [{ id: "inside", name: "Inside" }],
};

it("Delete… reads the impact, offers the default, and deletes with the choice", async () => {
  const { screen, table, writes, paths } = await mountScreen({
    read: () => dinnerImpact,
    write: () => undefined,
  });
  menuItems(table, "set:dinner")
    .find((item) => text(item) === "Delete…")!
    .click();
  await screen.updateComplete;
  const dialog = deleteDialogOf(screen)!;
  expect(dialog.set).toEqual({ id: "dinner", name: "Dinner" });
  await expect.poll(() => dialog.impact).toEqual(dinnerImpact);
  expect(paths).toContain(`${FLOOR_PLAN_SETS}/dinner/delete-impact {}`);
  await dialog.updateComplete;
  const body = [...dialog.shadowRoot!.querySelectorAll("[data-test=body] p")].map((p) => text(p));
  expect(body).toEqual([
    "Used by Dinner.",
    "The tables stay: every set shares them.",
    "On the floor, Inside keep today's layout until someone presses Update layout.",
  ]);
  const field =
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=replaceWith]")!;
  expect(field.options).toEqual([
    { value: "", label: "Standard (default)", muted: true },
    { value: "private", label: "Private party" },
  ]);
  const button = dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
  expect(text(button)).toBe("Delete Dinner");
  button.click();
  await expect.poll(() => deleteDialogOf(screen)).toBeNull();
  expect(writes).toEqual([
    { path: `${FLOOR_PLAN_SETS}/dinner/delete`, method: "POST", body: { replaceWith: null } },
  ]);
  await expect
    .poll(() => paths.filter((path) => path.startsWith(`${FLOOR_PLAN_SETS} `)))
    .toHaveLength(2);
});

it("Delete… says when the impact cannot be read, and reads it again on Try again", async () => {
  let fail = true;
  const { screen, table } = await mountScreen({
    read: () => {
      if (fail) throw new Error("offline");
      return dinnerImpact;
    },
  });
  menuItems(table, "set:dinner")
    .find((item) => text(item) === "Delete…")!
    .click();
  await screen.updateComplete;
  const dialog = deleteDialogOf(screen)!;
  await expect.poll(() => dialog.readError).toBe("What deleting it changes could not be read.");
  fail = false;
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-delete]")!.click();
  await expect.poll(() => dialog.impact).toEqual(dinnerImpact);
  expect(dialog.readError).toBe("");
});

it("keeps the delete dialog open with the refusal when the delete is refused", async () => {
  const { screen, table } = await mountScreen({
    read: () => dinnerImpact,
    write: () => {
      throw Object.assign(new Error("default"), { code: "floor_plan_set.is_default", params: {} });
    },
  });
  menuItems(table, "set:dinner")
    .find((item) => text(item) === "Delete…")!
    .click();
  await screen.updateComplete;
  const dialog = deleteDialogOf(screen)!;
  await expect.poll(() => dialog.impact).toEqual(dinnerImpact);
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect.poll(() => dialog.refusal?.code).toBe("floor_plan_set.is_default");
  expect(deleteDialogOf(screen)).toBe(dialog);
  expect(dialog.busy).toBe(false);
});

it("speaks Spanish in the set menu", async () => {
  setLocale("es");
  const { table } = await mountScreen();
  expect(menuItems(table, "set:dinner").map((item) => text(item))).toEqual([
    "Renombrar…",
    "Copiar…",
    "Hacer predeterminado",
    "Eliminar…",
  ]);
});
