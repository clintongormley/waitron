import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { UnitForm } from "./unit-form.js";
import "./unit-form.js";

afterEach(cleanupWidgets);

function change(el: UnitForm, testId: string, value: string): void {
  const field = el.shadowRoot!.querySelector(`[data-test=${testId}]`)!;
  if (field instanceof HTMLSelectElement) {
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    field.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  }
}

describe("unit-form", () => {
  it("offers precision as exactly 0, 1, 2 or 3", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["en"],
    });

    const precision = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=precision]")!;
    expect(precision).not.toBeNull();
    expect([...precision.options].map((option) => option.value)).toEqual(["0", "1", "2", "3"]);
  });

  it("returns a canonical input without mutating the supplied unit", async () => {
    const value = {
      id: "u1",
      name: { es: "caja", en: "box", fr: "boîte" },
      abbreviation: { es: "cj", en: "bx", fr: "bt" },
      precision: 0,
    };
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es", "en"],
      value,
    });
    change(el, "name-es", " caja nueva ");
    change(el, "precision", "2");
    await el.updateComplete;

    const submitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("wt-submit", (event) => resolve(event as CustomEvent), { once: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    const event = await submitted;

    expect(event.detail).toEqual({
      value: {
        name: { es: "caja nueva", en: "box", fr: "boîte" },
        abbreviation: { es: "cj", en: "bx", fr: "bt" },
        precision: 2,
      },
    });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(value).toEqual({
      id: "u1",
      name: { es: "caja", en: "box", fr: "boîte" },
      abbreviation: { es: "cj", en: "bx", fr: "bt" },
      precision: 0,
    });
  });

  it("marks the default name, abbreviation and precision as required and explains every error", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es", "en"],
    });
    change(el, "precision", "");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await el.updateComplete;

    expect(
      el.shadowRoot!.querySelector("wt-form-error-summary")!.shadowRoot!.querySelectorAll("li"),
    ).toHaveLength(3);
    expect(el.shadowRoot!.querySelector("[data-test=name-es]")!.hasAttribute("required")).toBe(
      true,
    );
    expect(el.shadowRoot!.querySelector("[data-test=name-en]")!.hasAttribute("required")).toBe(
      false,
    );
    expect(
      el.shadowRoot!.querySelector("[data-test=abbreviation-es]")!.hasAttribute("required"),
    ).toBe(true);
    expect(
      el.shadowRoot!.querySelector("[data-test=abbreviation-en]")!.hasAttribute("required"),
    ).toBe(false);
  });

  it("emits the abbreviation with the submitted unit", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["en"],
    });
    change(el, "name-en", "box");
    change(el, "abbreviation-en", " bx ");
    change(el, "precision", "0");
    await el.updateComplete;

    const submitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("wt-submit", (event) => resolve(event as CustomEvent), { once: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    const event = await submitted;

    expect(event.detail.value.abbreviation).toEqual({ en: "bx" });
  });

  it("blocks submit with a blank default-language abbreviation", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["en"],
    });
    change(el, "name-en", "box");
    change(el, "precision", "0");

    let submitted = false;
    el.addEventListener("wt-submit", () => (submitted = true), { once: true });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await el.updateComplete;

    expect(submitted).toBe(false);
    expect(
      el.shadowRoot!.querySelector("[data-test=abbreviation-en]")!.getAttribute("error"),
    ).not.toBe("");
  });

  it("emits the shared cancel event and disables actions while busy", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      busy: true,
      locales: ["es"],
    });
    expect(el.shadowRoot!.querySelector("[data-test=submit]")!.hasAttribute("disabled")).toBe(true);

    el.busy = false;
    await el.updateComplete;
    const cancelled = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("wt-cancel", (event) => resolve(event as CustomEvent), { once: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    const event = await cancelled;
    expect(event.detail).toEqual({});
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("initializes an open edit form when its locales arrive after mounting", async () => {
    const value = { id: "u1", name: { es: "caja" }, abbreviation: { es: "cj" }, precision: 2 };
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: [],
      value,
    });
    el.locales = ["es"];
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-test=name-es]")!.value,
    ).toBe("caja");
  });
});
