import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { PeriodDialog } from "./period-dialog.js";
import "./period-dialog.js";

const hosts: HTMLElement[] = [];
const menus = [
  { id: "lunch", name: "Lunch", active: true, includes: ["Drinks"] },
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
  endOffsetMinutes: 0,
  weekdays: [1, 2],
  routingUses: [],
};
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});
async function mount(edit = false) {
  const el = document.createElement("period-dialog");
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
function field(el: PeriodDialog, name: string) {
  const control = el.shadowRoot!.querySelector<
    HTMLElement &
      Pick<
        HTMLElementTagNameMap["wt-input"],
        "value" | "required" | "error" | "disabled" | "label"
      > &
      Pick<HTMLElementTagNameMap["wt-combobox"], "values" | "options">
  >(`[name="${name}"]`);
  expect(control, `period field ${name}`).not.toBeNull();
  return control!;
}
function swatch(el: PeriodDialog, colour: string) {
  const button = el.shadowRoot!.querySelector<HTMLButtonElement>(
    `[role=radio][data-colour="${colour}"]`,
  );
  expect(button, `colour swatch ${colour}`).not.toBeNull();
  return button!;
}
function checkedColour(el: PeriodDialog) {
  return (
    el.shadowRoot!.querySelector("[role=radio][aria-checked=true]")?.getAttribute("data-colour") ??
    null
  );
}
function errorOf(el: PeriodDialog, name: string) {
  if (name !== "colour") return field(el, name).error;
  return el.shadowRoot!.querySelector("[data-test=colour-error]")?.textContent?.trim() ?? "";
}
async function change(el: PeriodDialog, name: string, detail: object) {
  if (name === "colour") swatch(el, (detail as { value: string }).value).click();
  else
    field(el, name).dispatchEvent(
      new CustomEvent("wt-change", { detail, bubbles: true, composed: true }),
    );
  await el.updateComplete;
}
function save(el: PeriodDialog) {
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
  expect(checkedColour(el)).toBe("blue");
  expect(field(el, "staffMenuIds").values).toEqual(["deli"]);
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  save(el).click();
  await el.updateComplete;
  expect(writes).toEqual([]);
});

