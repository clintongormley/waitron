import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { casaMarina } from "./floor-plans-fixture.js";
import type { FloorPlanSetDialog, FloorPlanSetSave } from "./floor-plan-set-dialog.js";
import "./floor-plan-set-dialog.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

async function mount(setup: (el: FloorPlanSetDialog) => void) {
  const el = document.createElement("dashboard-floor-plan-set-dialog");
  el.departments = casaMarina().departments;
  setup(el);
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  const saves: FloorPlanSetSave[] = [];
  el.addEventListener("floor-plan-set-save", (event) =>
    saves.push((event as CustomEvent<FloorPlanSetSave>).detail),
  );
  return { el, saves };
}
type Field = HTMLElement &
  Pick<HTMLElementTagNameMap["wt-combobox"], "value" | "required" | "error" | "options" | "label">;
const field = (el: FloorPlanSetDialog, name: string) =>
  el.shadowRoot!.querySelector<Field>(`[name="${name}"]`);
async function change(el: FloorPlanSetDialog, name: string, value: string) {
  field(el, name)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const save = (el: FloorPlanSetDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-set]")!;
const heading = (el: FloorPlanSetDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!.heading;
const bottom = (el: FloorPlanSetDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error;

it("Add set asks Department and Name, both required, and Save waits for a change", async () => {
  const { el } = await mount((el) => (el.mode = "add"));
  expect(heading(el)).toBe("Add set");
  expect(field(el, "departmentId")!.label).toBe("Department");
  expect(field(el, "departmentId")!.required).toBe(true);
  expect(field(el, "departmentId")!.options.map(({ label }) => label)).toEqual([
    "Restaurant",
    "Bar",
    "Deli",
  ]);
  expect(field(el, "name")!.label).toBe("Name");
  expect(field(el, "name")!.required).toBe(true);
  expect(field(el, "fromSetId")).toBeNull();
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  await change(el, "name", "Terrace");
  expect(save(el).disabled).toBe(false);
  expect(save(el).variant).toBe("primary");
});

it("Save with a field missing explains it beside the field and at the bottom", async () => {
  const { el, saves } = await mount((el) => (el.mode = "add"));
  await change(el, "name", "Brunch");
  save(el).click();
  await el.updateComplete;
  expect(saves).toEqual([]);
  expect(field(el, "departmentId")!.error).toBe("Choose a department.");
  expect(field(el, "name")!.error).toBe("");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(true);
  await change(el, "departmentId", "deli");
  expect(field(el, "departmentId")!.error).toBe("");
  expect(bottom(el)).toBe("");
  expect(save(el).disabled).toBe(false);
  await change(el, "name", " ");
  expect(field(el, "name")!.error).toBe("Enter a name.");
});

it("a department's first set asks no Start from and sends no fromSetId", async () => {
  const { el, saves } = await mount((el) => (el.mode = "add"));
  await change(el, "departmentId", "deli");
  expect(field(el, "fromSetId")).toBeNull();
  await change(el, "name", "  Standard ");
  save(el).click();
  expect(saves).toEqual([{ mode: "add", departmentId: "deli", name: "Standard" }]);
});

it("a department with sets asks Start from, required and preselected to its default", async () => {
  const { el, saves } = await mount((el) => (el.mode = "add"));
  await change(el, "departmentId", "restaurant");
  const from = field(el, "fromSetId")!;
  expect(from).not.toBeNull();
  expect(from.label).toBe("Start from");
  expect(from.required).toBe(true);
  expect(from.value).toBe("standard");
  expect(from.options.map(({ value }) => value)).toEqual(["standard", "dinner", "private"]);
  await change(el, "fromSetId", "dinner");
  await change(el, "name", "Brunch");
  save(el).click();
  expect(saves).toEqual([
    { mode: "add", departmentId: "restaurant", name: "Brunch", fromSetId: "dinner" },
  ]);
  await change(el, "departmentId", "bar");
  expect(field(el, "fromSetId")!.value).toBe("bar-standard");
});

it("Rename asks only Name, opened with the set's name, and Save waits for a change", async () => {
  const { el, saves } = await mount((el) => {
    el.mode = "rename";
    el.set = { id: "dinner", name: "Dinner" };
  });
  expect(heading(el)).toBe("Rename Dinner");
  expect(field(el, "departmentId")).toBeNull();
  expect(field(el, "fromSetId")).toBeNull();
  expect(field(el, "name")!.value).toBe("Dinner");
  expect(save(el).disabled).toBe(true);
  await change(el, "name", "Evening");
  save(el).click();
  expect(saves).toEqual([{ mode: "rename", setId: "dinner", name: "Evening" }]);
});

it("Copy asks a name, starting empty", async () => {
  const { el, saves } = await mount((el) => {
    el.mode = "copy";
    el.set = { id: "dinner", name: "Dinner" };
  });
  expect(heading(el)).toBe("Copy Dinner");
  expect(field(el, "name")!.value).toBe("");
  expect(field(el, "departmentId")).toBeNull();
  expect(save(el).disabled).toBe(true);
  await change(el, "name", "Dinner for 40");
  save(el).click();
  expect(saves).toEqual([{ mode: "copy", setId: "dinner", name: "Dinner for 40" }]);
});

it("marks Name and says so at the bottom when another set already has the name", async () => {
  const { el } = await mount((el) => {
    el.mode = "copy";
    el.set = { id: "dinner", name: "Dinner" };
  });
  await change(el, "name", "Standard");
  save(el).click();
  el.refusal = {
    code: "floor_plan_set.name_taken",
    params: { departmentId: "restaurant", name: "Standard" },
  };
  await el.updateComplete;
  expect(field(el, "name")!.error).toBe("Another set of this department already has this name.");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  await change(el, "name", "Standard 2");
  expect(field(el, "name")!.error).toBe("");
  expect(bottom(el)).toBe("");
});

it("marks the department a refusal names, and says a gone set at the bottom", async () => {
  const { el } = await mount((el) => (el.mode = "add"));
  await change(el, "departmentId", "deli");
  await change(el, "name", "Standard");
  el.refusal = { code: "floor_plan_set.invalid", params: { field: "departmentId" } };
  await el.updateComplete;
  expect(field(el, "departmentId")!.error).toBe("Check this value.");
  el.refusal = { code: "floor_plan_set.not_found", params: { setId: "x" } };
  await el.updateComplete;
  expect(field(el, "departmentId")!.error).toBe("");
  expect(bottom(el)).toBe("This set no longer exists.");
  el.refusal = { code: "server.unavailable" };
  await el.updateComplete;
  expect(bottom(el)).toBe("This could not be saved. Try again.");
});

it("speaks Spanish", async () => {
  setLocale("es");
  const { el } = await mount((el) => (el.mode = "add"));
  expect(heading(el)).toBe("Añadir conjunto");
  await change(el, "departmentId", "restaurant");
  expect(field(el, "fromSetId")!.label).toBe("A partir de");
  expect(field(el, "name")!.label).toBe("Nombre");
  el.refusal = { code: "floor_plan_set.name_taken" };
  await el.updateComplete;
  expect(field(el, "name")!.error).toBe("Otro conjunto de este departamento ya tiene este nombre.");
  el.mode = "rename";
  el.set = { id: "dinner", name: "Cena" };
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(heading(el)).toBe("Renombrar Cena");
  el.mode = "copy";
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(heading(el)).toBe("Copiar Cena");
});
