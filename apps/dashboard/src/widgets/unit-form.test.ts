import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { unitRefusalErrors, type UnitForm } from "./unit-form.js";

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

async function bottomOf(el: UnitForm): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

const errorOf = (el: UnitForm, testId: string): string | null =>
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error");

const saveOf = (el: UnitForm): HTMLElement =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!;

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

  it("shows an existing unit's precision in the dropdown", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["en"],
      value: {
        id: "u1",
        name: { en: "kilogram" },
        abbreviation: { en: "kg" },
        precision: 3,
      },
    });

    expect(el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=precision]")!.value).toBe(
      "3",
    );
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

    for (const [testId, message] of [
      ["name-es", t("units.name_required")],
      ["abbreviation-es", t("units.abbreviation_required")],
    ])
      expect(el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error")).toBe(
        message,
      );
    expect(el.shadowRoot!.querySelector("#precision-error")!.textContent).toBe(
      t("units.precision_invalid"),
    );
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
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

  // The draft is rebuilt on a language change only while it holds no names, so a default language
  // enabled after the form opened has no key in it at all.
  it("blocks submit when the default language became one the draft holds no abbreviation for", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
      value: {
        id: "u1",
        name: { es: "caja", en: "box" },
        abbreviation: { es: "cj" },
        precision: 0,
      },
    });
    el.locales = ["en", "es"];
    await el.updateComplete;

    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await el.updateComplete;

    expect(submit).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=abbreviation-en]")!.getAttribute("error")).toBe(
      t("units.abbreviation_required"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=name-en]")!.getAttribute("error")).toBe("");
  });

  it("blocks submit when the default language became one the draft holds no name for", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
      value: { id: "u1", name: { es: "caja" }, abbreviation: { es: "cj", en: "bx" }, precision: 0 },
    });
    el.locales = ["en", "es"];
    await el.updateComplete;

    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await el.updateComplete;

    expect(submit).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=name-en]")!.getAttribute("error")).toBe(
      t("units.name_required"),
    );
  });

  for (const field of ["name", "abbreviation"])
    it(`shows a refused ${field} translation beside the language the server named, not the first`, async () => {
      const message = codeMessage("unit.translation_required");
      const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
        open: true,
        locales: ["es", "en"],
        value: { id: "u1", name: { es: "caja" }, abbreviation: { es: "cj" }, precision: 0 },
        fieldErrors: unitRefusalErrors({
          code: "unit.translation_required",
          params: { field, language: "en" },
        }),
      });

      expect(errorOf(el, `${field}-en`)).toBe(message);
      expect(errorOf(el, `${field}-es`)).toBe("");
      expect(await bottomOf(el)).toBe(t("form.fix_fields"));
      expect(saveOf(el).hasAttribute("disabled")).toBe(true);
    });

  it("keeps a refused translation for a language the form does not show in its bottom message, leaving Save working", async () => {
    const message = codeMessage("unit.translation_required");
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es", "en"],
      fieldErrors: unitRefusalErrors({
        code: "unit.translation_required",
        params: { field: "name", language: "fr" },
      }),
    });

    expect(await bottomOf(el)).toBe(message);
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
    for (const testId of ["name-es", "name-en", "abbreviation-es", "abbreviation-en"])
      expect(errorOf(el, testId)).toBe("");
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

  it("leaves out an optional translation that is blank, or that was enabled after the form opened", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es", "en"],
    });
    change(el, "name-es", "caja");
    change(el, "abbreviation-es", "cj");
    el.locales = ["es", "en", "fr"];
    await el.updateComplete;
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    expect(submit.mock.calls[0]![0].detail).toStrictEqual({
      value: { name: { es: "caja" }, abbreviation: { es: "cj" }, precision: 0 },
    });
  });

  it("submits when Enter is pressed in a field", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["en"],
    });
    change(el, "name-en", "box");
    change(el, "abbreviation-en", "bx");
    await el.updateComplete;
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    const field =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=name-en]")!;
    await field.updateComplete;
    field
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].detail.value).toEqual({
      name: { en: "box" },
      abbreviation: { en: "bx" },
      precision: 0,
    });
  });

  it("neither submits nor cancels while busy", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      busy: true,
      locales: ["en"],
      value: { id: "u1", name: { en: "box" }, abbreviation: { en: "bx" }, precision: 0 },
    });
    const seen = vi.fn();
    el.addEventListener("wt-submit", seen);
    el.addEventListener("wt-cancel", seen);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true }),
    );
    expect(seen).not.toHaveBeenCalled();
  });

  it("says nothing about errors before the first submission, and Save works", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
    });
    change(el, "name-es", "");
    await el.updateComplete;

    expect(errorOf(el, "name-es")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("on an invalid submission focuses the first invalid field and disables Save", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
    });
    change(el, "name-es", "caja");
    await el.updateComplete;
    saveOf(el).click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const abbreviation = el.shadowRoot!.querySelector("[data-test=abbreviation-es]")!;
    expect(abbreviation.shadowRoot!.activeElement).toBe(
      abbreviation.shadowRoot!.querySelector("input"),
    );
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);
  });

  it("re-checks every change after a failed submission, and Save works again once all are fixed", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
    });
    saveOf(el).click();
    await el.updateComplete;

    change(el, "name-es", "caja");
    await el.updateComplete;
    expect(errorOf(el, "name-es")).toBe("");
    expect(errorOf(el, "abbreviation-es")).toBe(t("units.abbreviation_required"));
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);

    change(el, "name-es", " ");
    await el.updateComplete;
    expect(errorOf(el, "name-es")).toBe(t("units.name_required"));

    change(el, "name-es", "caja");
    change(el, "abbreviation-es", "cj");
    await el.updateComplete;
    expect(errorOf(el, "abbreviation-es")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("clears a field's refusal when that field changes, and Save works again", async () => {
    const message = codeMessage("unit.precision_invalid");
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
      value: { id: "u1", name: { es: "caja" }, abbreviation: { es: "cj" }, precision: 0 },
      fieldErrors: unitRefusalErrors({ code: "unit.precision_invalid", params: {} }),
    });
    expect(el.shadowRoot!.querySelector("#precision-error")!.textContent).toBe(message);
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);

    change(el, "name-es", "caja grande");
    await el.updateComplete;
    expect(saveOf(el).hasAttribute("disabled")).toBe(true);

    change(el, "precision", "1");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("#precision-error")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("focuses the field a refusal names when the refusal arrives", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
      value: { id: "u1", name: { es: "caja" }, abbreviation: { es: "cj" }, precision: 0 },
    });
    el.fieldErrors = unitRefusalErrors({ code: "unit.precision_invalid", params: {} });
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector("[data-test=precision]"),
    );
  });

  it("drops a refusal that names no field when the form is submitted again", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
      fieldErrors: unitRefusalErrors({ code: "server.internal" }),
    });
    expect(await bottomOf(el)).toBe(codeMessage("server.internal"));

    saveOf(el).click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("shows the refusal and the generic sentence together when both apply", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
      fieldErrors: {
        _form: codeMessage("server.internal"),
        precision: codeMessage("unit.precision_invalid"),
      },
    });
    expect(await bottomOf(el)).toBe(`${codeMessage("server.internal")} ${t("form.fix_fields")}`);
  });

  it("starts again when reopened: no messages and Save working", async () => {
    const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
      open: true,
      locales: ["es"],
    });
    saveOf(el).click();
    await el.updateComplete;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;

    expect(errorOf(el, "name-es")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  });
});

