import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { IngredientForm, ingredientRefusalErrors } from "./ingredient-form.js";
import type { AllergenDeclaration, DietaryOrigin, Ingredient } from "../api/client.js";

afterEach(cleanupWidgets);

function baseProps(overrides: Partial<IngredientForm> = {}): Partial<IngredientForm> {
  return { open: true, ...overrides };
}

async function openedDialog(el: IngredientForm): Promise<HTMLDialogElement> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

async function setInput(el: IngredientForm, testId: string, value: string): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}

async function setSwitch(el: IngredientForm, testId: string, checked: boolean): Promise<void> {
  const sw = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  sw.dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

async function emitAllergens(el: IngredientForm, value: AllergenDeclaration): Promise<void> {
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
  picker.dispatchEvent(
    new CustomEvent("wt-allergens-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function emitOrigin(el: IngredientForm, origin: DietaryOrigin | null): Promise<void> {
  const picker = el.shadowRoot!.querySelector("dashboard-dietary-origin-picker")!;
  picker.dispatchEvent(
    new CustomEvent("origin-changed", { detail: { origin }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

function confirm(el: IngredientForm): void {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
}

async function bottomOf(el: IngredientForm): Promise<Element | null> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]");
}

const nameErrorOf = (el: IngredientForm): string | null =>
  el.shadowRoot!.querySelector("[data-test=name]")!.getAttribute("error");

const confirmOf = (el: IngredientForm): HTMLElement =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!;

function nextEvent<T>(el: IngredientForm, type: string): Promise<CustomEvent<T>> {
  return new Promise((resolve) =>
    el.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true }),
  );
}

describe("ingredient-form", () => {
  it("stays closed by default", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {});
    expect((await openedDialog(el)).open).toBe(false);
  });

  it("opens the dialog when open is set", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    expect((await openedDialog(el)).open).toBe(true);
  });

  it("emits create-ingredient with the name and the reviewed allergen map", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Harina de trigo");
    await emitAllergens(el, { gluten: { presence: "contains", source: "trigo" } });

    const created = nextEvent<{ [k: string]: unknown }>(el, "create-ingredient");
    confirm(el);
    const body = (await created).detail;
    expect(body).toEqual({
      name: "Harina de trigo",
      allergens: { gluten: { presence: "contains", source: "trigo" } },
    });
  });

  // An explicit `allergens: null` makes the server throw `allergen.invalid_code`.
  it("omits allergens from the create body when the picker is PENDING", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Sal");

    const created = nextEvent<{ [k: string]: unknown }>(el, "create-ingredient");
    confirm(el);
    const body = (await created).detail;
    expect(body).toEqual({ name: "Sal" });
    expect("allergens" in body).toBe(false);
  });

  it("includes an empty allergens map ({}) in the create body", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Agua");
    await emitAllergens(el, {});
    const created = nextEvent<{ [k: string]: unknown }>(el, "create-ingredient");
    confirm(el);
    const body = (await created).detail;
    expect("allergens" in body).toBe(true);
    expect(body.allergens).toEqual({});
  });

  it("includes the selected dietary origin in the create body", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Ternera");
    await emitOrigin(el, "meat");
    const created = nextEvent<{ [k: string]: unknown }>(el, "create-ingredient");
    confirm(el);
    const body = (await created).detail;
    expect(body).toEqual({ name: "Ternera", dietaryOrigin: "meat" });
  });

  it("omits dietaryOrigin from the create body when left uncategorised", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Sal");
    const created = nextEvent<{ [k: string]: unknown }>(el, "create-ingredient");
    confirm(el);
    const body = (await created).detail;
    expect("dietaryOrigin" in body).toBe(false);
  });

  it("blocks confirm and shows the name's error under it and one message beside Create", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    let fired = false;
    el.addEventListener("create-ingredient", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
    expect(nameErrorOf(el)).toBe(codeMessage("ingredient.name_required", "es-ES"));
    expect(nameErrorOf(el)).not.toContain("ingredient.name_required");
    const alert = await bottomOf(el);
    expect(alert).not.toBe(null);
    expect(alert!.getAttribute("role")).toBe("alert");
    expect(alert!.textContent).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBe(null);
  });

  it("treats a whitespace-only name as empty", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "   ");
    let fired = false;
    el.addEventListener("create-ingredient", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
  });

  it("clears the name error once the operator types a name", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    confirm(el);
    await el.updateComplete;
    expect(nameErrorOf(el)).not.toBe("");
    expect(await bottomOf(el)).not.toBe(null);
    await setInput(el, "name", "Sal");
    expect(nameErrorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe(null);
  });

  it("marks the name required and gives it a semantic name", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    const name = el.shadowRoot!.querySelector("[data-test=name]")!;
    expect(name.hasAttribute("required")).toBe(true);
    expect(name.getAttribute("name")).toBe("name");
  });

  it("says nothing about errors before the first submission, and Create works", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "");
    expect(nameErrorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe(null);
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("on an invalid submission focuses the name and disables Create until it is fixed", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    confirm(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    const name = el.shadowRoot!.querySelector("[data-test=name]")!;
    expect(name.shadowRoot!.activeElement).toBe(name.shadowRoot!.querySelector("input"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    await setInput(el, "name", "  ");
    expect(nameErrorOf(el)).toBe(codeMessage("ingredient.name_required", "es-ES"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    await setInput(el, "name", "Sal");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
    const created = nextEvent(el, "create-ingredient");
    confirm(el);
    expect((await created).detail).toEqual({ name: "Sal" });
  });

  it("starts again when reopened: no messages and Create working", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    confirm(el);
    await el.updateComplete;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(nameErrorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe(null);
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("emits create-ingredient as a bubbling, composed event", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Sal");
    const seen = nextEvent(el, "create-ingredient");
    confirm(el);
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // ── Edit mode ─────────────────────────────────────────────────────────────────────────────────

  const EDIT_INGREDIENT: Ingredient = {
    id: "ing-1",
    name: "Leche entera",
    allergens: { milk: { presence: "contains" } },
    dietaryOrigin: "dairy",
    active: false,
  };

  it("pre-fills the name, active switch, allergen picker and origin picker from a passed ingredient", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: EDIT_INGREDIENT,
    });
    await el.updateComplete;
    const name = el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=name]")!;
    const active = el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(
      "[data-test=active]",
    )!;
    expect(name.value).toBe("Leche entera");
    expect(active.checked).toBe(false);
    const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const reviewed = picker.shadowRoot!.querySelector<HTMLInputElement & { checked: boolean }>(
      "[data-test=reviewed]",
    )!;
    expect(reviewed.checked).toBe(true);
    const origin = el.shadowRoot!.querySelector("dashboard-dietary-origin-picker")!;
    await (origin as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const sel = origin.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=origin]")!;
    expect(sel.value).toBe("dairy");
  });

  it("emits update-ingredient with the id and a patch of name+active+allergens+dietaryOrigin in edit mode", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: EDIT_INGREDIENT,
    });
    await el.updateComplete;
    const updated = nextEvent<{ id: string; patch: Record<string, unknown> }>(
      el,
      "update-ingredient",
    );
    confirm(el);
    const detail = (await updated).detail;
    expect(detail.id).toBe("ing-1");
    expect(detail.patch).toEqual({
      name: "Leche entera",
      active: false,
      allergens: { milk: { presence: "contains" } },
      dietaryOrigin: "dairy",
    });
  });

  it("reflects an origin change in the edit patch", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: EDIT_INGREDIENT,
    });
    await el.updateComplete;
    await emitOrigin(el, "meat");
    const updated = nextEvent<{ patch: { dietaryOrigin: unknown } }>(el, "update-ingredient");
    confirm(el);
    expect((await updated).detail.patch.dietaryOrigin).toBe("meat");
  });

  it("sends dietaryOrigin: null in an edit patch to uncategorise", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: EDIT_INGREDIENT,
    });
    await el.updateComplete;
    await emitOrigin(el, null);
    const updated = nextEvent<{ patch: { dietaryOrigin: unknown } }>(el, "update-ingredient");
    confirm(el);
    const patch = (await updated).detail.patch;
    expect("dietaryOrigin" in patch).toBe(true);
    expect(patch.dietaryOrigin).toBeNull();
  });

  it("reflects an active toggle in the edit patch", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: EDIT_INGREDIENT, // starts inactive (active: false)
    });
    await el.updateComplete;
    await setSwitch(el, "active", true);
    const updated = nextEvent<{ patch: { active: unknown } }>(el, "update-ingredient");
    confirm(el);
    expect((await updated).detail.patch.active).toBe(true);
  });

  it("does not render the active switch in create mode", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    expect(el.shadowRoot!.querySelector("[data-test=active]")).toBe(null);
  });

  it("sends allergens: null in an edit patch to clear the declaration", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: EDIT_INGREDIENT,
    });
    await el.updateComplete;
    await emitAllergens(el, null);
    const updated = nextEvent<{ patch: { allergens: unknown } }>(el, "update-ingredient");
    confirm(el);
    const patch = (await updated).detail.patch;
    expect("allergens" in patch).toBe(true);
    expect(patch.allergens).toBe(null);
  });

  it("carries allergens: null in the patch when editing a PENDING ingredient untouched", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: {
        id: "ing-2",
        name: "Azúcar",
        allergens: null,
        dietaryOrigin: null,
        active: true,
      },
    });
    await el.updateComplete;
    const updated = nextEvent<{ patch: { allergens: unknown } }>(el, "update-ingredient");
    confirm(el);
    const patch = (await updated).detail.patch;
    expect(patch.allergens).toBe(null);
  });

  // ── Dialog dismissal + single-flight ──────────────────────────────────────────────────────────

  it("resets open to false when the dialog is closed (wt-close)", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    const nativeDialog = await openedDialog(el);
    expect(nativeDialog.open).toBe(true);
    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;
    expect(el.open).toBe(false);
  });

  it("ignores a confirm while busy (single-flight)", async () => {
    const { el } = await mountWidget<IngredientForm>(
      "dashboard-ingredient-form",
      baseProps({ busy: true }),
    );
    await setInput(el, "name", "Sal");
    let fired = false;
    el.addEventListener("create-ingredient", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
  });
});