it("headed Edit period · Restaurant for a period and Add period · Restaurant for a new one", async () => {
  const edit = await mount(true);
  expect(edit.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Edit period · Restaurant");
  edit.remove();
  const fresh = await mount();
  expect(fresh.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Add period · Restaurant");
});

it("shows what the chosen customer menu includes under it, and nothing for a menu that includes none", async () => {
  const el = await mount(true);
  el.menus = [
    { id: "lunch", name: "Lunch", active: true, includes: ["Desserts", "Drinks"] },
    { id: "desserts", name: "Desserts", active: true, includes: [] },
    { id: "drinks", name: "Drinks", active: true, includes: [] },
  ];
  await el.updateComplete;
  const includes = () => el.shadowRoot!.querySelector("[data-test=menu-includes]");
  expect(includes()).not.toBeNull();
  expect(includes()!.textContent!.trim()).toBe("Includes Desserts, Drinks");
  await change(el, "menuId", { value: "desserts" });
  expect(includes()).toBeNull();
});

it("orders Name, Colour, Customer menu, Staff-only menus, End offset, in English and Spanish", async () => {
  const el = await mount(true);
  const order = () =>
    [...el.shadowRoot!.querySelectorAll("[name]")].map((node) => node.getAttribute("name"));
  expect(order()).toEqual([
    "name",
    "colour",
    "menuId",
    "staffMenuIds",
    "endOffsetMinutes",
    "floorPlanId",
  ]);
  expect(field(el, "menuId").label).toBe("Customer menu");
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  expect(field(el, "menuId").label).toBe("Carta de clientes");
  expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Editar periodo · Restaurant");
  expect(el.shadowRoot!.querySelector("[data-test=menu-includes]")!.textContent!.trim()).toBe(
    "Incluye Drinks",
  );
});

it("offers active customer menus by name and excludes the customer choice from staff menus", async () => {
  const el = await mount(true);
  expect(field(el, "menuId").options).toEqual([
    { value: "lunch", label: "Lunch" },
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
      input: {
        name: "Dinner",
        colour: "green",
        menuId: "lunch",
        staffMenuIds: ["deli", "drinks"],
        endOffsetMinutes: 0,
      },
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
    expect(errorOf(el, name)).toBe("Check this value.");
    expect(save(el).disabled).toBe(false);
    const detail =
      name === "staffMenuIds"
        ? { values: [] }
        : { value: name === "name" ? "Evening" : name === "colour" ? "green" : "drinks" };
    await change(el, name, detail);
    expect(errorOf(el, name)).toBe("");
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
      input: {
        name: "Dinner",
        colour: "blue",
        menuId: "lunch",
        staffMenuIds: ["deli"],
        endOffsetMinutes: 0,
      },
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
      input: {
        name: "Dinner",
        colour: "blue",
        menuId: "lunch",
        staffMenuIds: ["deli"],
        endOffsetMinutes: 0,
      },
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

it("a stored colour outside the six is refused by the form's own check", async () => {
  const el = document.createElement("period-dialog");
  el.menus = menus;
  el.departmentName = "Restaurant";
  el.period = { ...structuredClone(period), colour: "pink" as never };
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  expect(checkedColour(el)).toBeNull();
  await change(el, "name", { value: "Dinner" });
  save(el).click();
  await el.updateComplete;
  expect(errorOf(el, "colour")).toBe("Choose a colour.");
  expect(writes).toEqual([]);
  expect(save(el).disabled).toBe(true);
  await change(el, "colour", { value: "green" });
  expect(errorOf(el, "colour")).toBe("");
  expect(save(el).disabled).toBe(false);
});

it("colour is a radio group of the six period colours; choosing one checks only it and makes Save ready", async () => {
  const el = await mount(true);
  const group = el.shadowRoot!.querySelector("fieldset[name=colour] [role=radiogroup]");
  expect(group).not.toBeNull();
  expect(el.shadowRoot!.querySelector("fieldset[name=colour] > legend")!.textContent!.trim()).toBe(
    "Colour",
  );
  const radios = [...group!.querySelectorAll<HTMLButtonElement>("button[role=radio]")];
  expect(radios.map((radio) => radio.dataset.colour)).toEqual([
    "red",
    "amber",
    "grey",
    "blue",
    "green",
    "purple",
  ]);
  expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
    "Red",
    "Amber",
    "Grey",
    "Blue",
    "Green",
    "Purple",
  ]);
  expect(radios.every((radio) => radio.type === "button")).toBe(true);
  expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1);
  expect(checkedColour(el)).toBe("blue");
  expect(save(el).disabled).toBe(true);
  await change(el, "colour", { value: "green" });
  expect(
    radios
      .filter((radio) => radio.getAttribute("aria-checked") === "true")
      .map((radio) => radio.dataset.colour),
  ).toEqual(["green"]);
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
});

it("the colour group is one tab stop, and the arrow keys move focus and the choice round it", async () => {
  const el = await mount(true);
  const focused = () => el.shadowRoot!.activeElement?.getAttribute("data-colour") ?? null;
  expect(
    ["red", "amber", "grey", "blue", "green", "purple"].map(
      (colour) => swatch(el, colour).tabIndex,
    ),
  ).toEqual([-1, -1, -1, 0, -1, -1]);
  swatch(el, "blue").focus();
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;
  expect([checkedColour(el), focused()]).toEqual(["green", "green"]);
  expect(swatch(el, "green").tabIndex).toBe(0);
  expect(swatch(el, "blue").tabIndex).toBe(-1);
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;
  expect([checkedColour(el), focused()]).toEqual(["red", "red"]);
  await userEvent.keyboard("{ArrowLeft}");
  await el.updateComplete;
  expect([checkedColour(el), focused()]).toEqual(["purple", "purple"]);
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect([checkedColour(el), focused()]).toEqual(["green", "green"]);
  expect(save(el).disabled).toBe(false);
  await userEvent.tab();
  expect(el.shadowRoot!.activeElement?.getAttribute("role")).not.toBe("radio");
});

it("with no colour chosen, the first swatch is the group's tab stop", async () => {
  const el = document.createElement("period-dialog");
  el.menus = menus;
  el.departmentName = "Restaurant";
  el.period = { ...structuredClone(period), colour: "pink" as never };
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  expect(checkedColour(el)).toBeNull();
  expect(
    ["red", "amber", "grey", "blue", "green", "purple"].map(
      (colour) => swatch(el, colour).tabIndex,
    ),
  ).toEqual([0, -1, -1, -1, -1, -1]);
});

it("draws the chosen swatch's ring outside the swatch, clear of its fill", async () => {
  const el = await mount(true);
  const chosen = getComputedStyle(swatch(el, "blue"));
  expect(chosen.outlineStyle).toBe("solid");
  expect(chosen.outlineOffset).toBe("2px");
  expect(getComputedStyle(swatch(el, "green")).outlineStyle).toBe("none");
});

it("LOOK L1, L2, L9: the Colour label stands clear of its swatches, the chosen swatch is ringed in the text colour, and the end-offset explanation is small muted hint text", async () => {
  const el = await mount(true);
  const legend = el.shadowRoot!.querySelector("fieldset[name=colour] > legend")!;
  expect(
    swatch(el, "blue").getBoundingClientRect().top - legend.getBoundingClientRect().bottom,
  ).toBeGreaterThanOrEqual(4);
  const text = getComputedStyle(legend).color;
  expect(getComputedStyle(swatch(el, "blue")).outlineColor).toBe(text);
  const explanation = getComputedStyle(
    el.shadowRoot!.querySelector("[data-test=offset-explanation]")!,
  );
  expect(explanation.fontSize).toBe(
    getComputedStyle(el).getPropertyValue("--wt-font-size-sm").trim(),
  );
  expect(explanation.color).not.toBe(text);
  expect(parseFloat(explanation.marginTop)).toBeLessThan(0);
});

it("a Save refused only for its colour moves focus to the first swatch", async () => {
  const el = document.createElement("period-dialog");
  el.menus = menus;
  el.departmentName = "Restaurant";
  el.period = { ...structuredClone(period), colour: "pink" as never };
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  await change(el, "name", { value: "Dinner" });
  save(el).click();
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(swatch(el, "red"));
});

it("a refusal naming colour shows under the colour group", async () => {
  const el = await mount(true);
  await change(el, "name", { value: "Dinner" });
  el.refusal = { code: "menu_period.invalid", params: { field: "colour" } };
  await el.updateComplete;
  const message = el.shadowRoot!.querySelector(
    "fieldset[name=colour] [role=radiogroup] ~ [data-test=colour-error]",
  );
  expect(message).not.toBeNull();
  expect(message!.textContent!.trim()).toBe("Check this value.");
  expect(
    el
      .shadowRoot!.querySelector("fieldset[name=colour] [role=radiogroup]")!
      .getAttribute("aria-invalid"),
  ).toBe("true");
});

it("the floor plan field is shown disabled with Not available yet, and is never sent", async () => {
  const el = await mount(true);
  const writes: { input: object }[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  const plan = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=floorPlanId]",
  );
  expect(plan).not.toBeNull();
  expect(plan!.disabled).toBe(true);
  expect(plan!.label).toBe("Floor plan");
  expect(plan!.placeholder).toBe("Not available yet");
  await change(el, "name", { value: "Dinner" });
  save(el).click();
  await el.updateComplete;
  expect(writes).toHaveLength(1);
  expect(Object.keys(writes[0]!.input).sort()).toEqual([
    "colour",
    "endOffsetMinutes",
    "menuId",
    "name",
    "staffMenuIds",
  ]);
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  expect(plan!.label).toBe("Plano de sala");
  expect(plan!.placeholder).toBe("Aún no disponible");
  const fresh = await mount();
  expect(fresh.shadowRoot!.querySelector("[name=floorPlanId]")).not.toBeNull();
});

it("adding from a painter shows no floor plan field", async () => {
  const el = await mount();
  el.fromPainter = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=floorPlanId]")).toBeNull();
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
  expect(checkedColour(el)).toBe("blue");
});

it("an included menu absent from a read still leaves the customer menu selectable", async () => {
  const el = await mount(true);
  el.menus = [{ id: "lunch", name: "Lunch", active: true, includes: ["missing"] }];
  await el.updateComplete;
  expect(field(el, "menuId").options).toEqual([{ value: "lunch", label: "Lunch" }]);
  expect(el.shadowRoot!.querySelector("[data-test=menu-includes]")!.textContent!.trim()).toBe(
    "Includes missing",
  );
});

it("departed controls cannot edit, submit or close a reopened period", async () => {
  const el = await mount(true);
  const oldName = field(el, "name");
  const oldColour = swatch(el, "red");
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
  oldColour.click();
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
  expect(checkedColour(el)).toBe("blue");
  expect(field(el, "menuId").value).toBe("lunch");
  expect(field(el, "staffMenuIds").values).toEqual(["deli"]);
  expect(writes).toEqual([]);
});

it.each([0, -15, 14])(
  "opens the saved offset %s on the native required text field",
  async (offset) => {
    const el = await mount(true);
    el.period = { ...period, id: `offset-${offset}`, endOffsetMinutes: offset };
    await el.updateComplete;
    const control =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endOffsetMinutes]")!;
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("input")!;
    expect(native.value).toBe(String(offset));
    expect(native.name).toBe("endOffsetMinutes");
    expect(control.required).toBe(true);
    expect(save(el).disabled).toBe(true);
  },
);

