import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import {
  cleanupWidgets,
  mountWidget as mountWidgetBase,
  type Theme,
} from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-screen.js";
import type { SetupVenueScreen } from "./venue-screen.js";
import type { DeepPartial } from "../setup-app.js";
import { VENUE_SETUP_COUNTRY_PACKS, getVenueSetupCountryPack } from "@waitron/country-packs";
import type { CountryPack } from "@waitron/country";
import type { ProvisionBody } from "../api/client.js";

async function mountWidget<T extends HTMLElement>(tag: string, props: Partial<T>, theme?: Theme) {
  return mountWidgetBase<T>(tag, props, theme);
}

type Emitted = { kind: "patch" | "goto" | "advance"; detail: unknown };

function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-patch", (e) =>
    events.push({ kind: "patch", detail: (e as CustomEvent).detail }),
  );
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  host.addEventListener("setup-advance", (e) =>
    events.push({ kind: "advance", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupVenueScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

/** The form's one message above Next, shown by `wt-form-actions`. */
async function bottomOf(el: SetupVenueScreen): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

async function bottomAlertOf(el: SetupVenueScreen): Promise<Element | null> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error][role=alert]");
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

type Dropdown = HTMLElement & { options: { value: string; label: string }[]; error: string };
const dropdown = (el: SetupVenueScreen, field: "country" | "province") =>
  q(el, `[data-test=${field}]`) as Dropdown;
/** A dropdown's own control, which carries its invalid state. */
const dropdownControl = (el: SetupVenueScreen, field: "country" | "province") =>
  dropdown(el, field).shadowRoot!.querySelector<HTMLElement>(".trigger")!;

async function type(el: SetupVenueScreen, field: string, value: string): Promise<void> {
  const target = q(el, `[data-test=${field}]`)!;
  if (target.tagName === "WT-COMBOBOX") {
    await chooseOption(target, value);
  } else if (target.tagName === "WT-SWITCH") {
    target.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { checked: value === "on" },
        bubbles: true,
        composed: true,
      }),
    );
  } else {
    target.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  await el.updateComplete;
}

async function toggleLocale(el: SetupVenueScreen, locale: string, checked: boolean): Promise<void> {
  const box = q(el, `[data-test=locale-${locale}]`) as HTMLInputElement;
  box.checked = checked;
  box.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

/** The receipt-language options currently selected, in render order. */
const ticked = (el: SetupVenueScreen): string[] =>
  [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]')]
    .filter((input) => input.checked)
    .map((input) => input.value);

const VALID: Record<string, string> = {
  country: "ES",
  taxId: "b 1234567 4",
  legalName: "Deli del Sol SL",
  registeredSameAsVenue: "off",
  registeredStreet: "Calle Fiscal 8",
  registeredPostalCode: "28013",
  registeredCity: "Madrid",
  name: "Calle Mayor",
  addressLine1: "Calle Mayor 1",
  postalCode: "28013",
  city: "Madrid",
  province: "28",
  dayCutover: "06:00",
  seriesCode: "FA",
  fullSeriesCode: "FF",
  correctiveSeriesCode: "RF",
  fullCorrectiveSeriesCode: "RFF",
};

async function fillValid(
  el: SetupVenueScreen,
  overrides: Record<string, string> = {},
): Promise<void> {
  for (const [key, value] of Object.entries({ ...VALID, ...overrides })) {
    await type(el, key, value);
  }
}

const EXPECTED_LOCATION = {
  name: "Calle Mayor",
  fiscalTerritory: "ES-common",
  invoiceLocales: ["es-ES"],
  addressLine1: "Calle Mayor 1",
  addressLine2: null,
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
};

const EXPECTED_VENUE = {
  country: "ES",
  taxId: "B12345674",
  legalName: "Deli del Sol SL",
  taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid, Madrid",
  ...EXPECTED_LOCATION,
  seriesCode: "FA",
  fullSeriesCode: "FF",
  correctiveSeriesCode: "RF",
  fullCorrectiveSeriesCode: "RFF",
};

/** The parts `VALID` types, which the draft keeps beside the line it sends. */
const EXPECTED_REGISTERED = {
  sameAsVenue: false,
  street: "Calle Fiscal 8",
  line2: "",
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
};

afterEach(cleanupWidgets);

describe("working language", () => {
  afterEach(() => setLocale("en-GB"));

  it.each([
    ["en-GB", "Help with working language"],
    ["es-ES", "Ayuda sobre el idioma de trabajo"],
  ])("distinguishes the help button from the language choice in %s", async (locale, label) => {
    setLocale(locale);
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: EXPECTED_VENUE },
    });
    const help = q(el, "[data-test=staffLanguage] wt-help-tooltip")!;
    expect(help.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe(label);
  });

  it.each(["demo", "prepare", "live"] as const)(
    "offers English and Spanish with the derived default in %s",
    async (mode) => {
      setLocale("en-GB");
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
        draft: { mode, venue: EXPECTED_VENUE },
      });
      const language = q(el, "[data-test=staffLanguage]") as Dropdown & { value: string };
      expect(language).not.toBeNull();
      expect(language.options.map(({ value }) => value).sort()).toEqual(["en", "es"]);
      expect(language.value).toBe("es");
      expect(language.getAttribute("name")).toBe("staffLanguage");
      expect(language.hasAttribute("required")).toBe(true);
    },
  );

  it("derives English from the first receipt language rather than the screen language", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: { ...EXPECTED_VENUE, invoiceLocales: ["en-GB"] } },
    });
    expect(q(el, "[data-test=staffLanguage]")).not.toBeNull();
    expect((q(el, "[data-test=staffLanguage]") as HTMLElement & { value: string }).value).toBe(
      "en",
    );
  });

  it("puts a working-language refusal under the picker and clears it on a new choice", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: EXPECTED_VENUE },
      invalidField: "staffLanguage",
    });
    const picker = q(el, "[data-test=staffLanguage]") as Dropdown;
    expect(picker.error).toBe(t("venue.error.staff_language"));
    expect(picker.hasAttribute("invalid")).toBe(true);
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(picker);
    expect(picker.shadowRoot!.activeElement?.tagName).toBe("BUTTON");
    expect(await bottomOf(el)).toBe(t("venue.fix_fields"));
    await type(el, "staffLanguage", "en");
    expect(picker.error).toBe("");
  });

  it("keeps the explicit choice through geography and screen-language changes and sends it", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: EXPECTED_VENUE },
    });
    const events = collect(host);
    expect(q(el, "[data-test=staffLanguage]")).not.toBeNull();
    await type(el, "staffLanguage", "en");
    await type(el, "postalCode", "08001");
    await type(el, "city", "Barcelona");
    setLocale("es-ES");
    await el.updateComplete;
    expect((q(el, "[data-test=staffLanguage]") as HTMLElement & { value: string }).value).toBe(
      "en",
    );
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
    expect((events[0]!.detail as { patch: ProvisionBody }).patch.venue).toMatchObject({
      staffLanguage: "en",
      province: "Barcelona",
      invoiceLocales: ["ca-ES"],
    });
  });
});

describe("setup country admission", () => {
  it.each(["demo", "prepare", "live"] as const)(
    "refuses a saved country without a setup pack in %s",
    async (mode) => {
      const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
        draft: { mode, venue: { ...EXPECTED_VENUE, country: "FR" } },
      });
      const events = collect(host);
      expect(dropdown(el, "country").options.map(({ value }) => value)).toEqual(["ES"]);
      q(el, "[data-test=next]")!.click();
      await el.updateComplete;
      await (dropdown(el, "country") as Dropdown & { updateComplete: Promise<unknown> })
        .updateComplete;
      expect(dropdownControl(el, "country").getAttribute("aria-invalid")).toBe("true");
      expect(dropdown(el, "country").error).not.toBe("");
      expect(await bottomOf(el)).toContain(t("venue.fix_fields"));
      expect(q(el, "[data-test=next]")!.hasAttribute("disabled")).toBe(true);
      expect(events).toEqual([]);

      for (const [field, value] of Object.entries(VALID)) {
        if (q(el, `[data-test=${field}]`) !== null) await type(el, field, value);
      }
      q(el, "[data-test=next]")!.click();
      await el.updateComplete;
      expect(dropdownControl(el, "country").getAttribute("aria-invalid")).toBe("false");
      expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
      expect((events[0]!.detail as { patch: ProvisionBody }).patch.venue.country).toBe("ES");
    },
  );
});

