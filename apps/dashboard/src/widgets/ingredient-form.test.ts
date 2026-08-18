import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-ingredient-form` so `mountWidget` can create it.
import { IngredientForm } from "./ingredient-form.js";
import type { AllergenDeclaration, Ingredient } from "../api/client.js";

afterEach(cleanupWidgets);

/** The base props every mount needs: an open dialog. */
function baseProps(overrides: Partial<IngredientForm> = {}): Partial<IngredientForm> {
  return { open: true, ...overrides };
}

/** The wt-dialog inside the form, once its own first render (which calls showModal) has settled. */
async function openedDialog(el: IngredientForm): Promise<HTMLDialogElement> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

/** Type into a wt-input by its data-test, via the composed `wt-change` it dispatches. */
async function setInput(el: IngredientForm, testId: string, value: string): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}

/** Flip a wt-switch by its data-test, via the composed `wt-change` it dispatches. */
async function setSwitch(el: IngredientForm, testId: string, checked: boolean): Promise<void> {
  const sw = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  sw.dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

/** Announce an allergen declaration from the child picker, as the real picker's event would. */
async function emitAllergens(el: IngredientForm, value: AllergenDeclaration): Promise<void> {
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
  picker.dispatchEvent(
    new CustomEvent("allergens-changed", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Click the footer confirm control. */
function confirm(el: IngredientForm): void {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
}

/** Resolve with the next event of `type` dispatched from the form host. */
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

  // The whole create round-trip: type a name, review the picker with one allergen, confirm — and
  // assert the assembled body carries `{ name, allergens }`.
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

  // The create-vs-patch asymmetry: an explicit `allergens: null` makes the server throw
  // `allergen.invalid_code`, so a PENDING (unreviewed) picker must OMIT the key entirely, not send null.
  it("omits allergens from the create body when the picker is PENDING", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "Sal");

    const created = nextEvent<{ [k: string]: unknown }>(el, "create-ingredient");
    confirm(el);
    const body = (await created).detail;
    expect(body).toEqual({ name: "Sal" });
    expect("allergens" in body).toBe(false);
  });

  // A reviewed-but-none declaration ({}) is NOT PENDING — it must be sent, not omitted.
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

  // A non-empty name is required client-side (the column is NOT NULL; a nameless ingredient is a UI
  // error). An empty name blocks confirm — no event — and shows a `role="alert"` banner.
  it("blocks confirm and shows an error when the name is empty", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    let fired = false;
    el.addEventListener("create-ingredient", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
    const alert = el.shadowRoot!.querySelector("[data-test=error]");
    expect(alert).not.toBe(null);
    expect(alert!.getAttribute("role")).toBe("alert");
    // The banner NEVER leaks the raw wire code (the codes.ts guarantee). The localised copy for
    // `ingredient.name_required` lands in Task 9; until then codeMessage degrades it to the generic
    // sentence — asserting via codeMessage() self-adjusts when Task 9 adds the real copy.
    expect(alert!.textContent).toContain(codeMessage("ingredient.name_required", "es-ES"));
    expect(alert!.textContent).not.toContain("ingredient.name_required");
  });

  // Whitespace-only is still empty.
  it("treats a whitespace-only name as empty", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    await setInput(el, "name", "   ");
    let fired = false;
    el.addEventListener("create-ingredient", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
  });

  // Typing a name after a blocked confirm clears the validation banner — the operator sees the error
  // resolve as they fix it, not linger until the next confirm.
  it("clears the name error once the operator types a name", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    confirm(el); // empty name → error shown
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=error]")).not.toBe(null);
    await setInput(el, "name", "Sal");
    expect(el.shadowRoot!.querySelector("[data-test=error]")).toBe(null);
  });

  // create-ingredient must cross this widget's shadow boundary to reach the recipe screen, so it is
  // dispatched bubbles+composed.
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
    active: false,
  };

  it("pre-fills the name, active switch and allergen picker from a passed ingredient", async () => {
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
    // The allergen picker is seeded via its `declaration` — its reviewed toggle reflects the ingredient.
    const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const reviewed = picker.shadowRoot!.querySelector<HTMLInputElement & { checked: boolean }>(
      "[data-test=reviewed]",
    )!;
    expect(reviewed.checked).toBe(true);
  });

  it("emits update-ingredient with the id and a patch of name+active+allergens in edit mode", async () => {
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
    });
  });

  // The active toggle is edit-only (IngredientInput has no `active`); flipping it in edit mode is
  // reflected in the patch, which is the one route de/reactivation travels.
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

  // The active switch does NOT render in create mode — IngredientInput has no `active`, so a control
  // there would be dead. (It reappears in edit mode, exercised above.)
  it("does not render the active switch in create mode", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", baseProps());
    expect(el.shadowRoot!.querySelector("[data-test=active]")).toBe(null);
  });

  // An edit that clears the allergen review sends `allergens: null` in the patch — LEGAL for a patch
  // (it resets the declaration to PENDING), unlike a create.
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

  // Editing an already-PENDING ingredient and leaving the picker untouched carries `allergens: null`
  // straight through — the reseed→emit path for null (distinct from the create OMIT).
  it("carries allergens: null in the patch when editing a PENDING ingredient untouched", async () => {
    const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
      open: true,
      ingredient: { id: "ing-2", name: "Azúcar", allergens: null, active: true },
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

  // Single-flight: while a create/update round-trip is in flight the screen sets `busy`, and a second
  // confirm is ignored (the mutations are not server-idempotent) — the staff-screen guard shape.
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
