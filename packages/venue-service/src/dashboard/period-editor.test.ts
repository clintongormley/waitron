import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { PeriodEditor } from "./period-editor.js";
import "./period-editor.js";

const hosts: HTMLElement[] = [];
const menus = [
  { id: "lunch", name: "Lunch", active: true, includes: ["drinks"] },
  { id: "drinks", name: "Drinks", active: true, includes: [] },
  { id: "deli", name: "Deli", active: true, includes: [] },
  { id: "old", name: "Old menu", active: false, includes: [] },
];
const period = {
  id: "p1",
  name: "Lunch",
  colour: "blue" as const,
  menuId: "lunch",
  staffMenuIds: ["deli"],
  weekdays: [1, 2],
};
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});
async function mount(edit = false) {
  const el = document.createElement("period-editor");
  el.menus = menus;
  el.departmentName = "Restaurant";
  if (edit) el.period = structuredClone(period);
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
function field(el: PeriodEditor, name: string) {
  const control = el.shadowRoot!.querySelector<
    HTMLElement &
      Pick<HTMLElementTagNameMap["wt-input"], "value" | "required" | "error" | "disabled"> &
      Pick<HTMLElementTagNameMap["wt-combobox"], "values" | "options">
  >(`[name="${name}"]`);
  expect(control, `period field ${name}`).not.toBeNull();
  return control!;
}
async function change(el: PeriodEditor, name: string, detail: object) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function save(el: PeriodEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-period]",
  )!;
}

it("opens the required fields quiet and blocks an unchanged programmatic save", async () => {
  const el = await mount(true);
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  expect(field(el, "name").value).toBe("Lunch");
  expect(field(el, "name").required).toBe(true);
  expect(field(el, "menuId").required).toBe(true);
  expect(field(el, "colour").value).toBe("blue");
  expect(field(el, "staffMenuIds").values).toEqual(["deli"]);
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  save(el).click();
  await el.updateComplete;
  expect(writes).toEqual([]);
});

it("offers active customer menus with included menus and excludes the customer choice from staff menus", async () => {
  const el = await mount(true);
  expect(field(el, "menuId").options).toEqual([
    { value: "lunch", label: "Lunch · includes Drinks" },
    { value: "drinks", label: "Drinks" },
    { value: "deli", label: "Deli" },
  ]);
  expect(field(el, "staffMenuIds").options.map((o) => o.value)).toEqual(["drinks", "deli"]);
  await change(el, "menuId", { value: "deli" });
  expect(field(el, "staffMenuIds").values).toEqual([]);
  expect(field(el, "staffMenuIds").options.map((o) => o.value)).toEqual(["lunch", "drinks"]);
});

it("sends the changed period's trimmed name, colour and staff menus once", async () => {
  const el = await mount();
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "name", { value: "  Dinner  " });
  await change(el, "menuId", { value: "lunch" });
  await change(el, "colour", { value: "green" });
  await change(el, "staffMenuIds", { values: ["deli", "drinks"] });
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  save(el).click();
  await el.updateComplete;
  expect(writes).toEqual([
    {
      periodId: null,
      input: { name: "Dinner", colour: "green", menuId: "lunch", staffMenuIds: ["deli", "drinks"] },
    },
  ]);
});

it("marks every missing required field after submission and rechecks until corrected", async () => {
  const el = await mount();
  await change(el, "colour", { value: "green" });
  save(el).click();
  await el.updateComplete;
  expect(field(el, "name").error).toBe("Enter a name.");
  expect(field(el, "menuId").error).toBe("Choose a menu.");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(true);
  await change(el, "name", { value: "Dinner" });
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(true);
  await change(el, "menuId", { value: "lunch" });
  expect(save(el).disabled).toBe(false);
});

it.each(["name", "colour", "menuId", "staffMenuIds"])(
  "places a server refusal under %s and keeps retry enabled",
  async (name) => {
    const el = await mount(true);
    await change(el, "name", { value: "Dinner" });
    el.refusal = { code: "menu_period.invalid", params: { field: name } };
    await el.updateComplete;
    expect(field(el, name).error).toBe("Check this value.");
    expect(save(el).disabled).toBe(false);
    const detail =
      name === "staffMenuIds"
        ? { values: [] }
        : { value: name === "name" ? "Evening" : name === "colour" ? "green" : "drinks" };
    await change(el, name, detail);
    expect(field(el, name).error).toBe("");
  },
);

it("names a duplicate under Name and maps a missing catalogue by the submitted menu id", async () => {
  const el = await mount(true);
  await change(el, "name", { value: "Dinner" });
  save(el).click();
  el.refusal = { code: "menu_period.name_taken" };
  await el.updateComplete;
  expect(field(el, "name").error).toBe("Another period of this department already has this name.");
  el.refusal = { code: "catalogue.not_found", params: { catalogueId: "deli" } };
  await el.updateComplete;
  expect(field(el, "staffMenuIds").error).toBe("Choose active menus.");
  expect(field(el, "menuId").error).toBe("");
});

it("shows an unnamed refusal once at the bottom, keeps values and blocks only while busy", async () => {
  const el = await mount(true);
  await change(el, "name", { value: "Dinner" });
  el.refusal = { code: "connection.failed" };
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("This could not be saved. Try again.");
  expect(field(el, "name").value).toBe("Dinner");
  expect(save(el).disabled).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(true);
  expect(field(el, "name").disabled).toBe(true);
});