describe("setup-venue-screen", () => {
  it("names the countries in the wizard's language", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
      const countries = dropdown(el, "country").options;
      expect(countries.map((option) => option.label.trim())).toEqual(["España"]);
    } finally {
      setLocale("en-GB");
    }
  });

  it("turns off autocorrect, the capital first letter and spellcheck on the tax number and series codes only", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const attributes = async (name: string) => {
      const field = el.shadowRoot!.querySelector<SetupVenueScreen>(`wt-input[name=${name}]`)!;
      await field.updateComplete;
      const input = field.shadowRoot!.querySelector("input")!;
      return ["autocapitalize", "autocorrect", "spellcheck"].map((attr) =>
        input.getAttribute(attr),
      );
    };
    for (const name of [
      "taxId",
      "seriesCode",
      "fullSeriesCode",
      "correctiveSeriesCode",
      "fullCorrectiveSeriesCode",
    ])
      expect(await attributes(name)).toEqual(["none", "off", "false"]);
    expect(await attributes("legalName")).toEqual([null, null, null]);
  });

  it("collects every field and emits the nested venue patch, then a screen-agnostic advance", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    // Pinned whole, so a mis-named field fails here.
    expect(events).toEqual([
      {
        kind: "patch",
        detail: {
          patch: {
            registeredAddress: EXPECTED_REGISTERED,
            venue: { ...EXPECTED_VENUE, staffLanguage: "es" },
          },
        },
      },
      { kind: "advance", detail: null },
    ]);
  });

  it.each([
    ["a fresh draft", {}],
    [
      "a draft that holds one",
      { venue: { operationDescription: "Old venue description" } } as DeepPartial<ProvisionBody>,
    ],
  ] as const)("puts no operation description in the venue patch from %s", async (_, draft) => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft });
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
    const venue = (events[0]!.detail as { patch: ProvisionBody }).patch.venue;
    expect(Object.keys(venue)).not.toContain("operationDescription");
  });

  it("renders onboarding-ready countries and all Spanish provinces as stable-code choices", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const countries = dropdown(el, "country").options;
    expect(countries.map(({ value }) => value)).toEqual(["ES"]);
    expect(countries.map((option) => option.label.trim())).toEqual(["Spain"]);
    // The empty "Select province" row is the dropdown's placeholder, not an option.
    const provinces = dropdown(el, "province").options;
    expect(provinces).toHaveLength(52);
    expect({ value: provinces[0]!.value, label: provinces[0]!.label.trim() }).toEqual({
      value: "01",
      label: "Araba/Álava",
    });
    expect({
      value: provinces.at(-1)!.value,
      label: provinces.at(-1)!.label.trim(),
    }).toEqual({
      value: "52",
      label: "Melilla",
    });
  });

  it("picks the country and the province from the shared dropdowns, with their help beside the box", async () => {
    type Box = HTMLElement & {
      options: { value: string; label: string }[];
      value: string;
      required: boolean;
      label: string;
      search: string;
      placeholder: string;
    };
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const country = q(el, 'wt-combobox[name="country"]') as Box | null;
    const province = q(el, 'wt-combobox[name="province"]') as Box | null;
    expect(country).not.toBeNull();
    expect(province).not.toBeNull();
    const shape = (box: Box) => ({
      label: box.label,
      required: box.required,
      search: box.search,
      placeholder: box.placeholder,
      value: box.value,
    });
    expect(shape(country!)).toEqual({
      label: "Country",
      required: true,
      search: "auto",
      placeholder: "",
      value: "ES",
    });
    expect(country!.options).toEqual([{ value: "ES", label: "Spain" }]);
    expect(shape(province!)).toEqual({
      label: "Province",
      required: true,
      search: "auto",
      placeholder: "Select province",
      value: "",
    });
    expect(province!.options.some(({ value }) => value === "")).toBe(false);
    expect(country!.querySelector("wt-help-tooltip[slot=help]")!.getAttribute("aria-label")).toBe(
      "Help with country",
    );
    expect(province!.querySelector("wt-help-tooltip[slot=help]")!.getAttribute("aria-label")).toBe(
      "Help with province",
    );

    await chooseOption(province!, "08");
    await el.updateComplete;
    expect(province!.value).toBe("08");
    expect(q(el, "[data-test=timeZone]")!.textContent).toBe("Time zone: Europe/Madrid");
    expect(ticked(el)).toEqual(["ca-ES"]);
  });

  it("labels the province dropdown's search in the wizard's language", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
      const province = q(el, 'wt-combobox[name="province"]') as unknown as {
        searchPlaceholder: string;
        noResultsLabel: string;
      };
      expect({
        search: province.searchPlaceholder,
        none: province.noResultsLabel,
      }).toEqual({ search: "Buscar", none: "Sin resultados" });
    } finally {
      setLocale("en-GB");
    }
  });

  it("derives the province from a valid Spanish postcode", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await type(el, "postalCode", "08001");
    expect((q(el, "[data-test=province]") as HTMLSelectElement).value).toBe("08");
  });

  it("shows Catalonia's fixed language over an explicitly selected one when the postcode moves there", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await toggleLocale(el, "es-ES", false);
    await toggleLocale(el, "es-ES", true);
    await type(el, "postalCode", "08001");
    expect((q(el, "[data-test=locale-es-ES]") as HTMLInputElement).checked).toBe(false);
    expect((q(el, "[data-test=locale-ca-ES]") as HTMLInputElement).checked).toBe(true);
  });

  it("emits a blank addressLine2 as null, and a filled one as its string", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await type(el, "addressLine2", "   "); // whitespace-only counts as blank
    q(el, "[data-test=next]")!.click();
    let patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.addressLine2).toBeNull();

    const second = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events2 = collect(second.host);
    await fillValid(second.el);
    await type(second.el, "addressLine2", "Piso 2");
    q(second.el, "[data-test=next]")!.click();
    patch = (events2[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.addressLine2).toBe("Piso 2");
  });

  it("emits a screen-agnostic advance even for a live draft (no in-screen cert routing)", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "live" },
    });
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    expect(events.at(-1)).toEqual({ kind: "advance", detail: null });
    expect(events.some((e) => e.kind === "goto")).toBe(false);
  });

  it("emits the same screen-agnostic advance for a demo draft (no in-screen routing)", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
    });
    const events = collect(host);
    for (const [field, value] of Object.entries({
      name: "Calle Mayor",
      addressLine1: "Calle Mayor 1",
      postalCode: "28013",
      city: "Madrid",
    }))
      await type(el, field, value);
    q(el, "[data-test=next]")!.click();
    expect(events.at(-1)).toEqual({ kind: "advance", detail: null });
    expect(events.some((e) => e.kind === "goto")).toBe(false);
  });

  it("seeds the editable fields from the accepted draft", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      mode: "prepare",
      venue: {
        country: "ES",
        taxId: "B12345674",
        legalName: "Bar Pepe SL",
        name: "Plaza Vieja",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["ca-ES"],
        addressLine1: "Plaza Vieja 3",
        addressLine2: "Local B",
        postalCode: "08002",
        city: "Barcelona",
        province: "Barcelona",
        timeZone: "Atlantic/Canary",
        dayCutover: "05:30",
        seriesCode: "AA",
        correctiveSeriesCode: "RA",
      },
    };
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft });
    const val = (field: string) =>
      (q(el, `[data-test=${field}]`) as unknown as { value: string }).value;
    expect(val("taxId")).toBe("B12345674");
    expect(val("legalName")).toBe("Bar Pepe SL");
    expect(val("name")).toBe("Plaza Vieja");
    expect(val("addressLine2")).toBe("Local B");
    expect(val("city")).toBe("Barcelona");
    expect(val("seriesCode")).toBe("AA");
    expect(q(el, "[data-test=timeZone]")!.textContent).toContain("Europe/Madrid");
    expect((q(el, "[data-test=locale-ca-ES]") as HTMLInputElement).checked).toBe(true);
    expect((q(el, "[data-test=locale-es-ES]") as HTMLInputElement).checked).toBe(false);
  });

  it("seeds a null addressLine2 as a blank field", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      venue: { addressLine2: null },
    };
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft });
    expect((q(el, "[data-test=addressLine2]") as unknown as { value: string }).value).toBe("");
  });

  // The shell reassigns `draft` on every merge, so re-seeding on each update would overwrite what the
  // operator typed.
  it("seeds from the draft only once, so a later draft reassignment keeps local edits", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { venue: { taxId: "B-INITIAL" } },
    });
    const val = () => (q(el, "[data-test=taxId]") as unknown as { value: string }).value;
    expect(val()).toBe("B-INITIAL");

    await type(el, "taxId", "B-EDITED");
    expect(val()).toBe("B-EDITED");

    el.draft = { venue: { taxId: "B-RESEEDED" } };
    await el.updateComplete;
    expect(val()).toBe("B-EDITED");
  });

  it("blocks Next when seriesCode equals correctiveSeriesCode, marking both invalid", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { seriesCode: "FA", correctiveSeriesCode: "FA" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(await bottomAlertOf(el)).not.toBeNull();
    expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=correctiveSeriesCode]")!.hasAttribute("invalid")).toBe(true);
  });

  it("blocks Next when the full invoice series repeats the ticket series", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    expect(q(el, "[data-test=fullSeriesCode]")).not.toBeNull();
    await fillValid(el, { seriesCode: "FA", fullSeriesCode: "FA" });

    q(el, "[data-test=next]")!.click();
    await el.updateComplete;

    expect(events).toEqual([]);
    expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=fullSeriesCode]")!.hasAttribute("invalid")).toBe(true);
  });

  it("blocks Next and marks the blank field invalid when a required field is empty", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { taxId: "   " }); // whitespace-only required field
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "[data-test=taxId]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=legalName]")!.hasAttribute("invalid")).toBe(false);
  });

  it("blocks Next for a malformed or bad-checksum Spanish NIF", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { taxId: "B12345678" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "[data-test=taxId]")!.hasAttribute("invalid")).toBe(true);
  });

  it("blocks Next when the selected province conflicts with the postcode", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await type(el, "province", "08");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=postalCode]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=province]")!.hasAttribute("invalid")).toBe(true);
  });

  it("clears the province when the operator goes back to Select province", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await type(el, "province", "");
    expect(q(el, "[data-test=fiscalTerritory]")).toBeNull();
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=province]")!.hasAttribute("invalid")).toBe(true);
  });

  it("blocks an explicitly unsupported Spanish fiscal jurisdiction", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { postalCode: "35001", province: "35" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=province]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=fiscalTerritory]")!.textContent).toContain("ES-canary");
  });

  it("renders a routed-back server error above Next when errorMessage is set (no field marked yet)", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      errorMessage: "The country must match the fiscal territory.",
    });
    const alert = await bottomAlertOf(el);
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("country must match");
    expect(await bottomOf(el)).not.toContain(FIX_FIELDS);
  });

  // The server's message goes when the operator submits again: it is stale once they have acted.
  it("renders exactly one role=alert (the client message) when a server error and a client error coincide", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      errorMessage: "The country must match the fiscal territory.",
    });
    q(el, "[data-test=next]")!.click(); // empty form → client validation fails
    await el.updateComplete;
    const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
    await actions.updateComplete;
    const alerts = [
      ...el.shadowRoot!.querySelectorAll("[role=alert]"),
      ...actions.shadowRoot!.querySelectorAll("[role=alert]"),
    ];
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.textContent).toContain(FIX_FIELDS);
    expect(alerts[0]!.textContent).not.toContain("country must match");
  });

  it("blocks Next when no invoice locale is selected", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await toggleLocale(el, "es-ES", false); // the only default locale off → zero selected
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("blocks Next when a draft carries more than one receipt language", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        venue: {
          ...EXPECTED_VENUE,
          ...EXPECTED_LOCATION,
          invoiceLocales: ["es-ES", "gl-ES"],
        },
      },
    });
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("carries the chosen receipt language and the province-derived time zone through into the patch", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await toggleLocale(el, "gl-ES", true);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.invoiceLocales).toEqual(["gl-ES"]);
    expect(patch.venue?.timeZone).toBe("Europe/Madrid");
  });

  it("clears the bottom message once the form is valid and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click(); // empty form → bottom message
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
    expect(events.some((e) => e.kind === "advance")).toBe(true);
  });

  it("marks the field the server refused and explains what is wrong with it", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "seriesCode",
    });
    const input = q(el, "[data-test=seriesCode]")!;
    await (input as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(input.hasAttribute("invalid")).toBe(true);
    // Beside the field, inside `wt-input`, not as a page-level banner.
    expect(input.shadowRoot!.querySelector("[data-error]")!.textContent).toContain(
      "letters, numbers",
    );
    expect(q(el, "[data-test=legalName]")!.hasAttribute("invalid")).toBe(false);
  });

  it("moves focus to the refused field on arrival, so the operator sees where they landed", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "seriesCode",
    });
    const input = q(el, "[data-test=seriesCode]")!;
    await new Promise((resolve) => setTimeout(resolve, 0)); // the focus waits on wt-input's render
    expect(el.shadowRoot!.activeElement).toBe(input);
  });

  it("moves no focus when the server refused nothing", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.shadowRoot!.activeElement).toBeNull();
  });

  it("explains a refused legal name beside the field, naming the length cap as well as hidden characters", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "legalName",
    });
    const input = q(el, "[data-test=legalName]")!;
    await (input as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(input.hasAttribute("invalid")).toBe(true);
    const said = input.shadowRoot!.querySelector("[data-error]")!.textContent!;
    expect(said).toContain("120 characters");
    expect(said).toContain("hidden characters");
  });

  it("shows a server refusal beside the taxpayer domicile field", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: EXPECTED_VENUE },
      invalidField: "taxpayerDomicile",
    });
    const input = q(el, "[data-test=registeredStreet]")!;
    await (input as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(input.hasAttribute("invalid")).toBe(true);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("shows a refusal of the typed parts only while the form would send that line again", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: EXPECTED_VENUE },
      invalidField: "taxpayerDomicile",
    });
    // The switch on sends the venue's address, which the server never refused.
    await type(el, "registeredSameAsVenue", "on");
    expect(el.shadowRoot!.querySelectorAll("[invalid]")).toHaveLength(0);
    expect(await bottomOf(el)).toBe("");
    // Off again, the parts make the refused line once more.
    await type(el, "registeredSameAsVenue", "off");
    expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("invalid")).toBe(true);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("says in the bottom message why the registered address was refused while it is the venue's", async () => {
    for (const [locale, said] of [
      [
        "en-GB",
        "The venue's address was not accepted as the registered business address. Check the venue's address below, or turn off “Same as the venue's address” and enter the registered address.",
      ],
      [
        "es-ES",
        "La dirección del local no se aceptó como domicilio fiscal del negocio. Revisa la dirección del local más abajo o desactiva «Igual que la dirección del local» e introduce el domicilio fiscal.",
      ],
    ] as const) {
      setLocale(locale);
      try {
        const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
          draft: { mode: "prepare" },
          invalidField: "taxpayerDomicile",
        });
        expect(
          (q(el, "[data-test=registeredSameAsVenue]") as HTMLElement & { checked: boolean })
            .checked,
        ).toBe(true);
        expect(el.shadowRoot!.querySelectorAll("[invalid]")).toHaveLength(0);
        expect(await bottomOf(el)).toBe(said);
        // Turning the switch off shows the parts, and the mark moves onto Street.
        await type(el, "registeredSameAsVenue", "off");
        expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("invalid")).toBe(true);
        expect(await bottomOf(el)).toBe(locale === "en-GB" ? FIX_FIELDS : t("venue.fix_fields"));
        cleanupWidgets();
      } finally {
        setLocale("en-GB");
      }
    }
  });

  it("clears the refusal of the venue's address as the registered one once the venue's address is edited", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
      invalidField: "taxpayerDomicile",
    });
    expect(await bottomOf(el)).not.toBe("");
    await type(el, "city", "Madrid");
    expect(await bottomOf(el)).toBe("");
  });

  it("marks nothing for a field path this form does not recognise", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "country",
    });
    expect(q(el, "[data-test=country]")!.hasAttribute("invalid")).toBe(false);
    expect(el.shadowRoot!.querySelectorAll("[invalid]")).toHaveLength(0);
  });

  it("clears the server's mark once the operator edits that field, and Next still advances", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "seriesCode",
    });
    const events = collect(host);
    // Fill every other field with a valid value, leaving the refused one untouched, so the clear can
    // only have come from editing the field the server named.
    for (const [key, value] of Object.entries(VALID)) {
      if (key === "seriesCode") continue;
      await type(el, key, value);
    }
    expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(true);

    await type(el, "seriesCode", "FA");
    expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(false);
    expect((q(el, "[data-test=seriesCode]") as unknown as { error: string }).error).toBe("");

    // And the form is genuinely submittable, so the assertion above is not passing on a dead form.
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events.some((e) => e.kind === "advance")).toBe(true);
  });

  it("steps back to admin without emitting a patch", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "admin" } }]);
  });
});

