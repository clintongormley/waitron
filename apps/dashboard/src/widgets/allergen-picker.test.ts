import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import { allergenName } from "../i18n/domain.js";
import { AllergenPicker } from "./allergen-picker.js";

afterEach(cleanupWidgets);

async function setReviewed(el: AllergenPicker, checked: boolean): Promise<void> {
  const sw = el.shadowRoot!.querySelector<HTMLElement>("[data-test=reviewed]")!;
  sw.dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

async function setPresence(el: AllergenPicker, code: string, presence: string): Promise<void> {
  await chooseOption(el.shadowRoot!.querySelector(`[data-test=presence-${code}]`)!, presence);
  await el.updateComplete;
}

async function addAllergen(el: AllergenPicker, code: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=choose-${code}]`)!.click();
  await el.updateComplete;
}

type PresenceBox = HTMLElement & {
  value: string;
  label: string;
  hideLabel: boolean;
  search: string;
  disabled: boolean;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

const presenceBox = (el: AllergenPicker, code: string): PresenceBox =>
  el.shadowRoot!.querySelector<PresenceBox>(`wt-combobox[name="allergen-${code}-presence"]`)!;

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownPresence(el: AllergenPicker, code: string): Promise<string | undefined> {
  const box = presenceBox(el, code);
  await box.updateComplete;
  return box.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

describe("allergen-picker", () => {
  it("picks each allergen's presence from a shared dropdown named by the allergen", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { milk: { presence: "may_contain" } },
    });
    const box = presenceBox(el, "milk");
    expect(box).not.toBeNull();
    expect(box.label).toBe(allergenName("milk", "es-ES"));
    expect(box.hideLabel).toBe(true);
    expect(box.search).toBe("auto");
    expect(box.options).toEqual([
      { value: "contains", label: t("allergen.contains", "es-ES") },
      { value: "may_contain", label: t("allergen.may_contain", "es-ES") },
    ]);
    expect(box.value).toBe("may_contain");
    expect(await shownPresence(el, "milk")).toBe(t("allergen.may_contain", "es-ES"));
    const changes: unknown[] = [];
    el.addEventListener("wt-allergens-change", (event) =>
      changes.push((event as CustomEvent).detail.value),
    );
    await chooseOption(box, "contains");
    expect(changes).toEqual([{ milk: { presence: "contains" } }]);
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

  it("enables the per-code controls once Revisado is on", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "gluten");
    const select = presenceBox(el, "gluten");
    expect(select.disabled).toBe(false);
  });

  it("declares a selected allergen with its presence", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "gluten");
    await setPresence(el, "gluten", "contains");
    expect(el.value).toEqual({ gluten: { presence: "contains" } });
  });

  it("omits an empty source", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "milk");
    await setPresence(el, "milk", "may_contain");
    expect(el.value).toEqual({ milk: { presence: "may_contain" } });
  });

  it("returns to null when Revisado is switched back off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "gluten");
    await setPresence(el, "gluten", "contains");
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
        gluten: { presence: "contains", source: "trigo" },
        milk: { presence: "may_contain" },
      },
    });
    const sw = el.shadowRoot!.querySelector<HTMLInputElement & { checked: boolean }>(
      "[data-test=reviewed]",
    )!;
    expect(sw.checked).toBe(true);
    const gluten = presenceBox(el, "gluten");
    expect(gluten.value).toBe("contains");
    expect(await shownPresence(el, "gluten")).toBe(t("allergen.contains", "es-ES"));
    expect(el.shadowRoot!.querySelector("[data-test=source-gluten]")).toBeNull();
    expect(el.value).toEqual({
      gluten: { presence: "contains" },
      milk: { presence: "may_contain" },
    });
  });

  it("keeps the per-code controls editable after seeding", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { gluten: { presence: "contains", source: "trigo" } },
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-gluten]")!.click();
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

  it("labels the presence options with localised text, keeping the wire values", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    await addAllergen(el, "gluten");
    const options = presenceBox(el, "gluten").options;
    const byValue = (v: string) => options.find((o) => o.value === v)!;
    expect(byValue("contains").label).toBe(t("allergen.contains", "es-ES"));
    expect(byValue("may_contain").label).toBe(t("allergen.may_contain", "es-ES"));
    expect(byValue("contains").value).toBe("contains");
    expect(byValue("may_contain").value).toBe("may_contain");
    expect(options.map((o) => o.value)).toEqual(["contains", "may_contain"]);
  });

  it("offers all fourteen EU allergen codes", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {});
    await setReviewed(el, true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
    await el.updateComplete;
    const codes = [...el.shadowRoot!.querySelectorAll("[data-test^=choose-]")].map((s) =>
      s.getAttribute("data-test")!.replace("choose-", ""),
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
  it("ignores presence changes and removals while Revisado is off, and keeps the entry", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { milk: { presence: "contains" } },
    });
    await setReviewed(el, false);
    const changes = trackChanges(el);
    await setPresence(el, "milk", "may_contain");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-milk]")!.click();
    await el.updateComplete;
    expect(changes).toEqual([]);
    await setReviewed(el, true);
    expect(el.value).toEqual({ milk: { presence: "contains" } });
  });

  it("shows the stored presence again after a change refused while Revisado is off", async () => {
    const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
      declaration: { milk: { presence: "contains" } },
    });
    await setReviewed(el, false);
    await setPresence(el, "milk", "may_contain");
    await setReviewed(el, true);
    expect(el.value).toEqual({ milk: { presence: "contains" } });
    expect(presenceBox(el, "milk").value).toBe("contains");
    expect(await shownPresence(el, "milk")).toBe(t("allergen.contains", "es-ES"));
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
    expect(changes).toEqual([{ milk: { presence: "contains" } }]);
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