it("starts new periods at zero and sends an offset-only edit as a JSON number on Enter", async () => {
  const fresh = await mount();
  expect(field(fresh, "endOffsetMinutes").value).toBe("0");
  fresh.remove();
  const el = await mount(true);
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "endOffsetMinutes", { value: "+014" });
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  const control =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endOffsetMinutes]")!;
  await control.updateComplete;
  control
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  expect(JSON.parse(JSON.stringify(writes))).toEqual([
    {
      periodId: "p1",
      input: {
        name: "Lunch",
        colour: "blue",
        menuId: "lunch",
        staffMenuIds: ["deli"],
        endOffsetMinutes: 14,
      },
    },
  ]);
  expect(
    el.commitSubmitted({
      name: "Lunch",
      colour: "blue",
      menuId: "lunch",
      staffMenuIds: ["deli"],
      endOffsetMinutes: 14,
    }),
  ).toBe(true);
  await el.updateComplete;
  expect(save(el).disabled).toBe(true);
  await change(el, "endOffsetMinutes", { value: "-15" });
  expect(save(el).disabled).toBe(false);
  await change(el, "endOffsetMinutes", { value: "0014" });
  expect(save(el).disabled).toBe(true);
});

it("equivalent signed zero does not make an unchanged period saveable", async () => {
  const el = await mount(true);
  const writes: unknown[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "endOffsetMinutes", { value: "-000" });
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  save(el).click();
  expect(writes).toEqual([]);
});