describe("setup-venue-screen form errors", () => {
  const next = (el: SetupVenueScreen) => q(el, "[data-test=next]")!;
  const errorOf = (el: SetupVenueScreen, field: string) =>
    q(el, `[data-test=${field}]`)!.getAttribute("error");

  it("says nothing and leaves Next working before the first press", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await type(el, "legalName", "");
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
    expect(errorOf(el, "legalName")).toBe("");
  });

  it("names each empty corrective series code field in a sentence that reads", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await fillValid(el, { correctiveSeriesCode: "", fullCorrectiveSeriesCode: "" });
    next(el).click();
    await el.updateComplete;
    expect(errorOf(el, "correctiveSeriesCode")).toBe(
      "Enter the series code for correctives of simplified invoices.",
    );
    expect(errorOf(el, "fullCorrectiveSeriesCode")).toBe(
      "Enter the series code for correctives of full invoices.",
    );
  });

  it("on a failed press marks each bad field, says so above Next, focuses the first and disables Next", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { legalName: "", city: "" });
    next(el).click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(events).toEqual([]);
    expect(errorOf(el, "legalName")).toBe("Enter the legal name.");
    expect(errorOf(el, "city")).not.toBe("");
    expect(errorOf(el, "name")).toBe("");
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    const legalName = q(el, "[data-test=legalName]")!;
    expect(legalName.shadowRoot!.activeElement).toBe(legalName.shadowRoot!.querySelector("input"));
    expect(next(el).hasAttribute("disabled")).toBe(true);
  });

  it("re-checks every change after a failed press, and Next works again once all are fixed", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { legalName: "", city: "" });
    next(el).click();
    await el.updateComplete;

    await type(el, "legalName", "Deli del Sol SL");
    expect(errorOf(el, "legalName")).toBe("");
    expect(errorOf(el, "city")).not.toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(true);

    await type(el, "legalName", " ");
    expect(errorOf(el, "legalName")).toBe("Enter the legal name.");

    await type(el, "legalName", "Deli del Sol SL");
    await type(el, "city", "Madrid");
    expect(errorOf(el, "city")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
    next(el).click();
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
  });

  it("outlines a refused dropdown in the danger colour", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
    await fillValid(el, { province: "" });
    next(el).click();
    await el.updateComplete;
    expect(dropdownControl(el, "province").getAttribute("aria-invalid")).toBe("true");
    const box = dropdown(el, "province").shadowRoot!.querySelector("[part=field]")!;
    expect(getComputedStyle(box).boxShadow).toContain("rgb(4, 5, 6)");
  });

  it("re-checks the selects and the language group too, not only the text fields", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await fillValid(el, { province: "" });
    await toggleLocale(el, "es-ES", false);
    next(el).click();
    await el.updateComplete;
    expect(dropdownControl(el, "province").getAttribute("aria-invalid")).toBe("true");
    expect(q(el, "fieldset.locales")!.getAttribute("aria-invalid")).toBe("true");

    await type(el, "province", "28");
    await toggleLocale(el, "es-ES", true);
    await (dropdown(el, "province") as Dropdown & { updateComplete: Promise<unknown> })
      .updateComplete;
    expect(dropdownControl(el, "province").getAttribute("aria-invalid")).toBe("false");
    expect(q(el, "fieldset.locales")!.getAttribute("aria-invalid")).toBe("false");
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
  });

  it("shows a refusal that names no field above Next, leaves Next working, and drops it on the next press", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      errorMessage: "The country must match the fiscal territory.",
    });
    const events = collect(host);
    expect(await bottomOf(el)).toBe("The country must match the fiscal territory.");
    expect(next(el).hasAttribute("disabled")).toBe(false);
    expect(el.shadowRoot!.querySelectorAll("[invalid]")).toHaveLength(0);

    await fillValid(el);
    next(el).click();
    await el.updateComplete;
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
    expect(await bottomOf(el)).toBe("");
  });

  it("puts both sentences above Next when a refusal that names no field meets field errors", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    next(el).click();
    await el.updateComplete;
    Object.assign(el, {
      errorMessage: "The country must match the fiscal territory.",
      refusal: {},
    });
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(`The country must match the fiscal territory. ${FIX_FIELDS}`);
  });

  it("shows a refusal naming a field under that field until the operator changes it, leaving Next working", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "seriesCode",
    });
    for (const [key, value] of Object.entries(VALID)) {
      if (key !== "seriesCode") await type(el, key, value);
    }
    expect(errorOf(el, "seriesCode")).toContain("letters, numbers");
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect((next(el) as HTMLElement & { disabled: boolean }).disabled).toBe(false);

    await type(el, "seriesCode", "FA");
    expect(errorOf(el, "seriesCode")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
  });

  it.each([
    ["seriesCode", true],
    ["fullSeriesCode", false],
    ["correctiveSeriesCode", true],
    ["fullCorrectiveSeriesCode", false],
  ])(
    "words a refused repeated series code as the form does; editing %s drops it: %s",
    async (edited, drops) => {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
        draft: { venue: { seriesCode: "FS", correctiveSeriesCode: "FS" } },
        invalidField: "correctiveSeriesCode",
      });
      await el.updateComplete;
      expect(errorOf(el, "correctiveSeriesCode")).toBe(t("venue.error.series_codes"));
      expect(errorOf(el, "seriesCode")).toBe("");
      expect((next(el) as HTMLElement & { disabled: boolean }).disabled).toBe(false);

      await type(el, "name", "Deli del Sol");
      expect(errorOf(el, "correctiveSeriesCode")).toBe(t("venue.error.series_codes"));

      await type(el, edited, "FT");
      expect(errorOf(el, "correctiveSeriesCode")).toBe(drops ? "" : t("venue.error.series_codes"));
      if (drops) expect(await bottomOf(el)).toBe("");
    },
  );

  it("drops a field refusal on the next press and sends the form again, unchanged", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "seriesCode",
    });
    const events = collect(host);
    for (const [key, value] of Object.entries(VALID)) {
      if (key !== "seriesCode") await type(el, key, value);
    }
    next(el).click();
    await el.updateComplete;
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
    expect(errorOf(el, "seriesCode")).toBe("");
    expect(await bottomOf(el)).toBe("");
  });

  it("keeps Next disabled for a validation error while a field refusal is also shown", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "seriesCode",
    });
    const events = collect(host);
    for (const [key, value] of Object.entries({ ...VALID, city: "" })) {
      if (key !== "seriesCode") await type(el, key, value);
    }
    next(el).click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(errorOf(el, "city")).not.toBe("");
    expect((next(el) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    await type(el, "city", "Madrid");
    expect((next(el) as HTMLElement & { disabled: boolean }).disabled).toBe(false);
  });

  it("says the bottom message in Spanish", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
      next(el).click();
      await el.updateComplete;
      expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
    } finally {
      setLocale("en-GB");
    }
  });
});

