import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { setContentLanguages } from "@waitron/ui";
import type { Unit } from "../api/client.js";
import { unitRefusalErrors, type UnitForm } from "./unit-form.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const stored = {
  id: "unit",
  staffName: "Staff crate",
  staffAbbreviation: "staff-cr",
  name: { es: "Caja", en: "Crate", fr: "Disabled crate" },
  abbreviation: { es: "cj", en: "cr", fr: "disabled-cr" },
  precision: 0,
};

async function mount(value: Unit | null = stored) {
  const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
    open: true,
    locales: ["es", "en"],
    value,
  });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return el;
}

function field(el: UnitForm, name: string) {
  const input = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  );
  expect(input, `visible field ${name}`).not.toBeNull();
  return input!;
}

async function fill(el: UnitForm, name: string, value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

const save = (el: UnitForm) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=submit]")!;

it("requires only the staff pair and submits empty customer maps without filling placeholders", async () => {
  const el = await mount(null);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  for (const name of ["staffName", "staffAbbreviation"])
    expect(field(el, name).required).toBe(true);
  for (const name of ["name-es", "name-en", "abbreviation-es", "abbreviation-en"])
    expect(field(el, name).required).toBe(false);
  await fill(el, "staffName", " Staff crate ");
  await fill(el, "staffAbbreviation", " staff-cr ");
  expect(field(el, "name-es").placeholder).toBe("Staff crate");
  expect(field(el, "abbreviation-es").placeholder).toBe("staff-cr");
  save(el).click();
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      detail: {
        value: {
          staffName: "Staff crate",
          staffAbbreviation: "staff-cr",
          name: {},
          abbreviation: {},
          precision: 0,
          measure: false,
        },
      },
    }),
  );
});

it.each(["staffName", "staffAbbreviation"] as const)(
  "refuses a blank %s while translated text is complete",
  async (name) => {
    const el = await mount();
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    await fill(el, name, "   ");
    save(el).click();
    await el.updateComplete;
    expect(submit).not.toHaveBeenCalled();
    expect(field(el, name).error).not.toBe("");
    expect(save(el).disabled).toBe(true);
    expect(
      (await formMessageOf(el.shadowRoot!.querySelector("wt-form-actions")!))?.textContent,
    ).toContain(t("form.fix_fields"));
    await fill(el, name, name === "staffName" ? "New staff crate" : "new-cr");
    expect(save(el).disabled).toBe(false);
  },
);

it("clears visible customer maps while retaining disabled entries and staff identity", async () => {
  const el = await mount();
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  for (const name of ["name-es", "name-en", "abbreviation-es", "abbreviation-en"])
    await fill(el, name, "");
  el.locales = ["en", "es", "de"];
  await el.updateComplete;
  save(el).click();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    staffName: "Staff crate",
    staffAbbreviation: "staff-cr",
    name: { fr: "Disabled crate" },
    abbreviation: { fr: "disabled-cr" },
    precision: 0,
    measure: false,
  });
  expect(stored.name).toEqual({ es: "Caja", en: "Crate", fr: "Disabled crate" });
  expect(stored.abbreviation).toEqual({ es: "cj", en: "cr", fr: "disabled-cr" });
});

it("compares trimmed staff fields and commits the submitted snapshot without accepting later edits", async () => {
  const el = await mount();
  expect(save(el).disabled).toBe(true);
  await fill(el, "staffName", " Staff crate ");
  expect(save(el).disabled).toBe(true);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await fill(el, "staffName", "First staff crate");
  save(el).click();
  const submitted = submit.mock.calls[0]![0].detail.value;
  await fill(el, "staffName", "Later staff crate");
  el.commitSaved(submitted);
  await el.updateComplete;
  expect(field(el, "staffName").value).toBe("Later staff crate");
  expect(save(el).disabled).toBe(false);
  await fill(el, "staffName", "First staff crate");
  expect(save(el).disabled).toBe(true);
});

it.each(["staffName", "staffAbbreviation"] as const)(
  "routes unit.invalid beside %s and keeps a refusal retryable",
  async (name) => {
    const el = await mount();
    await fill(el, "name-en", "New customer crate");
    el.fieldErrors = unitRefusalErrors({ code: "unit.invalid", params: { field: name } });
    await el.updateComplete;
    expect(field(el, name).error).toBe(codeMessage("unit.invalid"));
    expect(save(el).disabled).toBe(false);
    await fill(el, name, "Changed staff value");
    expect(field(el, name).error).toBe("");
  },
);

it("restores the stored staff pair when the form is reopened", async () => {
  const el = await mount();
  await fill(el, "staffName", "Unsaved name");
  await fill(el, "staffAbbreviation", "unsaved-abbr");
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(field(el, "staffName").value).toBe("Staff crate");
  expect(field(el, "staffAbbreviation").value).toBe("staff-cr");
  expect(save(el).disabled).toBe(true);
});

it("uses the configured default for placeholders even when it is not the first visible language", async () => {
  const el = await mount({ ...stored, name: { en: "Crate" }, abbreviation: {} });
  setContentLanguages({ defaultLanguage: "en", languages: ["es", "en"] });
  await el.updateComplete;
  expect(field(el, "name-es").placeholder).toBe("Crate");
  expect(field(el, "abbreviation-es").placeholder).toBe("staff-cr");
  expect(field(el, "name-es").value).toBe("");
});

it("keeps a newly entered staff pair when content languages arrive after opening", async () => {
  const el = await mount(null);
  el.locales = [];
  await el.updateComplete;
  await fill(el, "staffName", "New staff crate");
  await fill(el, "staffAbbreviation", "new-cr");
  el.locales = ["es", "en"];
  await el.updateComplete;
  expect(field(el, "staffName").value).toBe("New staff crate");
  expect(field(el, "staffAbbreviation").value).toBe("new-cr");
  expect(save(el).disabled).toBe(false);
});