it.each(["", "1.5", "1e2", "-", "1440", "-1440", "Infinity"])(
  "preserves invalid offset %j and blocks saving until corrected",
  async (text) => {
    const el = await mount(true);
    const writes: unknown[] = [];
    el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
    await change(el, "endOffsetMinutes", { value: text });
    save(el).click();
    await el.updateComplete;
    expect(field(el, "endOffsetMinutes").value).toBe(text);
    expect(field(el, "endOffsetMinutes").error).toBe("Enter whole minutes from -1439 to 1439.");
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe("Correct the highlighted fields to continue.");
    expect(writes).toEqual([]);
    expect(save(el).disabled).toBe(true);
    await change(el, "endOffsetMinutes", { value: "-1439" });
    expect(field(el, "endOffsetMinutes").error).toBe("");
    expect(save(el).disabled).toBe(false);
  },
);

it("marks an offset placement refusal and leaves retry enabled", async () => {
  const el = await mount(true);
  await change(el, "endOffsetMinutes", { value: "15" });
  save(el).click();
  el.refusal = {
    code: "menu_period.invalid",
    params: { field: "endOffsetMinutes", reason: "placement" },
  };
  await el.updateComplete;
  expect(field(el, "endOffsetMinutes").error).toBe(
    "Change the offset so orders end after this period starts and before the next period starts.",
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(false);
  await change(el, "endOffsetMinutes", { value: "14" });
  expect(field(el, "endOffsetMinutes").error).toBe("");
});

it("shows the Spanish offset label, explanation and local validation", async () => {
  setLocale("es");
  const el = await mount(true);
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  const control =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endOffsetMinutes]")!;
  expect(control.label).toBe("Desfase del final del periodo (minutos)");
  expect(el.shadowRoot!.textContent).toContain("Negativo: deja de añadir platos antes del final.");
  await change(el, "endOffsetMinutes", { value: "" });
  save(el).click();
  await el.updateComplete;
  expect(control.error).toBe("Introduce minutos enteros entre -1439 y 1439.");
});
it("labels its submit with submitLabel when one is given, else Save", async () => {
  const el = await mount();
  expect(save(el).textContent!.trim()).toBe("Save");
  el.submitLabel = "Add and paint with it";
  await el.updateComplete;
  expect(save(el).textContent!.trim()).toBe("Add and paint with it");
});