describe("the registered business address in parts", () => {
  afterEach(() => setLocale("en-GB"));

  const PARTS = [
    "registeredStreet",
    "registeredLine2",
    "registeredPostalCode",
    "registeredCity",
    "registeredProvince",
  ];
  const sameSwitch = (el: SetupVenueScreen) =>
    q(el, "[data-test=registeredSameAsVenue]") as HTMLElement & { checked: boolean };
  const valueOf = (el: SetupVenueScreen, key: string) =>
    (q(el, `[data-test=${key}]`) as HTMLElement & { value: string }).value;
  const venueOf = (events: Emitted[]) =>
    (events.find(({ kind }) => kind === "patch")!.detail as { patch: ProvisionBody }).patch.venue;

  it.each([
    ["en-GB", "Same as the venue's address"],
    ["es-ES", "Igual que la dirección del local"],
  ])("starts the switch on, with the parts hidden, in %s", async (locale, label) => {
    setLocale(locale);
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    expect(sameSwitch(el).checked).toBe(true);
    expect(sameSwitch(el).getAttribute("label")).toBe(label);
    expect(sameSwitch(el).getAttribute("name")).toBe("registeredSameAsVenue");
    for (const key of PARTS) expect(q(el, `[data-test=${key}]`)).toBeNull();
    expect(q(el, "[data-test=registered-same-hint]")!.textContent!.trim()).not.toBe("");
  });

  it("shows the switch's note only while it is on, close under the switch and apart from what follows", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    const hint = () => q(el, "[data-test=registered-same-hint]");
    const toggle = sameSwitch(el).getBoundingClientRect();
    const note = hint()!.getBoundingClientRect();
    const next = hint()!.closest("fieldset")!.nextElementSibling!.getBoundingClientRect();
    const space2 = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-2"));
    expect(space2).toBeGreaterThan(0);
    expect(note.top - toggle.bottom).toBeLessThanOrEqual(space2);
    expect(next.top - note.bottom).toBeGreaterThan(space2);
    expect(sameSwitch(el).getAttribute("description")).toBe(t("venue.hint.registered_same"));
    await type(el, "registeredSameAsVenue", "off");
    expect(hint()).toBeNull();
    expect(sameSwitch(el).getAttribute("description")).toBe("");
    const street = q(el, "[data-test=registeredStreet]")!.getBoundingClientRect();
    expect(street.top - sameSwitch(el).getBoundingClientRect().bottom).toBeGreaterThan(0);
  });

  it("sends the venue's own address joined while the switch is on", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    const events = collect(host);
    const {
      registeredSameAsVenue,
      registeredStreet,
      registeredPostalCode,
      registeredCity,
      ...rest
    } = VALID;
    void [registeredSameAsVenue, registeredStreet, registeredPostalCode, registeredCity];
    for (const [key, value] of Object.entries(rest)) await type(el, key, value);
    await type(el, "addressLine2", "2º 1ª");
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe("Calle Mayor 1, 2º 1ª, 28013 Madrid, Madrid");
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
  });

  it("asks for street, postal code and city once the switch is off, and not for line 2 or the province", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    const events = collect(host);
    await fillValid(el, { registeredStreet: "", registeredPostalCode: "", registeredCity: "" });
    for (const key of PARTS) expect(q(el, `[data-test=${key}]`)).not.toBeNull();
    expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("required")).toBe(true);
    expect(q(el, "[data-test=registeredLine2]")!.hasAttribute("required")).toBe(false);
    expect(q(el, "[data-test=registeredProvince]")!.hasAttribute("required")).toBe(false);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    for (const key of ["registeredStreet", "registeredPostalCode", "registeredCity"])
      expect(q(el, `[data-test=${key}]`)!.hasAttribute("invalid"), key).toBe(true);
    for (const key of ["registeredLine2", "registeredProvince"])
      expect(q(el, `[data-test=${key}]`)!.hasAttribute("invalid"), key).toBe(false);
    expect((q(el, "[data-test=registeredCity]") as HTMLElement & { error: string }).error).toBe(
      "Enter the city.",
    );
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("hides and stops checking the parts when the switch goes back on", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    const events = collect(host);
    await fillValid(el, { registeredStreet: "" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    await type(el, "registeredSameAsVenue", "on");
    expect(q(el, "[data-test=registeredStreet]")).toBeNull();
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe("Calle Mayor 1, 28013 Madrid, Madrid");
  });

  it("refuses a malformed postal code and a province the postal code is not in", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    const events = collect(host);
    await fillValid(el, { registeredPostalCode: "2801" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=registeredPostalCode]")!.hasAttribute("invalid")).toBe(true);
    await type(el, "registeredPostalCode", "28013");
    expect(valueOf(el, "registeredProvince")).toBe("28");
    await type(el, "registeredProvince", "08");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=registeredProvince]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=registeredPostalCode]")!.hasAttribute("invalid")).toBe(false);
    await type(el, "registeredProvince", "28");
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe("Calle Fiscal 8, 28013 Madrid, Madrid");
  });

  it("opens a saved line in its parts and gains the province from the postal code", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        venue: { ...EXPECTED_VENUE, taxpayerDomicile: "Carrer de Mallorca, 123, 08013 Barcelona" },
      },
    });
    const events = collect(host);
    expect(sameSwitch(el).checked).toBe(false);
    expect(valueOf(el, "registeredStreet")).toBe("Carrer de Mallorca, 123");
    expect(valueOf(el, "registeredLine2")).toBe("");
    expect(valueOf(el, "registeredPostalCode")).toBe("08013");
    expect(valueOf(el, "registeredCity")).toBe("Barcelona");
    expect(valueOf(el, "registeredProvince")).toBe("08");
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe(
      "Carrer de Mallorca, 123, 08013 Barcelona, Barcelona",
    );
  });

  it("opens a line it cannot split in Street, and marks postal code and city only on Next", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: { ...EXPECTED_VENUE, taxpayerDomicile: "2º 1ª" } },
    });
    const events = collect(host);
    expect(sameSwitch(el).checked).toBe(false);
    expect(valueOf(el, "registeredStreet")).toBe("2º 1ª");
    expect(valueOf(el, "registeredPostalCode")).toBe("");
    expect(valueOf(el, "registeredCity")).toBe("");
    expect(el.shadowRoot!.querySelectorAll("[invalid]")).toHaveLength(0);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=registeredPostalCode]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=registeredCity]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("invalid")).toBe(false);
  });

  it("opens with the switch on when the saved line is the venue's address", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        venue: { ...EXPECTED_VENUE, taxpayerDomicile: "Calle Mayor 1, 28013 Madrid, Madrid" },
      },
    });
    expect(sameSwitch(el).checked).toBe(true);
  });

  it("keeps line 2 from the draft's parts when they still make the saved line", async () => {
    const parts = {
      sameAsVenue: false,
      street: "Calle Fiscal 8",
      line2: "2º 1ª",
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
    };
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        registeredAddress: parts,
        venue: {
          ...EXPECTED_VENUE,
          taxpayerDomicile: "Calle Fiscal 8, 2º 1ª, 28013 Madrid, Madrid",
        },
      },
    });
    const events = collect(host);
    expect(valueOf(el, "registeredStreet")).toBe("Calle Fiscal 8");
    expect(valueOf(el, "registeredLine2")).toBe("2º 1ª");
    q(el, "[data-test=next]")!.click();
    const patch = (events[0]!.detail as { patch: ProvisionBody }).patch;
    expect(patch.registeredAddress).toEqual(parts);
    expect(patch.venue.taxpayerDomicile).toBe("Calle Fiscal 8, 2º 1ª, 28013 Madrid, Madrid");
  });

  it("splits the saved line again when the draft's parts no longer make it", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        registeredAddress: {
          sameAsVenue: false,
          street: "Calle Vieja 1",
          line2: "Bajo",
          postalCode: "28001",
          city: "Madrid",
          province: "Madrid",
        },
        venue: { ...EXPECTED_VENUE, taxpayerDomicile: "Calle Nueva 2, 28002 Madrid, Madrid" },
      },
    });
    expect(valueOf(el, "registeredStreet")).toBe("Calle Nueva 2");
    expect(valueOf(el, "registeredLine2")).toBe("");
    expect(valueOf(el, "registeredPostalCode")).toBe("28002");
  });

  it("refuses parts whose joined line could not be read back, marking City", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    const events = collect(host);
    await fillValid(el, { registeredCity: "Madrid, Centro" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    const city = q(el, "[data-test=registeredCity]") as HTMLElement & { error: string };
    expect(city.hasAttribute("invalid")).toBe(true);
    expect(city.error).toBe("Write the city without a comma.");
    expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("invalid")).toBe(false);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await type(el, "registeredCity", "Madrid");
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe("Calle Fiscal 8, 28013 Madrid, Madrid");
  });

  it("refuses the venue's address as the registered one when its line could not be read back, marking the venue's City", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        venue: { ...EXPECTED_VENUE, city: "Madrid, Centro", taxpayerDomicile: "" },
      },
    });
    const events = collect(host);
    expect(sameSwitch(el).checked).toBe(true);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    const city = q(el, "[data-test=city]") as HTMLElement & { error: string };
    expect(city.hasAttribute("invalid")).toBe(true);
    expect(city.error).toBe("Escribe la ciudad sin comas.");
    expect(await bottomOf(el)).toBe(t("venue.fix_fields"));
    await type(el, "city", "Madrid");
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe("Calle Mayor 1, 28013 Madrid, Madrid");
  });

  it.each([
    // A postal code with no province behind it marks the province too, as it does elsewhere.
    ["a malformed venue postal code", { postalCode: "2801" }, ["postalCode", "province"]],
    [
      "a venue province that does not match its postal code",
      { province: "Barcelona" },
      ["postalCode", "province"],
    ],
  ])(
    "marks only the venue's own fields for %s while the switch is on, not its City",
    async (_case, venue, marked) => {
      const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
        draft: { mode: "prepare", venue: { ...EXPECTED_VENUE, ...venue, taxpayerDomicile: "" } },
      });
      const events = collect(host);
      expect(sameSwitch(el).checked).toBe(true);
      q(el, "[data-test=next]")!.click();
      await el.updateComplete;
      expect(events).toEqual([]);
      const invalid = [...el.shadowRoot!.querySelectorAll("[invalid]")].map((node) =>
        node.getAttribute("data-test"),
      );
      expect(invalid).toEqual(marked);
    },
  );

  it("clears the registered postal code and province when the country changes", async () => {
    const packs = VENUE_SETUP_COUNTRY_PACKS as CountryPack[];
    packs.push(SPARSE_PACK);
    try {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
        draft: { mode: "prepare", venue: EXPECTED_VENUE },
      });
      expect(valueOf(el, "registeredPostalCode")).toBe("28013");
      expect(valueOf(el, "registeredProvince")).toBe("28");
      await type(el, "country", "ZZ");
      expect(valueOf(el, "registeredPostalCode")).toBe("");
      expect(valueOf(el, "registeredProvince")).toBe("");
      expect(valueOf(el, "registeredStreet")).toBe("Calle Fiscal 8");
    } finally {
      packs.pop();
    }
  });

  it("seeds the switch on from the draft's parts, keeping the parts behind it", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        registeredAddress: {
          sameAsVenue: true,
          street: "Calle Fiscal 8",
          line2: "2º 1ª",
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
        },
        venue: { ...EXPECTED_VENUE, taxpayerDomicile: "Calle Mayor 1, 28013 Madrid, Madrid" },
      },
    });
    expect(sameSwitch(el).checked).toBe(true);
    await type(el, "registeredSameAsVenue", "off");
    expect(valueOf(el, "registeredStreet")).toBe("Calle Fiscal 8");
    expect(valueOf(el, "registeredLine2")).toBe("2º 1ª");
  });

  it("opens an empty saved line with the switch on, even beside a venue address", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare", venue: { ...EXPECTED_VENUE, taxpayerDomicile: "" } },
    });
    expect(sameSwitch(el).checked).toBe(true);
  });

  it("sends the pack's own spelling of a province given in another", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        registeredAddress: {
          sameAsVenue: false,
          street: "Calle Fiscal 8",
          line2: "",
          postalCode: "28013",
          city: "Madrid",
          province: "madrid",
        },
        venue: { ...EXPECTED_VENUE, taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid, madrid" },
      },
    });
    const events = collect(host);
    expect(valueOf(el, "registeredStreet")).toBe("Calle Fiscal 8");
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe("Calle Fiscal 8, 28013 Madrid, Madrid");
  });

  it("sends the pack's own spelling of the venue's province while the switch is on", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: {
        mode: "prepare",
        venue: {
          ...EXPECTED_VENUE,
          addressLine1: "Rúa Real 1",
          postalCode: "15001",
          city: "A Coruña",
          province: "A Coruña",
          taxpayerDomicile: "",
        },
      },
    });
    const events = collect(host);
    await type(el, "registeredSameAsVenue", "on");
    q(el, "[data-test=next]")!.click();
    expect(venueOf(events).taxpayerDomicile).toBe("Rúa Real 1, 15001 A Coruña, Coruña, A");
  });

  it("shows neither the switch nor the parts in Demo, and sends no registered address", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
    });
    const events = collect(host);
    expect(sameSwitch(el)).toBeNull();
    for (const [key, value] of Object.entries({
      name: "Calle Mayor",
      addressLine1: "Calle Mayor 1",
      postalCode: "28013",
      city: "Madrid",
    }))
      await type(el, key, value);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0]!.detail as { patch: ProvisionBody }).patch;
    expect(patch.venue.taxpayerDomicile).toBeNull();
    expect(patch).not.toHaveProperty("registeredAddress");
  });
});

