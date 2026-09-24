import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit";
import { setContentLanguages, type WtInput } from "@waitron/ui";
import type { WtSwitch } from "@waitron/ui/src/components/wt-switch.js";
import { MAX_MODIFIER_INTEGER } from "@waitron/catalogue/src/modifier-limits.js";
import {
  type FieldContext,
  isModifierQuantity,
  nameFields,
  nonBlankNames,
  optionalTextFields,
  priceLabel,
  switchField,
  textField,
  translations,
  wholeWithin,
} from "./form-fields.js";

let host: HTMLDivElement;

beforeEach(() => {
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

function context(overrides: Partial<FieldContext> = {}): FieldContext {
  return { busy: false, locales: ["es", "en"], error: () => "", ...overrides };
}

async function renderAll<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  template: TemplateResult | TemplateResult[],
  selector: string,
): Promise<T[]> {
  render(template, host);
  const elements = [...host.querySelectorAll<T>(selector)];
  await Promise.all(elements.map((element) => element.updateComplete));
  return elements;
}

function changeFrom(target: HTMLElement, detail: unknown): boolean {
  let escaped = false;
  const listener = () => {
    escaped = true;
  };
  host.addEventListener("wt-change", listener);
  target.dispatchEvent(new CustomEvent("wt-change", { detail, bubbles: true, composed: true }));
  host.removeEventListener("wt-change", listener);
  return escaped;
}

describe("wholeWithin", () => {
  it.each(["", "1.5", "-1", " 3", "3 ", "1e3", "0x10"])(
    "refuses %j as not plain digits",
    (text) => {
      expect(wholeWithin(text, 0)).toBeNull();
    },
  );

  it("refuses a value below the minimum and accepts the minimum itself", () => {
    expect(wholeWithin("0", 1)).toBeNull();
    expect(wholeWithin("1", 1)).toBe(1);
  });

  it("accepts the integer ceiling and refuses one above it", () => {
    expect(wholeWithin(String(MAX_MODIFIER_INTEGER), 0)).toBe(MAX_MODIFIER_INTEGER);
    expect(wholeWithin(String(MAX_MODIFIER_INTEGER + 1), 0)).toBeNull();
  });

  it("reads leading zeros as the number they spell", () => {
    expect(wholeWithin("007", 0)).toBe(7);
  });
});

describe("isModifierQuantity", () => {
  it("starts at one", () => {
    expect(isModifierQuantity("0")).toBe(false);
    expect(isModifierQuantity("1")).toBe(true);
    expect(isModifierQuantity("2.5")).toBe(false);
  });
});

describe("priceLabel", () => {
  it("names the pricing unit when there is one", () => {
    expect(priceLabel("kg")).toBe("Precio por kg");
  });

  it("falls back to the per-unit label for a blank unit", () => {
    expect(priceLabel("  ")).toBe("Precio por unidad");
    expect(priceLabel("")).toBe("Precio por unidad");
  });
});

describe("nonBlankNames and translations", () => {
  it("drops blank and whitespace-only languages, keeping the entered text as typed", () => {
    expect(nonBlankNames({ es: " Pan ", en: "  ", fr: "" })).toEqual({ es: " Pan " });
  });

  it("is null when nothing was entered in any language", () => {
    expect(translations({ es: "", en: " " })).toBeNull();
    expect(translations({})).toBeNull();
  });

  it("keeps the languages that were entered", () => {
    expect(translations({ es: "Pan", en: "" })).toEqual({ es: "Pan" });
  });
});

describe("textField", () => {
  it("renders the value, label, placeholder, required flag and the field's error", async () => {
    const [input] = await renderAll<WtInput>(
      textField(
        context({ error: (key) => (key === "sku" ? "Bad SKU" : "") }),
        "sku",
        "SKU",
        "A-1",
        () => {},
        true,
        "e.g. A-1",
      ),
      "wt-input",
    );
    expect(input!.name).toBe("sku");
    expect(input!.label).toBe("SKU");
    expect(input!.placeholder).toBe("e.g. A-1");
    expect(input!.value).toBe("A-1");
    expect(input!.required).toBe(true);
    expect(input!.disabled).toBe(false);
    expect(input!.error).toBe("Bad SKU");
    expect(input!.invalid).toBe(true);
  });

  it("is optional, valid and without a placeholder unless told otherwise", async () => {
    const [input] = await renderAll<WtInput>(
      textField(context(), "sku", "SKU", "", () => {}),
      "wt-input",
    );
    expect(input!.required).toBe(false);
    expect(input!.placeholder).toBe("");
    expect(input!.error).toBe("");
    expect(input!.invalid).toBe(false);
  });

  it("is disabled while the form is busy", async () => {
    const [input] = await renderAll<WtInput>(
      textField(context({ busy: true }), "sku", "SKU", "", () => {}),
      "wt-input",
    );
    expect(input!.disabled).toBe(true);
  });

  it("hands an edit to the form and keeps the input's own change event inside it", async () => {
    const change = vi.fn();
    const [input] = await renderAll<WtInput>(
      textField(context(), "sku", "SKU", "", change),
      "wt-input",
    );
    expect(changeFrom(input!, { value: "B-2" })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith("B-2");
  });
});

describe("nameFields", () => {
  it("renders one input per language, requiring only the default language", async () => {
    const inputs = await renderAll<WtInput>(
      nameFields(context(), "name", "Name", { es: "Pan" }, () => {}),
      "wt-input",
    );
    expect(inputs.map((input) => [input.name, input.label, input.value, input.required])).toEqual([
      ["name-es", "Name (es)", "Pan", true],
      ["name-en", "Name (en)", "", false],
    ]);
  });

  it("shows the whole name's error on the default language only", async () => {
    const inputs = await renderAll<WtInput>(
      nameFields(
        context({ error: (key) => (key === "name" ? "Name required" : "") }),
        "name",
        "Name",
        {},
        () => {},
      ),
      "wt-input",
    );
    expect(inputs.map((input) => [input.error, input.invalid])).toEqual([
      ["Name required", true],
      ["", false],
    ]);
  });

  it("prefers a language's own error over the whole name's", async () => {
    const errors: Record<string, string> = {
      name: "Name required",
      "name-es": "Too long",
      "name-en": "Not English",
    };
    const inputs = await renderAll<WtInput>(
      nameFields(context({ error: (key) => errors[key] ?? "" }), "name", "Name", {}, () => {}),
      "wt-input",
    );
    expect(inputs.map((input) => input.error)).toEqual(["Too long", "Not English"]);
  });

  it("is disabled while busy and merges one language's edit into the others", async () => {
    const change = vi.fn();
    const inputs = await renderAll<WtInput>(
      nameFields(context({ busy: true }), "name", "Name", { es: "Pan" }, change),
      "wt-input",
    );
    expect(inputs.every((input) => input.disabled)).toBe(true);
    expect(changeFrom(inputs[1]!, { value: "Bread" })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith({ es: "Pan", en: "Bread" });
  });
});

describe("optionalTextFields", () => {
  it("renders one optional input per language carrying the fallback as its placeholder", async () => {
    const inputs = await renderAll<WtInput>(
      optionalTextFields(context(), "customer", "Menu name", { en: "Bread" }, () => {}, "Pan"),
      "wt-input",
    );
    expect(
      inputs.map((input) => [
        input.name,
        input.label,
        input.value,
        input.required,
        input.placeholder,
      ]),
    ).toEqual([
      ["customer-es", "Menu name (es)", "", false, "Pan"],
      ["customer-en", "Menu name (en)", "Bread", false, "Pan"],
    ]);
  });

  it("shows each language's own error and merges an edit into the other languages", async () => {
    const change = vi.fn();
    const inputs = await renderAll<WtInput>(
      optionalTextFields(
        context({ error: (key) => (key === "customer-en" ? "Too long" : "") }),
        "customer",
        "Menu name",
        { en: "Bread" },
        change,
      ),
      "wt-input",
    );
    expect(inputs.map((input) => [input.error, input.placeholder])).toEqual([
      ["", ""],
      ["Too long", ""],
    ]);
    expect(changeFrom(inputs[0]!, { value: "Pan" })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith({ en: "Bread", es: "Pan" });
  });
});

describe("switchField", () => {
  it("renders the name, label and checked state, and is enabled when idle", async () => {
    const [control] = await renderAll<WtSwitch>(
      switchField(context(), "active", "Active", true, () => {}),
      "wt-switch",
    );
    expect(control!.name).toBe("active");
    expect(control!.label).toBe("Active");
    expect(control!.checked).toBe(true);
    expect(control!.disabled).toBe(false);
  });

  it("is disabled while busy and hands a toggle to the form without letting it escape", async () => {
    const change = vi.fn();
    const [control] = await renderAll<WtSwitch>(
      switchField(context({ busy: true }), "active", "Active", false, change),
      "wt-switch",
    );
    expect(control!.disabled).toBe(true);
    expect(changeFrom(control!, { checked: true })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith(true);
  });
});