const seasons = [
  { id: "summer", startsOn: "06-01" },
  { id: "winter", startsOn: "12-01" },
  { id: "spring", startsOn: "03-01" },
];
async function mountEdit(setup: (el: PeriodDialog) => void) {
  const el = await mount(true);
  el.open = false;
  await el.updateComplete;
  setup(el);
  el.open = true;
  await el.updateComplete;
  return el;
}
function paintedChips(el: PeriodDialog) {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=painted-in] .chip")].map(
    (chip) => ({
      text: chip.textContent!.trim(),
      tag: chip.localName,
      href: chip.getAttribute("href"),
      tint: chip.getAttribute("data-tint"),
      special: chip.hasAttribute("data-special-day"),
    }),
  );
}

it("Painted in shows season chips in the order given with their tints, then special days; as links when paintedInLinks, plain otherwise", async () => {
  const paintedIn = {
    seasons: [
      { id: "winter", name: "Winter" },
      { id: "summer", name: "Summer" },
    ],
    specialDays: [{ id: "sd1", name: "Company dinners" }],
  };
  const el = await mountEdit((el) => {
    el.paintedIn = paintedIn;
    el.seasons = seasons;
    el.departmentId = "restaurant";
    el.paintedInLinks = true;
  });
  expect(
    el.shadowRoot!.querySelector("[data-test=painted-in]")!.textContent!.includes("Painted in"),
  ).toBe(true);
  expect(paintedChips(el)).toEqual([
    {
      text: "Winter",
      tag: "a",
      href: "/manage/opening-hours/view/season/season/winter/department/restaurant",
      tint: "3",
      special: false,
    },
    {
      text: "Summer",
      tag: "a",
      href: "/manage/opening-hours/view/season/season/summer/department/restaurant",
      tint: "2",
      special: false,
    },
    {
      text: "Company dinners",
      tag: "a",
      href: "/manage/opening-hours/view/special-day/special-day/sd1",
      tint: null,
      special: true,
    },
  ]);
  for (const chip of el.shadowRoot!.querySelectorAll("[data-test=painted-in] a.chip"))
    expect(getComputedStyle(chip).textDecorationLine).toBe("none");
  el.paintedInLinks = false;
  await el.updateComplete;
  expect(paintedChips(el).map(({ tag, href }) => ({ tag, href }))).toEqual([
    { tag: "span", href: null },
    { tag: "span", href: null },
    { tag: "span", href: null },
  ]);
  expect(paintedChips(el).map(({ tint }) => tint)).toEqual(["3", "2", null]);
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector("[data-test=painted-in]")!.textContent!.includes("Pintado en"),
  ).toBe(true);
});