describe("A2 shop form", () => {
  it("asks for the taxpayer domicile separately from the location address in Prepare", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "prepare" },
    });
    const events = collect(host);
    await fillValid(el);
    await type(el, "registeredLine2", "2º 1ª");

    q(el, "[data-test=next]")!.click();
    const venue = (events[0]!.detail as { patch: ProvisionBody }).patch.venue;
    expect(venue.taxpayerDomicile).toBe("Calle Fiscal 8, 2º 1ª, 28013 Madrid, Madrid");
    expect(venue.addressLine1).toBe("Calle Mayor 1");
  });

  it("asks for no till name, in any mode", async () => {
    for (const mode of ["demo", "prepare", "live"] as const) {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
        draft: { mode },
      });
      expect(q(el, "[data-test=tillName]"), mode).toBeNull();
      expect(el.shadowRoot!.textContent, mode).not.toMatch(/till name/i);
      cleanupWidgets();
    }
  });
  it("prefills the invoice series and day cutover", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    for (const [field, value] of Object.entries({
      seriesCode: "S",
      fullSeriesCode: "F",
      correctiveSeriesCode: "SR",
      fullCorrectiveSeriesCode: "FR",
      dayCutover: "04:00",
    })) {
      expect((q(el, `[data-test=${field}]`) as HTMLInputElement).value).toBe(value);
    }
  });
  it("collects only a venue name and address in Demo, taking the country's fixed demo identity", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
    });
    const events = collect(host);
    for (const field of [
      "taxId",
      "legalName",
      "dayCutover",
      "seriesCode",
      "fullSeriesCode",
      "correctiveSeriesCode",
      "fullCorrectiveSeriesCode",
      "locale-es-ES",
    ])
      expect(q(el, `[data-test=${field}]`)).toBeNull();
    for (const [field, value] of Object.entries({
      name: "Calle Mayor",
      addressLine1: "Calle Mayor 1",
      postalCode: "28013",
      city: "Madrid",
    }))
      await type(el, field, value);
    q(el, "[data-test=next]")!.click();
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
    const venue = (events[0]!.detail as { patch: ProvisionBody }).patch.venue;
    expect(venue.taxId).toBe("B00000000");
    expect(venue.legalName).toBe("Waitron Demo S.L.");
    expect(venue.name).toBe("Calle Mayor");
    expect(venue.seriesCode).toBe("S");
    expect(venue.fullSeriesCode).toBe("F");
    expect(venue.correctiveSeriesCode).toBe("SR");
    expect(venue.fullCorrectiveSeriesCode).toBe("FR");
    const validation = getVenueSetupCountryPack("ES")!.taxIdentifier!.validate(venue.taxId);
    expect(validation).toEqual({ valid: true, normalized: venue.taxId, kind: "entity" });
    const returned = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo", venue },
    });
    const replay = collect(returned.host);
    q(returned.el, "[data-test=next]")!.click();
    expect((replay[0]!.detail as { patch: ProvisionBody }).patch.venue).toEqual(venue);
  });
  it("explains each missing text field and provides a hint and visible required markers", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    const expected = {
      taxId: ["Enter the tax ID.", "Of the business that issues the invoices"],
      legalName: ["Enter the legal name.", "As on the business's tax documents"],
      name: ["Enter the venue name.", "The name you use for this venue"],
      addressLine1: ["Enter the street address.", "Street and building number"],
      postalCode: ["Enter the postal code.", "Used to suggest the province"],
      city: ["Enter the city.", "Town or city"],
    };
    for (const [field, [error, hint]] of Object.entries(expected)) {
      const input = q(el, `[data-test=${field}]`)!;
      expect(input.getAttribute("error")).toBe(error);
      expect(input.hasAttribute("required")).toBe(true);
      expect(input.getAttribute("hint")).toBe(hint);
      expect(input.querySelector("wt-help-tooltip")).toBeNull();
    }
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "wt-form-actions")).not.toBeNull();
  });
});