it("Enter saves an edit with the current name and respects busy", async () => {
  const ingredient: Ingredient = {
    id: "i1",
    name: "Salt",
    active: true,
    allergens: null,
    dietaryOrigin: null,
  };
  const { el } = await mountWidget<IngredientForm>(
    "dashboard-ingredient-form",
    baseProps({ ingredient }),
  );
  const updates: unknown[] = [];
  el.addEventListener("update-ingredient", (e) => updates.push((e as CustomEvent).detail));
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "Sea salt";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  input.focus();
  await userEvent.keyboard("{Enter}");
  expect(updates).toEqual([
    { id: "i1", patch: { name: "Sea salt", active: true, allergens: null, dietaryOrigin: null } },
  ]);
  el.busy = true;
  await el.updateComplete;
  input.focus();
  await userEvent.keyboard("{Enter}");
  expect(updates).toHaveLength(1);
});

describe("ingredient-form — a server refusal", () => {
  it("keys a refusal by the field it names, and anything else to the form", () => {
    const named = { code: "management.request_invalid", params: { field: "name" } };
    expect(ingredientRefusalErrors(named)).toEqual({
      name: codeMessage("management.request_invalid"),
    });
    expect(ingredientRefusalErrors({ code: "allergen.invalid_code", params: {} })).toEqual({
      _form: codeMessage("allergen.invalid_code"),
    });
    expect(
      ingredientRefusalErrors({ code: "management.request_invalid", params: { field: "active" } }),
    ).toEqual({ _form: codeMessage("management.request_invalid") });
    expect(ingredientRefusalErrors({})).toEqual({ _form: codeMessage("server.internal") });
  });

  it("shows a refused name under it, focuses it, and leaves Create working", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Sal");
    el.fieldErrors = { name: "Refused name" };
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(nameErrorOf(el)).toBe("Refused name");
    expect((await bottomOf(el))?.textContent).toBe(t("form.fix_fields"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
    const name = el.shadowRoot!.querySelector("[data-test=name]")!;
    expect(name.shadowRoot!.activeElement).toBe(name.shadowRoot!.querySelector("input"));

    await setInput(el, "name", "Sal fina");
    expect(nameErrorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe(null);
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("says a refusal naming no field beside Create, leaves Create working, and drops it on the next submit", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Sal");
    el.fieldErrors = { _form: codeMessage("server.internal") };
    await el.updateComplete;

    expect(nameErrorOf(el)).toBe("");
    const bottom = await bottomOf(el);
    expect(bottom?.getAttribute("role")).toBe("alert");
    expect(bottom?.textContent).toBe(codeMessage("server.internal"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

    const created = nextEvent(el, "create-ingredient");
    confirm(el);
    expect((await created).detail).toEqual({ name: "Sal" });
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(null);
  });

  it("says a refusal and the field errors one after the other when they meet", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    el.fieldErrors = { _form: codeMessage("server.internal") };
    await el.updateComplete;
    await setInput(el, "name", "");
    confirm(el);
    await el.updateComplete;
    // The submit drops the old refusal; the name's own error remains.
    expect((await bottomOf(el))?.textContent).toBe(t("form.fix_fields"));

    el.fieldErrors = { _form: codeMessage("server.internal") };
    await el.updateComplete;
    expect((await bottomOf(el))?.textContent).toBe(
      `${codeMessage("server.internal")} ${t("form.fix_fields")}`,
    );
  });
});