it("a season chip whose season is not in seasons stays a season chip, untinted", async () => {
  const el = await mountEdit((el) => {
    el.paintedIn = {
      seasons: [{ id: "autumn", name: "Autumn" }],
      specialDays: [{ id: "sd1", name: "Company dinners" }],
    };
    el.departmentId = "restaurant";
  });
  expect(paintedChips(el).map(({ text, tint, special }) => ({ text, tint, special }))).toEqual([
    { text: "Autumn", tint: null, special: false },
    { text: "Company dinners", tint: null, special: true },
  ]);
});

it("Painted in draws plain chips when links are asked for but no department is given", async () => {
  const el = await mountEdit((el) => {
    el.paintedIn = {
      seasons: [{ id: "winter", name: "Winter" }],
      specialDays: [{ id: "sd1", name: "Company dinners" }],
    };
    el.seasons = seasons;
    el.paintedInLinks = true;
  });
  expect(paintedChips(el).map(({ text, tag, href }) => ({ text, tag, href }))).toEqual([
    { text: "Winter", tag: "span", href: null },
    { text: "Company dinners", tag: "span", href: null },
  ]);
});

it("a period painted nowhere says Not painted anywhere", async () => {
  const el = await mountEdit((el) => {
    el.paintedIn = { seasons: [], specialDays: [] };
    el.seasons = seasons;
    el.departmentId = "restaurant";
  });
  const note = () => el.shadowRoot!.querySelector("[data-test=not-painted]");
  expect(note()?.textContent?.trim()).toBe("Not painted anywhere");
  expect(paintedChips(el)).toEqual([]);
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  expect(note()?.textContent?.trim()).toBe("Sin pintar en ningún sitio");
});

it("no Painted in section while paintedIn is not given, nor when adding", async () => {
  const edit = await mount(true);
  expect(edit.shadowRoot!.querySelector("[data-test=painted-in]")).toBeNull();
  expect(edit.shadowRoot!.querySelector("[data-test=not-painted]")).toBeNull();
  edit.remove();
  const add = await mount();
  add.open = false;
  await add.updateComplete;
  add.paintedIn = { seasons: [], specialDays: [] };
  add.open = true;
  await add.updateComplete;
  expect(add.shadowRoot!.querySelector("[data-test=painted-in]")).toBeNull();
  expect(add.shadowRoot!.querySelector("[data-test=not-painted]")).toBeNull();
});

function deleteButton(el: PeriodDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=delete-period]",
  );
}

it("Delete… shows only when deletable and editing", async () => {
  const plain = await mount(true);
  expect(deleteButton(plain)).toBeNull();
  plain.remove();
  const editing = await mountEdit((el) => {
    el.deletable = true;
  });
  expect(deleteButton(editing)?.textContent?.trim()).toBe("Delete…");
  expect(deleteButton(editing)?.variant).toBe("secondary");
  expect(deleteButton(editing)!.closest("wt-form-actions")).toBeNull();
  setLocale("es");
  editing.requestUpdate();
  await editing.updateComplete;
  expect(deleteButton(editing)?.textContent?.trim()).toBe("Eliminar…");
  editing.remove();
  const adding = await mount();
  adding.deletable = true;
  await adding.updateComplete;
  expect(deleteButton(adding)).toBeNull();
});

it("Delete… on a clean draft closes the dialog and emits period-delete once with the period id", async () => {
  const el = await mountEdit((el) => {
    el.deletable = true;
  });
  const events: { type: string; detail: unknown }[] = [];
  for (const type of ["period-close", "period-delete"])
    el.addEventListener(type, (e) => events.push({ type, detail: (e as CustomEvent).detail }));
  deleteButton(el)!.click();
  await expect.poll(() => events.length).toBe(2);
  await el.updateComplete;
  expect(events).toEqual([
    { type: "period-close", detail: null },
    { type: "period-delete", detail: { periodId: "p1" } },
  ]);
  expect(el.open).toBe(false);
});