it.each(["prepare", "live"] as const)(
  "leaves the demo identity out of %s: tax ID, legal name and venue name start empty",
  async (mode) => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft: { mode } });
    await type(el, "postalCode", "28013");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    for (const field of ["taxId", "legalName", "name"]) {
      expect((q(el, `[data-test=${field}]`) as HTMLInputElement).value, field).toBe("");
    }
  },
);
it("starts the Demo venue name as the demo identity's venue name, which the operator may keep or change", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo" },
  });
  expect((q(el, "[data-test=name]") as HTMLInputElement).value).toBe("Casa Delgado");
  const events = collect(host);
  for (const [field, value] of Object.entries({
    addressLine1: "Calle Mayor 1",
    postalCode: "28013",
    city: "Madrid",
  }))
    await type(el, field, value);
  q(el, "[data-test=next]")!.click();
  const venue = (events[0]!.detail as { patch: ProvisionBody }).patch.venue;
  expect(venue.name).toBe("Casa Delgado");
  expect(venue.legalName).toBe("Waitron Demo S.L.");
});
it("keeps a venue name the Demo draft already holds rather than the demo identity's", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo", venue: { name: "Bar Pepe" } },
  });
  expect((q(el, "[data-test=name]") as HTMLInputElement).value).toBe("Bar Pepe");
});
it("explains the Demo venue name with a ? rather than a hint the filled-in field would never show", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo" },
  });
  const name = q(el, "[data-test=name]")!;
  expect(name.getAttribute("hint")).toBe("");
  const help = name.querySelector("wt-help-tooltip[slot=help]")!;
  expect(help.getAttribute("aria-label")).toBe("Help with venue name");
  expect(help.textContent!.trim()).toBe(
    "The name you use for this venue. You can keep the suggested name or change it.",
  );
});
it("explains the Demo venue name's ? in Spanish", async () => {
  setLocale("es-ES");
  try {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
    });
    const help = q(el, "[data-test=name] wt-help-tooltip[slot=help]")!;
    expect(help.getAttribute("aria-label")).toBe("Ayuda sobre el nombre del local");
    expect(help.textContent!.trim()).toBe(
      "El nombre que usas para este local. Puedes mantener el nombre propuesto o cambiarlo.",
    );
  } finally {
    setLocale("en-GB");
  }
});
it.each(["prepare", "live"] as const)(
  "keeps the venue name's hint and no ? in %s, where the field starts empty",
  async (mode) => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft: { mode } });
    const name = q(el, "[data-test=name]")!;
    expect(name.getAttribute("hint")).toBe("The name you use for this venue");
    expect(name.querySelector("wt-help-tooltip")).toBeNull();
  },
);
it("sends the current country's demo identity in Demo, not a tax ID or legal name the draft held", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo", venue: { taxId: "B12345674", legalName: "Otra Empresa SL" } },
  });
  const events = collect(host);
  for (const [field, value] of Object.entries({
    addressLine1: "Calle Mayor 1",
    postalCode: "28013",
    city: "Madrid",
  }))
    await type(el, field, value);
  q(el, "[data-test=next]")!.click();
  const venue = (events[0]!.detail as { patch: ProvisionBody }).patch.venue;
  expect(venue.taxId).toBe("B00000000");
  expect(venue.legalName).toBe("Waitron Demo S.L.");
});
it("shows a Demo legal-name refusal above Next, leaving the venue name unmarked", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo" },
    invalidField: "legalName",
  });
  const name = q(el, "[data-test=name]")!;
  expect(name.hasAttribute("invalid")).toBe(false);
  expect(name.getAttribute("error")).toBe("");
  expect(await bottomOf(el)).toBe(t("server_fields.legal_name"));
  expect(t("server_fields.legal_name")).toContain("characters");
});

it.each([
  ["seriesCode", "server_fields.series_code"],
  ["fullSeriesCode", "server_fields.series_code"],
  ["correctiveSeriesCode", "server_fields.series_code"],
  ["fullCorrectiveSeriesCode", "server_fields.series_code"],
] as const)(
  "shows a Demo refusal of the hidden %s above Next, and pressing Next tries again",
  async (invalidField, message) => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
      invalidField,
    });
    const events = collect(host);
    for (const [field, value] of Object.entries({
      name: "Calle Mayor",
      addressLine1: "Calle Mayor 1",
      postalCode: "28013",
      city: "Madrid",
    }))
      await type(el, field, value);
    expect(await bottomOf(el)).toBe(t(message));
    expect(q(el, "[data-test=next]")!.hasAttribute("disabled")).toBe(false);

    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
    expect(await bottomOf(el)).toBe("");
  },
);

it("explains an unsupported Demo province", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo" },
  });
  const events = collect(host);
  for (const [field, value] of Object.entries({
    name: "Local",
    addressLine1: "Calle Mayor 1",
    postalCode: "35001",
    city: "Las Palmas",
  }))
    await type(el, field, value);
  q(el, "[data-test=next]")!.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(dropdown(el, "province").error).toContain("not available");
});

it("derives invoice language from the retained province after leaving Demo", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: {
      mode: "prepare",
      venue: { country: "ES", province: "Barcelona", postalCode: "08001" },
    },
  });
  expect((q(el, "[data-test=locale-ca-ES]") as HTMLInputElement).checked).toBe(true);
  expect((q(el, "[data-test=locale-es-ES]") as HTMLInputElement).checked).toBe(false);
});

it("shows the fiscal territory under the province, not above the address", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "province", "28");
  const nodes = [...el.shadowRoot!.querySelectorAll("[data-test]")].map((n) =>
    n.getAttribute("data-test"),
  );
  expect(nodes.indexOf("fiscalTerritory")).toBeGreaterThan(nodes.indexOf("province"));
  expect(Math.abs(nodes.indexOf("fiscalTerritory") - nodes.indexOf("timeZone"))).toBe(1);
});

it("pre-selects Catalan alone in Barcelona, where receipts are fixed in it", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "08"); // Barcelona — Catalan
  expect(ticked(el)).toEqual(["ca-ES"]);
});

it("emits Barcelona's fixed Catalan as its one receipt language", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  const events = collect(host);
  await fillValid(el, { postalCode: "08001", province: "08", city: "Barcelona" });
  q(el, "[data-test=next]")!.click();
  const patch = (events[0]!.detail as { patch: DeepPartial<ProvisionBody> }).patch;
  expect(patch.venue?.invoiceLocales).toEqual(["ca-ES"]);
});

it("pre-ticks only Spanish where there is no regional language", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "28"); // Madrid
  expect(ticked(el)).toEqual(["es-ES"]);
});

it("lets the province re-seed languages that arrived from the draft unchanged", async () => {
  // The SEED half of the follow-the-province flag: a draft carrying exactly the province's own
  // defaults is not an operator choice, so a later province change still re-seeds.
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: {
      venue: {
        country: "ES",
        province: "Barcelona",
        invoiceLocales: ["ca-ES"],
      },
    },
  });
  expect(ticked(el)).toEqual(["ca-ES"]);
  await type(el, "province", "15"); // A Coruña — not fixed, so Spanish
  expect(ticked(el)).toEqual(["es-ES"]);
});

it("keeps languages the draft customised when the province changes", async () => {
  // The other side of the same flag: these are not the province's defaults, so somebody chose them
  // and the province must not overwrite the choice.
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: {
      venue: {
        country: "ES",
        province: "Barcelona",
        invoiceLocales: ["eu-ES"],
      },
    },
  });
  await type(el, "province", "15");
  expect(ticked(el)).toEqual(["eu-ES"]);
});

it("keeps the operator's own choice when the province changes", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "28");
  await toggleLocale(el, "gl-ES", true); // the operator picks Galician
  await type(el, "province", "15"); // A Coruña
  expect(ticked(el)).toEqual(["gl-ES"]);
});

it("does not move the province while the postcode typed so far is incomplete", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "province", "08");
  await type(el, "postalCode", "2800");
  expect((q(el, "[data-test=province]") as HTMLSelectElement).value).toBe("08");
  expect(ticked(el)).toEqual(["ca-ES"]);
});

