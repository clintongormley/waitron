import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit";
import { setContentLanguages, type WtInput } from "@waitron/ui";
import type { WtSwitch } from "@waitron/ui/src/components/wt-switch.js";
import type { WtPriceInput } from "@waitron/ui/src/components/wt-price-input.js";
import { MAX_MODIFIER_INTEGER } from "@waitron/catalogue/src/modifier-limits.js";
import { setLocale } from "../i18n/t.js";
import {
  type FieldContext,
  effectiveNamesLine,
  isModifierQuantity,
  nameFields,
  namesLine,
  nonBlankNames,
  optionalTextFields,
  priceField,
  priceLabel,
  priceText,
  switchField,
  textField,
  translations,
  wholeWithin,
  withLanguageText,
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

  it("says only Price for a blank unit", () => {
    expect(priceLabel("  ")).toBe("Precio");
    expect(priceLabel("")).toBe("Precio");
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

describe("namesLine", () => {
  afterEach(() => setLocale("es-ES"));

  it("lists the customer-facing names alone, with no kitchen name", () => {
    setLocale("en-GB");
    expect(namesLine(["es", "en"], { en: "Make it yours", es: "Añádele algo" })).toEqual([
      { label: "ES", value: "Añádele algo" },
      { label: "EN", value: "Make it yours" },
    ]);
  });

  it("puts each language's name after its upper-case code, in the languages' order", () => {
    setLocale("en-GB");
    expect(
      namesLine(["es", "en"], {
        en: "How would you like it cooked?",
        es: "¿Cómo la quiere hecha?",
      }),
    ).toEqual([
      { label: "ES", value: "¿Cómo la quiere hecha?" },
      { label: "EN", value: "How would you like it cooked?" },
    ]);
    setLocale("es-ES");
    expect(namesLine(["es"], { es: "¿Cómo la quiere hecha?" })).toEqual([
      { label: "ES", value: "¿Cómo la quiere hecha?" },
    ]);
  });

  it("leaves out a blank name, trims the rest, and is empty when every name is blank", () => {
    setLocale("en-GB");
    expect(namesLine(["es", "en"], { es: "  ", en: " Make it yours " })).toEqual([
      { label: "EN", value: "Make it yours" },
    ]);
    expect(namesLine(["es", "en"], { es: "", en: " " })).toEqual([]);
    expect(namesLine(["es", "en"], {})).toEqual([]);
  });

  it("lists a language whose name is stored under a regional code", () => {
    expect(namesLine(["es", "en"], { "es-ES": "Pan", "en-GB": "Bread" })).toEqual([
      { label: "ES", value: "Pan" },
      { label: "EN", value: "Bread" },
    ]);
  });
});

describe("effectiveNamesLine", () => {
  it("lists each language's own name after its upper-case code, in the languages' order", () => {
    expect(
      effectiveNamesLine(["es", "en"], { en: "Make it yours", es: "Añádele algo" }, "es", "Extras"),
    ).toEqual([
      { label: "ES", value: "Añádele algo" },
      { label: "EN", value: "Make it yours" },
    ]);
  });

  it("shows the default language's name as a placeholder for a blank language", () => {
    expect(
      effectiveNamesLine(["es", "en"], { es: "Añádele algo", en: "" }, "es", "Extras"),
    ).toEqual([
      { label: "ES", value: "Añádele algo" },
      { label: "EN", value: "Añádele algo", placeholder: true },
    ]);
  });

  it("shows the staff name for a blank default language, never another language's name", () => {
    expect(
      effectiveNamesLine(["es", "en"], { es: "", en: "Make it yours" }, "es", "Extras"),
    ).toEqual([
      { label: "ES", value: "Extras", placeholder: true },
      { label: "EN", value: "Make it yours" },
    ]);
  });

  it("shows the staff name for a blank language when the default language is blank too", () => {
    expect(effectiveNamesLine(["es", "en"], { es: "", en: "" }, "es", "Extras")).toEqual([
      { label: "ES", value: "Extras", placeholder: true },
      { label: "EN", value: "Extras", placeholder: true },
    ]);
  });

  it("counts a whitespace-only name as blank and trims every name it shows", () => {
    expect(
      effectiveNamesLine(
        ["es", "en", "fr"],
        { es: " Añádele algo ", en: "   ", fr: " Ajoutez " },
        "es",
        " Extras ",
      ),
    ).toEqual([
      { label: "ES", value: "Añádele algo" },
      { label: "EN", value: "Añádele algo", placeholder: true },
      { label: "FR", value: "Ajoutez" },
    ]);
    expect(effectiveNamesLine(["es", "en"], { es: "  ", en: "\t" }, "es", " Extras ")).toEqual([
      { label: "ES", value: "Extras", placeholder: true },
      { label: "EN", value: "Extras", placeholder: true },
    ]);
  });

  it("falls back to the default language's name when the default is not first in the order", () => {
    expect(
      effectiveNamesLine(
        ["en", "fr", "es"],
        { es: "Añádele algo", en: "", fr: " " },
        "es",
        "Extras",
      ),
    ).toEqual([
      { label: "EN", value: "Añádele algo", placeholder: true },
      { label: "FR", value: "Añádele algo", placeholder: true },
      { label: "ES", value: "Añádele algo" },
    ]);
  });

  it("falls back to the default language's name even when the default is not one of the languages", () => {
    expect(
      effectiveNamesLine(
        ["en", "fr"],
        { es: "Añádele algo", en: "", fr: "Ajoutez" },
        "es",
        "Extras",
      ),
    ).toEqual([
      { label: "EN", value: "Añádele algo", placeholder: true },
      { label: "FR", value: "Ajoutez" },
    ]);
  });

  it("is empty when every name and the staff name are blank", () => {
    expect(effectiveNamesLine(["es", "en"], { es: "", en: " " }, "es", "  ")).toEqual([]);
    expect(effectiveNamesLine(["es", "en"], {}, "es", "")).toEqual([]);
  });

  it("shows a language's regional name as its own, and a regional default-language name as the fallback", () => {
    expect(
      effectiveNamesLine(
        ["es", "en", "ca"],
        { "en-GB": "Make it yours", "es-ES": "Añádele algo" },
        "es",
        "Extras",
      ),
    ).toEqual([
      { label: "ES", value: "Añádele algo" },
      { label: "EN", value: "Make it yours" },
      { label: "CA", value: "Añádele algo", placeholder: true },
    ]);
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

  it("given the default language, hints every other language with the default's text, else the fallback", async () => {
    const placeholdersFor = async (value: Record<string, string>) =>
      (
        await renderAll<WtInput>(
          optionalTextFields(
            context({ locales: ["es", "en", "ca"] }),
            "customer",
            "Menu name",
            value,
            () => {},
            "Pan staff",
            "es",
          ),
          "wt-input",
        )
      ).map((input) => input.placeholder);

    expect(await placeholdersFor({ es: "Pan de la casa", ca: "Pa" })).toEqual([
      "Pan staff",
      "Pan de la casa",
      "Pan de la casa",
    ]);
    expect(await placeholdersFor({ es: "  ", ca: "Pa" })).toEqual([
      "Pan staff",
      "Pan staff",
      "Pan staff",
    ]);
  });

  it("given a placeholder per language, hints each language with its own and nothing else", async () => {
    const inputs = await renderAll<WtInput>(
      optionalTextFields(
        context({ locales: ["es", "en", "ca"] }),
        "customer",
        "Menu name",
        { es: "Pan de la casa" },
        () => {},
        (locale) => ({ es: "Pan staff", en: "" })[locale] ?? `${locale} hint`,
        "es",
      ),
      "wt-input",
    );
    expect(inputs.map((input) => input.placeholder)).toEqual(["Pan staff", "", "ca hint"]);
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

  const stored = { "en-GB": "Bread", "en-US": "Bread roll", "es-ES": "Pan", "pt-BR": "Pão" };

  it("shows each language's name stored under a regional code", async () => {
    const inputs = await renderAll<WtInput>(
      optionalTextFields(
        context({ locales: ["es", "en", "ca"] }),
        "customer",
        "Menu name",
        stored,
        () => {},
        "Pan staff",
        "es",
      ),
      "wt-input",
    );
    expect(inputs.map((input) => [input.name, input.value, input.placeholder])).toEqual([
      ["customer-es", "Pan", "Pan staff"],
      ["customer-en", "Bread", "Pan"],
      ["customer-ca", "", "Pan"],
    ]);
  });

  it("prefers a language's plain code over its regional ones", async () => {
    const inputs = await renderAll<WtInput>(
      optionalTextFields(
        context(),
        "customer",
        "Menu name",
        { en: "Loaf", "en-GB": "Bread" },
        () => {},
      ),
      "wt-input",
    );
    expect(inputs.map((input) => input.value)).toEqual(["", "Loaf"]);
  });

  it("saves an edited language under its plain code alone, keeping every other language's keys as stored", async () => {
    const change = vi.fn();
    const inputs = await renderAll<WtInput>(
      optionalTextFields(context(), "customer", "Menu name", stored, change),
      "wt-input",
    );
    changeFrom(inputs[1]!, { value: "Loaf" });
    expect(change).toHaveBeenCalledExactlyOnceWith({ "es-ES": "Pan", "pt-BR": "Pão", en: "Loaf" });
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

describe("priceText", () => {
  afterEach(() => setLocale("es-ES"));

  // Spanish writes a no-break space (U+00A0) between the amount and the sign; the strings below
  // spell it out rather than trusting the formatter under test to produce its own expectation.
  it("writes an amount with the euro sign where the dashboard's language writes it", () => {
    setLocale("en-GB");
    expect(priceText("9")).toBe("€9.00");
    expect(priceText("1250.5")).toBe("€1,250.50");
    setLocale("es-ES");
    expect(priceText("9")).toBe("9,00\u00a0€");
    expect(priceText("12.5")).toBe("12,50\u00a0€");
  });

  it("leaves text that is not a price as it was typed, rather than writing a sign beside NaN", () => {
    setLocale("en-GB");
    expect(priceText("abc")).toBe("abc");
    expect(priceText("9.")).toBe("9.");
    expect(priceText("")).toBe("");
  });
});

describe("priceField", () => {
  afterEach(() => setLocale("es-ES"));

  it("is a money field with no unit, carrying the value, label, placeholder, hint, required flag, error and the dashboard's language", async () => {
    setLocale("en-GB");
    const [input] = await renderAll<WtPriceInput>(
      priceField(
        context({ error: (key) => (key === "price" ? "Bad price" : "") }),
        "price",
        "Price",
        "4.50",
        () => {},
        true,
        "3.00",
        "Leave it empty for 3.00",
      ),
      "wt-price-input",
    );
    expect(input!.name).toBe("price");
    expect(input!.label).toBe("Price");
    expect(input!.value).toBe("4.50");
    expect(input!.placeholder).toBe("3.00");
    expect(input!.hint).toBe("Leave it empty for 3.00");
    expect(input!.required).toBe(true);
    expect(input!.disabled).toBe(false);
    expect(input!.error).toBe("Bad price");
    expect(input!.locale).toBe("en-GB");
    // A plain money field: nothing to press beside the amount, and no unit box.
    expect(input!.fixedUnit).toBe(true);
    expect(input!.unit).toBe("");
    expect(input!.shadowRoot!.querySelector(".unit")).toBeNull();
  });

  it("is optional, valid, unhinted and without a placeholder unless told otherwise", async () => {
    const [input] = await renderAll<WtPriceInput>(
      priceField(context(), "price", "Price", "", () => {}),
      "wt-price-input",
    );
    expect(input!.required).toBe(false);
    expect(input!.placeholder).toBe("");
    expect(input!.hint).toBe("");
    expect(input!.error).toBe("");
    expect(input!.locale).toBe("es-ES");
  });

  it("is disabled while the form is busy", async () => {
    const [input] = await renderAll<WtPriceInput>(
      priceField(context({ busy: true }), "price", "Price", "", () => {}),
      "wt-price-input",
    );
    expect(input!.disabled).toBe(true);
  });

  it("hands an edit to the form and keeps the field's own change event inside it", async () => {
    const change = vi.fn();
    const [input] = await renderAll<WtPriceInput>(
      priceField(context(), "price", "Price", "", change),
      "wt-price-input",
    );
    expect(changeFrom(input!, { value: "2.80" })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith("2.80");
  });
});

describe("separate Catalan and Valencian edits", () => {
  it("keeps Valencian when Catalan replaces its regional keys", () => {
    expect(
      withLanguageText(
        {
          ca: "Old Catalan",
          "ca-ES": "Regional Catalan",
          "ca-ES-valencia": "Valencian",
          es: "Spanish",
        },
        "ca",
        "New Catalan",
      ),
    ).toEqual({ ca: "New Catalan", "ca-ES-valencia": "Valencian", es: "Spanish" });
  });
  it("keeps Catalan when Valencian is edited", () => {
    expect(
      withLanguageText(
        { ca: "Catalan", "ca-ES-valencia": "Old Valencian" },
        "ca-ES-valencia",
        "New Valencian",
      ),
    ).toEqual({ ca: "Catalan", "ca-ES-valencia": "New Valencian" });
  });
});

it("retains deletion of legacy malformed regional keys when their language is edited", () => {
  expect(
    withLanguageText({ "en-invalid!": "Legacy", "en-GB": "Regional" }, "en", "English"),
  ).toEqual({ en: "English" });
});