const departments = [
  { id: "restaurant", name: "Restaurant", usedColours: ["red", "amber"] as const },
  { id: "bar", name: "Bar", usedColours: ["red"] as const },
];
async function mountAdd(list: typeof departments | (typeof departments)[number][]) {
  const el = document.createElement("period-dialog");
  el.menus = menus;
  el.departments = list;
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

it("from the page, Add asks for the department first, preselects a lone department, and sends it", async () => {
  const el = await mountAdd([departments[1]!]);
  const names = [...el.shadowRoot!.querySelectorAll("[name]")].map((n) => n.getAttribute("name"));
  expect(names[0]).toBe("departmentId");
  expect(field(el, "departmentId").required).toBe(true);
  expect(field(el, "departmentId").label).toBe("Department");
  expect(field(el, "departmentId").value).toBe("bar");
  expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Add period");
  const writes: { departmentId?: string; input: object }[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "name", { value: "Dinner" });
  await change(el, "menuId", { value: "lunch" });
  save(el).click();
  await el.updateComplete;
  expect(writes).toHaveLength(1);
  expect(writes[0]!.departmentId).toBe("bar");
  expect(writes[0]!.input).toEqual({
    name: "Dinner",
    colour: "amber",
    menuId: "lunch",
    staffMenuIds: [],
    endOffsetMinutes: 0,
  });
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Añadir periodo");
});

it("with two departments, the preselected colour follows the department chosen until a colour is picked; after a pick, changing department keeps it", async () => {
  const el = await mountAdd(departments);
  expect(field(el, "departmentId").value).toBe("");
  await change(el, "departmentId", { value: "restaurant" });
  expect(checkedColour(el)).toBe("grey");
  await change(el, "departmentId", { value: "bar" });
  expect(checkedColour(el)).toBe("amber");
  await change(el, "colour", { value: "blue" });
  await change(el, "departmentId", { value: "restaurant" });
  expect(checkedColour(el)).toBe("blue");
});

it("a missing department marks the field after Save and keeps Save disabled until chosen", async () => {
  const el = await mountAdd(departments);
  await change(el, "name", { value: "Dinner" });
  await change(el, "menuId", { value: "lunch" });
  save(el).click();
  await el.updateComplete;
  expect(field(el, "departmentId").error).toBe("Choose a department.");
  expect(save(el).disabled).toBe(true);
  await change(el, "departmentId", { value: "bar" });
  expect(field(el, "departmentId").error).toBe("");
  expect(save(el).disabled).toBe(false);
});

it("a chosen department dropped from the list counts as no choice: Save marks it, keeps the other values and stays disabled until one is chosen", async () => {
  const el = await mountAdd(departments);
  const writes: { departmentId?: string }[] = [];
  el.addEventListener("period-save", (e) => writes.push((e as CustomEvent).detail));
  await change(el, "departmentId", { value: "bar" });
  await change(el, "name", { value: "Dinner" });
  await change(el, "menuId", { value: "lunch" });
  el.departments = [departments[0]!];
  await el.updateComplete;
  save(el).click();
  await el.updateComplete;
  expect(writes).toEqual([]);
  expect(field(el, "departmentId").error).toBe("Choose a department.");
  expect(save(el).disabled).toBe(true);
  expect(field(el, "name").value).toBe("Dinner");
  expect(field(el, "menuId").value).toBe("lunch");
  await change(el, "departmentId", { value: "restaurant" });
  expect(save(el).disabled).toBe(false);
  save(el).click();
  await el.updateComplete;
  expect(writes.map(({ departmentId }) => departmentId)).toEqual(["restaurant"]);
});

it("a department.not_found refusal for the chosen department shows under Department, and choosing again clears it", async () => {
  const el = await mountAdd(departments);
  await change(el, "departmentId", { value: "bar" });
  await change(el, "name", { value: "Dinner" });
  await change(el, "menuId", { value: "lunch" });
  save(el).click();
  el.refusal = { code: "department.not_found", params: { departmentId: "bar" } };
  await el.updateComplete;
  const bottom = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error;
  expect(field(el, "departmentId").error).toBe("This department no longer exists.");
  expect(bottom()).not.toContain("This department no longer exists.");
  expect(field(el, "name").error).toBe("");
  await change(el, "departmentId", { value: "restaurant" });
  expect(field(el, "departmentId").error).toBe("");
  expect(bottom()).toBe("");
});