it("submits the form when Enter is pressed in a field", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  const events = collect(host);
  await fillValid(el);
  q(el, "[data-test=city]")!.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Enter}");
  expect(events).toEqual([
    {
      kind: "patch",
      detail: {
        patch: {
          registeredAddress: EXPECTED_REGISTERED,
          venue: { ...EXPECTED_VENUE, staffLanguage: "es" },
        },
      },
    },
    { kind: "advance", detail: null },
  ]);
});

it("drops the server's mark when the shell withdraws the refused field", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    invalidField: "seriesCode",
  });
  expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(true);
  el.invalidField = undefined;
  await el.updateComplete;
  expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(false);
  expect(q(el, "[data-test=seriesCode]")!.getAttribute("error")).toBe("");
});

it("refuses a draft country that has no venue-setup pack and derives nothing from it", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { venue: { country: "GB", province: "Kent" } },
  });
  const events = collect(host);
  expect(q(el, "[data-test=operationDescription]")).toBeNull();
  expect(q(el, "[data-test=taxId]")!.getAttribute("label")).toBe("Tax ID");
  expect(el.shadowRoot!.querySelectorAll('input[name="invoiceLocales"]')).toHaveLength(0);
  expect(q(el, "[data-test=province]")!.tagName).toBe("WT-INPUT");
  expect(q(el, "[data-test=fiscalTerritory]")).toBeNull();
  expect(q(el, "[data-test=timeZone]")!.textContent).toBe("Time zone: —");
  q(el, "[data-test=next]")!.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(dropdown(el, "country").error).toBe("Check the country.");
  await (dropdown(el, "country") as Dropdown & { updateComplete: Promise<unknown> }).updateComplete;
  expect(dropdownControl(el, "country").getAttribute("aria-invalid")).toBe("true");
});

const SPARSE_PACK: CountryPack = {
  countryCode: "ZZ",
  defaultLocale: "zz-ZZ",
  defaultTimeZone: "Etc/GMT-3",
  timeZones: ["Etc/GMT-3"],
  invoiceLocales: ["zz-ZZ"],
  moduleIds: [],
  availableForVenueSetup: true,
  administrativeAreas: [],
  fiscalJurisdictions: [
    {
      id: "ZZ-main",
      areaCodes: [],
      supported: true,
      modules: { filing: "verifactu", tax: "vat" },
    },
  ],
  defaultFiscalJurisdictionId: "ZZ-main",
};

it("emits a country pack with no provinces or validators as the operator typed it", async () => {
  const packs = VENUE_SETUP_COUNTRY_PACKS as CountryPack[];
  packs.push(SPARSE_PACK);
  try {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await type(el, "country", "ZZ");
    expect(q(el, "[data-test=taxId]")!.getAttribute("label")).toBe("Tax ID");
    expect(q(el, "[data-test=province]")!.tagName).toBe("WT-INPUT");
    expect(q(el, "[data-test=locale-zz-ZZ]")!.parentElement!.textContent!.trim()).toBe("zz-ZZ");
    for (const [field, value] of Object.entries({
      taxId: " zz 42 ",
      legalName: "Zed Foods",
      registeredSameAsVenue: "off",
      registeredStreet: "1 Fiscal Quay",
      registeredPostalCode: "zz-9",
      registeredCity: "Port",
      name: "Harbour",
      addressLine1: "1 Quay",
      postalCode: " zz-9 ",
      city: "Port",
      province: "North Riding",
      dayCutover: "05:00",
      seriesCode: "A",
      fullSeriesCode: "FF",
      correctiveSeriesCode: "B",
      fullCorrectiveSeriesCode: "FB",
    }))
      await type(el, field, value);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([
      {
        kind: "patch",
        detail: {
          patch: {
            registeredAddress: {
              sameAsVenue: false,
              street: "1 Fiscal Quay",
              line2: "",
              postalCode: "zz-9",
              city: "Port",
              province: "",
            },
            venue: {
              country: "ZZ",
              taxId: " zz 42 ",
              legalName: "Zed Foods",
              taxpayerDomicile: "1 Fiscal Quay, zz-9 Port",
              name: "Harbour",
              fiscalTerritory: "ZZ-main",
              invoiceLocales: ["zz-ZZ"],
              staffLanguage: "en",
              addressLine1: "1 Quay",
              addressLine2: null,
              postalCode: " zz-9 ",
              city: "Port",
              province: "North Riding",
              timeZone: "Etc/GMT-3",
              dayCutover: "05:00",
              seriesCode: "A",
              fullSeriesCode: "FF",
              correctiveSeriesCode: "B",
              fullCorrectiveSeriesCode: "FB",
            },
          },
        },
      },
      { kind: "advance", detail: null },
    ]);
  } finally {
    packs.splice(packs.indexOf(SPARSE_PACK), 1);
  }
});

it.each(["constructor", "toString", "__proto__"])(
  "labels a pack's receipt language %s with its code",
  async (code) => {
    const packs = VENUE_SETUP_COUNTRY_PACKS as CountryPack[];
    const pack: CountryPack = { ...SPARSE_PACK, invoiceLocales: [code] };
    packs.push(pack);
    try {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
      await type(el, "country", "ZZ");
      expect(q(el, `[data-test=locale-${code}]`)!.parentElement!.textContent!.trim()).toBe(code);
    } finally {
      packs.splice(packs.indexOf(pack), 1);
    }
  },
);

describe("setup-venue-screen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("shows its heading, labels, messages and buttons in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    expect(q(el, "h1")!.textContent).toBe("Tu tienda");
    expect(q(el, "[data-test=legalName]")!.getAttribute("label")).toBe("Razón social");
    expect(q(el, "[data-test=locale-ca-ES]")!.parentElement!.textContent!.trim()).toBe(
      "Catalán (Català)",
    );
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=legalName]")!.getAttribute("error")).toBe(
      "Introduce la razón social.",
    );
    expect(q(el, "[data-test=legalName]")!.getAttribute("hint")).toBe(
      "Como en sus documentos fiscales",
    );
    expect(q(el, "[data-test=seriesCode] wt-help-tooltip")!.getAttribute("aria-label")).toBe(
      "Ayuda sobre el código de la serie de facturas simplificadas (tickets)",
    );
    expect(q(el, "[data-test=timeZone]")!.textContent).toBe("Zona horaria: Europe/Madrid");
    expect(q(el, "[data-test=back]")!.textContent).toBe("Volver");
  });

  it("names Galician in Spanish followed by its own name, as it does the other languages", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    expect(q(el, "[data-test=locale-gl-ES]")!.parentElement!.textContent!.trim()).toBe(
      "Gallego (Galego)",
    );
  });

  it("redraws a Demo legal-name refusal, shown above Next, in Spanish", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
      invalidField: "legalName",
    });
    const english = await bottomOf(el);
    setLocale("es-ES");
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(t("server_fields.legal_name"));
    expect(t("server_fields.legal_name")).not.toBe(english);
  });

  it("redraws in Spanish when the language is switched, keeping what was typed", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await type(el, "legalName", "Bar Pepe SL");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Tu tienda");
    expect(q(el, "[data-test=legalName]")!.getAttribute("label")).toBe("Razón social");
    expect((q(el, "[data-test=legalName]") as unknown as { value: string }).value).toBe(
      "Bar Pepe SL",
    );
  });
});

describe("one receipt language", () => {
  const CATALONIA = getVenueSetupCountryPack("ES")!.administrativeAreas.find(
    ({ code }) => code === "08",
  )!;
  const options = (el: SetupVenueScreen) => [
    ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]'),
  ];
  const BARCELONA = { postalCode: "08001", province: "08", city: "Barcelona" };

  afterEach(() => setLocale("en-GB"));

  it("offers Madrid the four official languages as one choice, Spanish selected", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    expect(options(el).map((input) => [input.type, input.dataset.test, input.disabled])).toEqual([
      ["radio", "locale-es-ES", false],
      ["radio", "locale-ca-ES", false],
      ["radio", "locale-gl-ES", false],
      ["radio", "locale-eu-ES", false],
    ]);
    expect(ticked(el)).toEqual(["es-ES"]);
    await toggleLocale(el, "gl-ES", true);
    expect(ticked(el)).toEqual(["gl-ES"]);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0]!.detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.invoiceLocales).toEqual(["gl-ES"]);
  });

  it("offers no English", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    expect(q(el, "[data-test=locale-en-GB]")).toBeNull();
  });

  it("shows Barcelona's Catalan selected and fixed, with the region's reason beside the choice", async () => {
    expect(CATALONIA.fixedReceiptLocale?.locale).toBe("ca-ES");
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, BARCELONA);
    expect(ticked(el)).toEqual(["ca-ES"]);
    expect(options(el).every((input) => input.disabled)).toBe(true);
    const reason = q(el, "[data-test=invoice-locales-fixed]")!;
    expect(reason.textContent!.trim()).toBe(CATALONIA.fixedReceiptLocale!.reason.en);
    expect(q(el, "fieldset.locales")!.getAttribute("aria-describedby")).toBe(reason.id);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0]!.detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.invoiceLocales).toEqual(["ca-ES"]);
  });

  it("gives the region's reason in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await fillValid(el, BARCELONA);
    expect(q(el, "[data-test=invoice-locales-fixed]")!.textContent!.trim()).toBe(
      CATALONIA.fixedReceiptLocale!.reason.es,
    );
  });

  it("gives the region's reason in English when the wizard's language has none", async () => {
    setLocale("ca-ES");
    expect(Object.keys(CATALONIA.fixedReceiptLocale!.reason)).not.toContain("ca");
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await fillValid(el, BARCELONA);
    const reason = q(el, "[data-test=invoice-locales-fixed]");
    expect(reason?.textContent!.trim()).toBe(CATALONIA.fixedReceiptLocale!.reason.en);
    expect(q(el, "fieldset.locales")!.getAttribute("aria-describedby")).toBe(reason!.id);
  });

  it("shows no reason and leaves the choice open outside Catalonia", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await fillValid(el);
    expect(q(el, "[data-test=invoice-locales-fixed]")).toBeNull();
    expect(q(el, "fieldset.locales")!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("re-seeds Spanish when the province moves from Barcelona to A Coruña", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await type(el, "province", "08");
    expect(ticked(el)).toEqual(["ca-ES"]);
    await type(el, "province", "15");
    expect(ticked(el)).toEqual(["es-ES"]);
  });

  it("returns to the operator's own choice when the province leaves Barcelona", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await type(el, "province", "28");
    await toggleLocale(el, "eu-ES", true);
    await type(el, "province", "08");
    expect(ticked(el)).toEqual(["ca-ES"]);
    await type(el, "province", "15");
    expect(ticked(el)).toEqual(["eu-ES"]);
  });

  it("names one receipt language in the group's label and its error", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await fillValid(el);
    await toggleLocale(el, "es-ES", false);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "fieldset.locales legend")!.textContent).toContain(
      t("venue.label.invoice_locales"),
    );
    expect(q(el, "#invoice-locales-error")!.textContent).toBe(t("venue.error.invoice_locales"));
    expect(t("venue.label.invoice_locales")).toBe("Receipt language");
    expect(t("venue.error.invoice_locales")).toBe("Choose the receipt language.");
  });
});

