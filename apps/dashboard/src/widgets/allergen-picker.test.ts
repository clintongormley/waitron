import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-allergen-picker` so `mountWidget` can create it.
import { AllergenPicker } from "./allergen-picker.js";

afterEach(cleanupWidgets);

/** Flip the "Revisado" switch by dispatching the wt-switch's own composed `wt-change`. */
async function setReviewed(el: AllergenPicker, checked: boolean): Promise<void> {
  const sw = el.shadowRoot!.querySelector<HTMLElement>("[data-test=reviewed]")!;
  sw.dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

/** Set one allergen's presence via its native `<select>`. */
async function setPresence(el: AllergenPicker, code: string, presence: string): Promise<void> {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=presence-${code}]`)!;
  select.value = presence;
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

/** Type into one allergen's free-text source via its wt-input's composed `wt-change`. */
async function setSource(el: AllergenPicker, code: string, value: string): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=source-${code}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}

describe("allergen-picker", () => {
  // The three-state invariant (design §7): the "Revisado" toggle OFF is the PENDING state — the
  // declaration is `null` no matter what the per-code controls hold, and those controls are disabled.
  it("is null (PENDING) while Revisado is off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    expect(el.value).toBe(null);
  });

  it("disables the per-code controls while Revisado is off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=presence-gluten]")!;
    expect(select.disabled).toBe(true);
  });

  // Toggle ON with no code marked is the REVIEWED-NONE state: `{}`, distinct from `null`. Fourteen
  // blank cells while reviewed must NEVER silently mean allergen-free — this is the exact `{}` vs
  // `null` distinction the till renders.
  it("is {} (reviewed, none declared) when toggled on with no code marked", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    expect(el.value).toEqual({});
  });

  it("enables the per-code controls once Revisado is on", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=presence-gluten]")!;
    expect(select.disabled).toBe(false);
  });

  // The DECLARED state: a code marked `contains` with a free-text source produces exactly the
  // `AllergenEntry` shape the server's `validateAllergens` authority accepts.
  it("declares a marked allergen with its presence and source", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await setPresence(el, "gluten", "contains");
    await setSource(el, "gluten", "trigo");
    expect(el.value).toEqual({ gluten: { presence: "contains", source: "trigo" } });
  });

  // A marked code with no source omits the optional `source` key entirely (not `source: ""`), so the
  // shape matches `AllergenEntry` with `source?` absent.
  it("omits an empty source", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await setPresence(el, "milk", "may_contain");
    expect(el.value).toEqual({ milk: { presence: "may_contain" } });
  });

  // Toggling back OFF collapses to PENDING regardless of any per-code entries already set.
  it("returns to null when Revisado is switched back off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await setPresence(el, "gluten", "contains");
    await setReviewed(el, false);
    expect(el.value).toBe(null);
  });

  // The widget announces every change with a semantic `allergens-changed { value }` event, so the
  // product form can assemble the create/update body without reaching into the picker's internals.
  it("emits allergens-changed carrying the new value", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    const seen = new Promise<CustomEvent<{ value: unknown }>>((resolve) =>
      el.addEventListener("allergens-changed", (e) => resolve(e as CustomEvent), { once: true }),
    );
    await setReviewed(el, true);
    const event = await seen;
    expect(event.detail.value).toEqual({});
  });

  // allergens-changed must escape this widget's shadow boundary to reach the product form, so it is
  // dispatched bubbles+composed — asserted so a future edit does not quietly drop either.
  it("emits allergens-changed as a bubbling, composed event", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    const seen = new Promise<Event>((resolve) =>
      el.addEventListener("allergens-changed", resolve, { once: true }),
    );
    await setReviewed(el, true);
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // All 14 EU-1169/2011 Annex II codes are offered, in the till's display order (redefined locally,
  // no @waitron/catalogue runtime import — the #70 bundle rule).
  it("offers all fourteen EU allergen codes", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    const codes = [...el.shadowRoot!.querySelectorAll("[data-test^=presence-]")].map((s) =>
      s.getAttribute("data-test")!.replace("presence-", ""),
    );
    expect(codes).toEqual([
      "gluten",
      "crustaceans",
      "eggs",
      "fish",
      "peanuts",
      "soybeans",
      "milk",
      "nuts",
      "celery",
      "mustard",
      "sesame",
      "sulphites",
      "lupin",
      "molluscs",
    ]);
  });
});
