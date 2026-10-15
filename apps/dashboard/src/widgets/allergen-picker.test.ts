import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/domain.js";
import { AllergenPicker } from "./allergen-picker.js";

afterEach(cleanupWidgets);

async function setReviewed(el: AllergenPicker, checked: boolean): Promise<void> {
  const sw = el.shadowRoot!.querySelector<HTMLElement>("[data-test=reviewed]")!;
  sw.dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

async function addAllergen(el: AllergenPicker, code: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="choose-${code}"]`)!.click();
  await el.updateComplete;
}

describe("allergen-picker", () => {
  it("shows a selected allergen by name without a precautionary presence control", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { milk: {} },
    });
    expect(el.shadowRoot!.querySelector("#name-milk")!.textContent).toBe(
      allergenName("milk", "es-ES"),
    );
    expect(el.shadowRoot!.querySelector("wt-combobox")).toBeNull();
    expect(el.value).toEqual({ milk: {} });
  });

  it("names a selected kind in its row and remove action", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { gluten: { kinds: ["wheat"] }, milk: {} },
    });
    expect(el.shadowRoot!.querySelector('[id="name-gluten:wheat"]')!.textContent).toBe(
      "Cereales con gluten (Trigo)",
    );
    expect(
      el.shadowRoot!.querySelector('[data-test="remove-gluten:wheat"]')!.getAttribute("aria-label"),
    ).toContain("Trigo");
    expect(
      el.shadowRoot!.querySelector('[data-test="remove-milk"]')!.getAttribute("aria-label"),
    ).toContain("Leche");
  });

  it("is null (PENDING) while Revisado is off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    expect(el.value).toBe(null);
  });

  it("disables the per-code controls while Revisado is off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    expect(el.shadowRoot!.querySelectorAll("[data-test^=presence-]")).toHaveLength(0);
    const add = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=add-allergen]",
    )!;
    expect(add.disabled).toBe(true);
  });

  it("is {} (reviewed, none declared) when toggled on with no code marked", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    expect(el.value).toEqual({});
  });

  it("enables removal once Revisado is on", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "gluten:wheat");
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        '[data-test="remove-gluten:wheat"]',
      )!.disabled,
    ).toBe(false);
  });

  it("declares the cereal selected explicitly", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "gluten:wheat");
    expect(el.value).toEqual({ gluten: { kinds: ["wheat"] } });
  });

  it("stores an ordinary allergen as an empty entry", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "milk");
    expect(el.value).toEqual({ milk: {} });
  });

  it("returns to null when Revisado is switched back off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "gluten:wheat");
    await setReviewed(el, false);
    expect(el.value).toBe(null);
  });

  it("emits wt-allergens-change carrying the new value", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    const seen = new Promise<CustomEvent<{ value: unknown }>>((resolve) =>
      el.addEventListener("wt-allergens-change", (e) => resolve(e as CustomEvent), { once: true }),
    );
    await setReviewed(el, true);
    const event = await seen;
    expect(event.detail.value).toEqual({});
  });

  it("emits wt-allergens-change as a bubbling, composed event", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    const seen = new Promise<Event>((resolve) =>
      el.addEventListener("wt-allergens-change", resolve, { once: true }),
    );
    await setReviewed(el, true);
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("seeds the PENDING state (null) from a null declaration", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: null,
    });
    const sw = el.shadowRoot!.querySelector<HTMLInputElement & { checked: boolean }>(
      "[data-test=reviewed]",
    )!;
    expect(sw.checked).toBe(false);
    expect(el.value).toBe(null);
  });

  it("seeds the reviewed-none state ({}) from an empty declaration", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {},
    });
    const sw = el.shadowRoot!.querySelector<HTMLInputElement & { checked: boolean }>(
      "[data-test=reviewed]",
    )!;
    expect(sw.checked).toBe(true);
    expect(el.value).toEqual({});
  });

  it("seeds reviewed-on with per-code entries from a populated declaration", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {
        gluten: { kinds: ["wheat" as const] },
        milk: {},
      },
    });
    const sw = el.shadowRoot!.querySelector<HTMLInputElement & { checked: boolean }>(
      "[data-test=reviewed]",
    )!;
    expect(sw.checked).toBe(true);
    expect(el.shadowRoot!.querySelector('[id="name-gluten:wheat"]')!.textContent).toBe(
      "Cereales con gluten (Trigo)",
    );
    expect(el.shadowRoot!.querySelector("[data-test=source-gluten]")).toBeNull();
    expect(el.value).toEqual({
      gluten: { kinds: ["wheat" as const] },
      milk: {},
    });
  });

  it("keeps the per-code controls editable after seeding", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { gluten: { kinds: ["wheat" as const] } },
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-gluten:wheat"]')!.click();
    await el.updateComplete;
    expect(el.value).toEqual({});
  });

  it("renders each allergen code's localised display name in the name cell", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "eggs");
    await addAllergen(el, "milk");
    const eggs = el.shadowRoot!.querySelector("#name-eggs")!;
    expect(eggs.textContent!.trim()).toBe(allergenName("eggs", "es-ES"));
    expect(eggs.textContent!.trim()).not.toBe("eggs");
    const milk = el.shadowRoot!.querySelector("#name-milk")!;
    expect(milk.textContent!.trim()).toBe(allergenName("milk", "es-ES"));
  });

  it("labels kinds with localised text while keeping their wire values", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {},
    });
    await openPicker(el);
    expect(
      el.shadowRoot!.querySelector('[data-test="choose-gluten:kamut"]')!.textContent!.trim(),
    ).toBe("Cereales con gluten (Trigo khorasan)");
    expect(
      el.shadowRoot!.querySelector('[data-test="choose-nuts:pistachios"]')!.textContent!.trim(),
    ).toBe("Frutos de cáscara (Pistachos)");
  });

  it("offers all fourteen EU allergen codes", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
    await el.updateComplete;
    const codes = [
      ...new Set(
        [...el.shadowRoot!.querySelectorAll("[data-test^=choose-]")].map(
          (s) => s.getAttribute("data-test")!.replace("choose-", "").split(":")[0],
        ),
      ),
    ];
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

function trackChanges(el: AllergenPicker): unknown[] {
  const values: unknown[] = [];
  el.addEventListener("wt-allergens-change", (event) => {
    values.push((event as CustomEvent).detail.value);
  });
  return values;
}

async function openPicker(el: AllergenPicker): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
  await el.updateComplete;
}

describe("allergen-picker guards", () => {
  it("ignores removals while Revisado is off and keeps all kinds", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { gluten: { kinds: ["wheat", "barley"] }, milk: {} },
    });
    await setReviewed(el, false);
    const changes = trackChanges(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-gluten:wheat"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await el.updateComplete;
    expect(changes).toEqual([]);
    await setReviewed(el, true);
    expect(el.value).toEqual({ gluten: { kinds: ["wheat", "barley"] }, milk: {} });
  });

  it("shows the stored kinds again after switching review off and on", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { nuts: { kinds: ["walnuts"] } },
    });
    await setReviewed(el, false);
    await setReviewed(el, true);
    expect(el.value).toEqual({ nuts: { kinds: ["walnuts"] } });
    expect(el.shadowRoot!.querySelector('[id="name-nuts:walnuts"]')!.textContent).toBe(
      "Frutos de cáscara (Nueces)",
    );
  });

  it("does not open the picker while Revisado is off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    const state = vi.fn();
    el.addEventListener("wt-picker-state", state);
    await openPicker(el);
    expect(state).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=allergen-search]")).toBeNull();
  });

  it("adds an allergen once when its choice is clicked twice before the picker closes", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {},
    });
    await openPicker(el);
    const changes = trackChanges(el);
    const milk = el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-milk]")!;
    milk.click();
    milk.click();
    await el.updateComplete;
    expect(changes).toEqual([{ milk: {} }]);
  });

  it("ignores a choice made after Revisado was switched off with the picker open", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {},
    });
    await openPicker(el);
    await setReviewed(el, false);
    const changes = trackChanges(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-milk]")!.click();
    await el.updateComplete;
    expect(changes).toEqual([]);
    await setReviewed(el, true);
    expect(el.value).toEqual({});
  });

  it("finds every word in any order, ignoring accents, in the language shown, closest first", async () => {
    const before = currentLocale();
    onTestFinished(() => setLocale(before));
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {},
    });
    await openPicker(el);
    const offered = async (value: string) => {
      el.shadowRoot!.querySelector("[data-test=allergen-search]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      return [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test^=choose-]")].map(
        (choice) => choice.dataset.test!.slice("choose-".length),
      );
    };
    setLocale("es-ES");
    expect(await offered("cascara frutos")).toEqual([
      "nuts:walnuts",
      "nuts:pecans",
      "nuts:almonds",
      "nuts:hazelnuts",
      "nuts:cashews",
      "nuts:pistachios",
      "nuts:brazil_nuts",
      "nuts:macadamia",
    ]);
    expect(await offered("&")).toEqual([]);
    setLocale("en-GB");
    expect(await offered("frutos")).toEqual([]);
    expect((await offered("nuts")).map((x) => x.split(":")[0])).toEqual([
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "peanuts",
    ]);
    expect((await offered("nut")).map((x) => x.split(":")[0])).toEqual([
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "nuts",
      "peanuts",
    ]);
    expect(await offered("nut ")).toEqual([]);
  });

  it("says no allergen matches a search that finds none", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {},
    });
    await openPicker(el);
    const choices = el.shadowRoot!.querySelector(".choices")!;
    expect(choices.textContent).not.toContain(t("allergen.no_matches"));
    el.shadowRoot!.querySelector("[data-test=allergen-search]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "zzz" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=choose-]")).toHaveLength(0);
    expect(el.shadowRoot!.querySelector(".choices")!.textContent).toContain(
      t("allergen.no_matches"),
    );
  });

  // The picker opens inside the product editor, whose own keydown handling must not act on keys
  // typed into the allergen search.
  it("keeps keys pressed inside the picker from reaching the host", async () => {
    const { el, host } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: {},
    });
    const keys = vi.fn();
    host.addEventListener("keydown", keys);
    await openPicker(el);
    el.shadowRoot!.querySelector("[data-test=allergen-search]")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(keys).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector("[data-test=reviewed]")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(keys).toHaveBeenCalledOnce();
  });
});