describe("unitRefusalErrors", () => {
  const refusal = (code: string, params?: Record<string, unknown>) => ({
    code,
    params,
    status: 400,
  });

  it("puts a refusal beside the unit field it concerns", () => {
    expect(unitRefusalErrors(refusal("unit.precision_invalid", {}))).toEqual({
      precision: codeMessage("unit.precision_invalid"),
    });
    for (const field of ["name", "abbreviation", "precision"])
      expect(unitRefusalErrors(refusal("management.request_invalid", { field }))).toEqual({
        [field]: codeMessage("management.request_invalid"),
      });
  });

  it("puts a missing translation beside the field and language the refusal names", () => {
    const message = codeMessage("unit.translation_required");
    for (const field of ["name", "abbreviation"])
      for (const language of ["es", "en"])
        expect(
          unitRefusalErrors(refusal("unit.translation_required", { field, language })),
        ).toEqual({ [`${field}-${language}`]: message });
  });

  it("keeps a refusal that names no field of the form for the bottom message alone", () => {
    for (const error of [
      refusal("content.translation_invalid", {}),
      refusal("content.translation_required", { language: "es" }),
      refusal("unit.translation_required", { language: "es" }),
      refusal("unit.translation_required", { field: "name" }),
      refusal("management.request_invalid", { field: "productIds" }),
      refusal("management.request_invalid"),
      refusal("server.internal"),
    ])
      expect(unitRefusalErrors(error)).toEqual({ _form: codeMessage(error.code) });
  });
});