it("compares staff selections by values and resets when a different period opens", async () => {
  const el = await mount(true);
  await change(el, "staffMenuIds", { values: ["deli", "drinks"] });
  save(el).click();
  expect(
    el.commitSubmitted({
      name: "Lunch",
      colour: "blue",
      menuId: "lunch",
      staffMenuIds: ["drinks", "deli"],
    }),
  ).toBe(true);
  await el.updateComplete;
  expect(save(el).variant).toBe("secondary");
  el.period = { ...period, id: "p2", name: "Evening" };
  await el.updateComplete;
  expect(field(el, "name").value).toBe("Evening");
  expect(save(el).disabled).toBe(true);
});

it("Enter on the native name field submits the changed period", async () => {
  const el = await mount(true);
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "name", { value: "Dinner" });
  const control = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await control.updateComplete;
  control
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(writes).toEqual([
    {
      periodId: "p1",
      input: { name: "Dinner", colour: "blue", menuId: "lunch", staffMenuIds: ["deli"] },
    },
  ]);
});

it("draws Save in the footer and a native click submits the changed period", async () => {
  const el = await mount(true);
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "name", { value: "Dinner" });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await expect
    .poll(() => modal.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!.open)
    .toBe(true);
  await save(el).updateComplete;
  const native = save(el).shadowRoot!.querySelector<HTMLButtonElement>("button")!;
  expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
  await userEvent.click(native);
  expect(writes).toEqual([
    {
      periodId: "p1",
      input: { name: "Dinner", colour: "blue", menuId: "lunch", staffMenuIds: ["deli"] },
    },
  ]);
});

it("Cancel closes without a coordinator, and reopening clears earlier edits and errors", async () => {
  const el = await mount(true);
  await change(el, "name", { value: "Dinner" });
  el.refusal = { code: "menu_period.name_taken" };
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[slot=cancel]")!.click();
  await expect.poll(() => el.open).toBe(false);
  el.period = undefined;
  el.open = true;
  await el.updateComplete;
  expect(field(el, "name").value).toBe("");
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(true);
});

it.each([
  ["menu_period.not_found", "This period no longer exists."],
  ["department.not_found", "This department no longer exists."],
])("places %s at the bottom rather than on a field", async (code, message) => {
  const el = await mount(true);
  await change(el, "name", { value: "Dinner" });
  el.refusal = { code };
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe(message);
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(false);
});

it("maps a refused customer menu before a submission, but an unrelated catalogue stays at the bottom", async () => {
  const el = await mount(true);
  await change(el, "name", { value: "Dinner" });
  el.refusal = { code: "catalogue.not_found", params: { catalogueId: "lunch" } };
  await el.updateComplete;
  expect(field(el, "menuId").error).toBe("Choose active menus.");
  expect(field(el, "staffMenuIds").error).toBe("");
  await change(el, "colour", { value: "green" });
  expect(field(el, "menuId").error).toBe("Choose active menus.");
  el.refusal = { code: "catalogue.not_found", params: { catalogueId: "other" } };
  await el.updateComplete;
  expect(field(el, "menuId").error).toBe("");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("This could not be saved. Try again.");
});

it("rejects a colour not offered by the form and keeps the required explanation", async () => {
  const el = await mount(true);
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "colour", { value: "unknown" });
  save(el).click();
  await el.updateComplete;
  expect(field(el, "colour").error).toBe("Choose a colour.");
  expect(writes).toEqual([]);
  expect(save(el).disabled).toBe(true);
});

it("committing an input without colour keeps the submitted colour as the saved baseline", async () => {
  const el = await mount(true);
  await change(el, "name", { value: "Dinner" });
  save(el).click();
  expect(el.commitSubmitted({ name: "Dinner", menuId: "lunch", staffMenuIds: ["deli"] })).toBe(
    true,
  );
  await el.updateComplete;
  expect(save(el).variant).toBe("secondary");
  expect(field(el, "colour").value).toBe("blue");
});

it("an included menu absent from a read still leaves the customer menu selectable", async () => {
  const el = await mount(true);
  el.menus = [{ id: "lunch", name: "Lunch", active: true, includes: ["missing"] }];
  await el.updateComplete;
  expect(field(el, "menuId").options).toEqual([
    { value: "lunch", label: "Lunch · includes missing" },
  ]);
});

it("departed controls cannot edit, submit or close a reopened period", async () => {
  const el = await mount(true);
  const oldName = field(el, "name");
  const oldColour = field(el, "colour");
  const oldMenu = field(el, "menuId");
  const oldStaffMenus = field(el, "staffMenuIds");
  const oldSave = save(el);
  const oldCancel = el.shadowRoot!.querySelector<HTMLElement>("[slot=cancel]")!;
  const oldModal = el.shadowRoot!.querySelector("wt-modal")!;
  el.open = false;
  await el.updateComplete;
  el.period = { ...period, id: "p2", name: "Evening" };
  el.open = true;
  await el.updateComplete;
  await change(el, "name", { value: "Evening changed" });
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  oldName.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Stale" } }));
  oldColour.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "red" } }));
  oldMenu.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "drinks" } }));
  oldStaffMenus.dispatchEvent(new CustomEvent("wt-change", { detail: { values: [] } }));
  oldSave.click();
  oldCancel.click();
  oldModal.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  oldModal.dispatchEvent(new CustomEvent("wt-close"));
  await el.updateComplete;
  expect(el.open).toBe(true);
  expect(field(el, "name").value).toBe("Evening changed");
  expect(field(el, "colour").value).toBe("blue");
  expect(field(el, "menuId").value).toBe("lunch");
  expect(field(el, "staffMenuIds").values).toEqual(["deli"]);
  expect(writes).toEqual([]);
});