describe("setup-venue-screen layout", () => {
  afterEach(() => setLocale("en-GB"));

  const top = (el: SetupVenueScreen, field: string) =>
    q(el, `[data-test=${field}]`)!.getBoundingClientRect().top;

  it("explains the short fields with a hint in the field and keeps help for the long explanations", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const hinted = [
      "taxId",
      "legalName",
      "name",
      "addressLine1",
      "addressLine2",
      "postalCode",
      "city",
    ];
    expect(
      Object.fromEntries(
        hinted.map((field) => [field, q(el, `[data-test=${field}]`)!.getAttribute("hint")]),
      ),
    ).toEqual({
      taxId: "Of the business that issues the invoices",
      legalName: "As on the business's tax documents",
      name: "The name you use for this venue",
      addressLine1: "Street and building number",
      addressLine2: "Floor, unit or other detail",
      postalCode: "Used to suggest the province",
      city: "Town or city",
    });
    for (const field of hinted) {
      expect(q(el, `[data-test=${field}] wt-help-tooltip`), field).toBeNull();
    }
    const helped = ["country", "province", "dayCutover", "seriesCode", "correctiveSeriesCode"];
    for (const field of helped) {
      expect(q(el, `[data-test=${field}] wt-help-tooltip[slot=help]`), field).not.toBeNull();
    }
    expect(q(el, "fieldset.locales legend wt-help-tooltip")).not.toBeNull();
  });

  it("explains the short fields in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    expect(
      ["taxId", "name", "addressLine1", "addressLine2", "postalCode", "city"].map((field) =>
        q(el, `[data-test=${field}]`)!.getAttribute("hint"),
      ),
    ).toEqual([
      "Del negocio que emite las facturas",
      "El nombre que usas para este local",
      "Calle y número",
      "Piso, puerta u otro detalle",
      "Sirve para proponer la provincia",
      "Pueblo o ciudad",
    ]);
  });

  it("drops the lone Location heading on the demo form", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
    });
    expect(el.shadowRoot!.querySelectorAll("h2")).toHaveLength(0);
  });

  it("keeps the Business, Location and Invoicing headings on the full form", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    expect([...el.shadowRoot!.querySelectorAll("h2")].map((h) => h.textContent!.trim())).toEqual([
      "Business",
      "Venue",
      "Invoicing",
    ]);
  });

  it("puts postal code and city side by side where there is room, and stacks them at phone width", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    host.style.width = "620px";
    expect(top(el, "city")).toBe(top(el, "postalCode"));
    expect(top(el, "postalCode")).toBeGreaterThan(top(el, "addressLine2"));
    host.style.width = "330px";
    expect(top(el, "city")).toBeGreaterThan(top(el, "postalCode"));
  });

  it("shows the time zone alone until a province settles the fiscal territory, then both on one muted line", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
    const facts = q(el, "[data-test=facts]")!;
    expect(getComputedStyle(facts).color).toBe("rgb(7, 8, 9)");
    expect(facts.textContent!.replace(/\s+/g, " ").trim()).toBe("Time zone: Europe/Madrid");
    expect(q(el, "[data-test=fiscalTerritory]")).toBeNull();
    await type(el, "province", "28");
    expect(q(el, "[data-test=facts]")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Fiscal territory: ES-common · Time zone: Europe/Madrid",
    );
  });

  it("shows the intro in the muted text colour", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
    expect(getComputedStyle(q(el, ".intro")!).color).toBe("rgb(7, 8, 9)");
  });
});

it("advances from a country whose filing module offers no description", async () => {
  const packs = VENUE_SETUP_COUNTRY_PACKS as CountryPack[];
  packs.push({
    ...SPARSE_PACK,
    fiscalJurisdictions: [
      { ...SPARSE_PACK.fiscalJurisdictions[0]!, modules: { filing: "none", tax: "vat" } },
    ],
  });
  try {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await type(el, "country", "ZZ");
    for (const [field, value] of Object.entries({
      taxId: "zz42",
      legalName: "Zed Foods",
      registeredSameAsVenue: "off",
      registeredStreet: "1 Quay",
      registeredPostalCode: "zz-9",
      registeredCity: "Port",
      name: "Harbour",
      addressLine1: "1 Quay",
      postalCode: "zz-9",
      city: "Port",
      province: "North Riding",
      dayCutover: "05:00",
      seriesCode: "A",
      fullSeriesCode: "FF",
      correctiveSeriesCode: "B",
      fullCorrectiveSeriesCode: "FB",
    }))
      await type(el, field, value);
    q(el, "[data-test=next]")!.click();
    expect(events.map(({ kind }) => kind)).toEqual(["patch", "advance"]);
  } finally {
    packs.pop();
  }
});

describe("owner's fixes of 2026-11-20", () => {
  afterEach(() => setLocale("en-GB"));

  it("renders the native venueName input with autocomplete off", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const field = q(el, "[data-test=name]") as HTMLElement & { updateComplete: Promise<unknown> };
    await field.updateComplete;
    const native = field.shadowRoot!.querySelector("input")!;
    expect(native.getAttribute("name")).toBe("venueName");
    expect(native.getAttribute("autocomplete")).toBe("off");
  });

  it("lets the browser fill the venue's and the registered address, each in its own section, and keeps the other text fields off", async () => {
    const packs = VENUE_SETUP_COUNTRY_PACKS as CountryPack[];
    packs.push(SPARSE_PACK);
    try {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
      await type(el, "country", "ZZ");
      await type(el, "registeredSameAsVenue", "off");
      const autocomplete: Record<string, string | null> = {};
      for (const key of [
        "taxId",
        "legalName",
        "registeredStreet",
        "registeredLine2",
        "registeredPostalCode",
        "registeredCity",
        "registeredProvince",
        "name",
        "addressLine1",
        "addressLine2",
        "postalCode",
        "city",
        "province",
        "dayCutover",
        "seriesCode",
        "fullSeriesCode",
        "correctiveSeriesCode",
        "fullCorrectiveSeriesCode",
      ]) {
        const field = q(el, `wt-input[data-test=${key}]`) as HTMLElement & {
          updateComplete: Promise<unknown>;
        };
        await field.updateComplete;
        autocomplete[key] = field.shadowRoot!.querySelector("input")!.getAttribute("autocomplete");
      }
      expect(autocomplete).toEqual({
        taxId: "off",
        legalName: "off",
        registeredStreet: "section-registered address-line1",
        registeredLine2: "section-registered address-line2",
        registeredPostalCode: "section-registered postal-code",
        registeredCity: "section-registered address-level2",
        registeredProvince: "section-registered address-level1",
        name: "off",
        addressLine1: "section-venue address-line1",
        addressLine2: "section-venue address-line2",
        postalCode: "section-venue postal-code",
        city: "section-venue address-level2",
        province: "section-venue address-level1",
        dayCutover: "off",
        seriesCode: "off",
        fullSeriesCode: "off",
        correctiveSeriesCode: "off",
        fullCorrectiveSeriesCode: "off",
      });
    } finally {
      packs.pop();
    }
  });

  it("asks for the receipt language after the province, which decides the languages offered", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const province = q(el, "[data-test=province]")!;
    const facts = q(el, "[data-test=facts]")!;
    const locales = q(el, "fieldset.locales")!;
    expect(
      province.compareDocumentPosition(locales) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(facts.compareDocumentPosition(locales) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      locales.compareDocumentPosition(q(el, "[data-test=dayCutover]")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["en-GB", "Leave the defaults unless you have a good reason to change them."],
    ["es-ES", "Deja los valores predeterminados salvo que tengas un buen motivo para cambiarlos."],
  ] as const)("tells the person to keep the invoice series defaults (%s)", async (locale, text) => {
    setLocale(locale);
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    for (const field of [
      "seriesCode",
      "fullSeriesCode",
      "correctiveSeriesCode",
      "fullCorrectiveSeriesCode",
    ]) {
      expect(
        q(el, `[data-test=${field}] wt-help-tooltip[slot=help]`)!.textContent!.trim(),
        field,
      ).toBe(text);
    }
  });
});
