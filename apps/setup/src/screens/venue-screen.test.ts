import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-screen.js";
import type { SetupVenueScreen } from "./venue-screen.js";
import type { DeepPartial } from "../setup-app.js";
import { VENUE_SETUP_COUNTRY_PACKS, getVenueSetupCountryPack } from "@waitron/country-packs";
import type { CountryPack } from "@waitron/country";
import type { ProvisionBody } from "../api/client.js";

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

/** The invoice-locale checkboxes currently ticked, in render order. */
const ticked = (el: SetupVenueScreen): string[] =>
  [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]')]
    .filter((input) => input.checked)
    .map((input) => input.value);

const VALID: Record<string, string> = {
  country: "ES",
  taxId: "b 1234567 4",
  legalName: "Deli del Sol SL",
  name: "Calle Mayor",
  operationDescription: "Delicatessen",
  addressLine1: "Calle Mayor 1",
  postalCode: "28013",
  city: "Madrid",
  province: "28",
  dayCutover: "06:00",
  tillName: "Mostrador 1",
  seriesCode: "FA",
  rectificativeSeriesCode: "RF",
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
  operationDescription: "Delicatessen",
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
  location: EXPECTED_LOCATION,
  tillName: "Mostrador 1",
  seriesCode: "FA",
  rectificativeSeriesCode: "RF",
};

afterEach(cleanupWidgets);

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

  it("collects every field and emits the nested venue patch, then a screen-agnostic advance", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=next]")!.click();
    // Pinned whole, so a mis-named field fails here.
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { venue: EXPECTED_VENUE } } },
      { kind: "advance", detail: null },
    ]);
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
    expect(ticked(el)).toEqual(["es-ES", "ca-ES"]);
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

  it("keeps an explicitly selected invoice language when the postcode changes", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    await toggleLocale(el, "es-ES", false);
    await toggleLocale(el, "es-ES", true);
    await type(el, "postalCode", "08001");
    expect((q(el, "[data-test=locale-es-ES]") as HTMLInputElement).checked).toBe(true);
    expect((q(el, "[data-test=locale-ca-ES]") as HTMLInputElement).checked).toBe(false);
  });

  it("emits a blank addressLine2 as null, and a filled one as its string", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await type(el, "addressLine2", "   "); // whitespace-only counts as blank
    q(el, "[data-test=next]")!.click();
    let patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.location?.addressLine2).toBeNull();

    const second = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events2 = collect(second.host);
    await fillValid(second.el);
    await type(second.el, "addressLine2", "Piso 2");
    q(second.el, "[data-test=next]")!.click();
    patch = (events2[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.location?.addressLine2).toBe("Piso 2");
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
      defaults: { verifactu: { operationDescription: "Venta en establecimiento" } },
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

  it("seeds the editable fields from the draft so Back-then-forward is non-destructive", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      mode: "prepare",
      venue: {
        country: "ES",
        taxId: "B12345674",
        legalName: "Bar Pepe SL",
        location: {
          name: "Plaza Vieja",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES", "ca-ES"],
          operationDescription: "Bar",
          addressLine1: "Plaza Vieja 3",
          addressLine2: "Local B",
          postalCode: "08002",
          city: "Barcelona",
          province: "Barcelona",
          timeZone: "Atlantic/Canary",
          dayCutover: "05:30",
        },
        tillName: "Barra",
        seriesCode: "AA",
        rectificativeSeriesCode: "RA",
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
    expect((q(el, "[data-test=locale-es-ES]") as HTMLInputElement).checked).toBe(true);
  });

  it("seeds a null addressLine2 as a blank field", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      venue: { location: { addressLine2: null } },
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

  it("blocks Next when seriesCode equals rectificativeSeriesCode, marking both invalid", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el, { seriesCode: "FA", rectificativeSeriesCode: "FA" });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(await bottomAlertOf(el)).not.toBeNull();
    expect(q(el, "[data-test=seriesCode]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=rectificativeSeriesCode]")!.hasAttribute("invalid")).toBe(true);
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
    expect(q(el, "[data-test=fiscalTerritory]")!.textContent).toBe(
      "Fiscal territory: Select province",
    );
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

  it("blocks Next when more than two invoice locales are selected", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await toggleLocale(el, "ca-ES", true);
    await toggleLocale(el, "gl-ES", true); // es-ES + ca-ES + gl-ES = three
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("carries a second locale and the province-derived time zone through into the patch", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    const events = collect(host);
    await fillValid(el);
    await toggleLocale(el, "en-GB", true);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.venue?.location?.invoiceLocales).toEqual(["es-ES", "en-GB"]);
    expect(patch.venue?.location?.timeZone).toBe("Europe/Madrid");
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

  it("maps the server's nested field path onto this form's own field", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "location.operationDescription",
    });
    const input = q(el, "[data-test=operationDescription]")!;
    await (input as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(input.hasAttribute("invalid")).toBe(true);
    expect(input.shadowRoot!.querySelector("[data-error]")!.textContent).toContain(
      "500 characters",
    );
  });

  it("marks nothing for a field path this form does not recognise", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "taxId",
    });
    expect(q(el, "[data-test=taxId]")!.hasAttribute("invalid")).toBe(false);
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
    el.errorMessage = "The country must match the fiscal territory.";
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

describe("A2 shop form", () => {
  const defaults = { verifactu: { operationDescription: "Venta en establecimiento" } };
  it("prefills the first till and invoice series, using the fiscal description default", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { defaults });
    for (const [field, value] of Object.entries({
      tillName: "Caja 1",
      seriesCode: "FS",
      rectificativeSeriesCode: "FR",
      dayCutover: "04:00",
      operationDescription: "Venta en establecimiento",
    })) {
      expect((q(el, `[data-test=${field}]`) as HTMLInputElement).value).toBe(value);
    }
  });
  it("collects only a location name and address in Demo, generating a valid company identity", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
      defaults,
    });
    const events = collect(host);
    for (const field of [
      "taxId",
      "legalName",
      "operationDescription",
      "dayCutover",
      "tillName",
      "seriesCode",
      "rectificativeSeriesCode",
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
    expect(venue.taxId).toMatch(/^B[0-9]{8}$/);
    expect(venue.legalName).toBe("Calle Mayor");
    expect(venue.seriesCode).toBe("FS");
    expect(venue.rectificativeSeriesCode).toBe("FR");
    expect(venue.location.operationDescription).toBe("Venta en establecimiento");
    const validation = getVenueSetupCountryPack("ES")!.taxIdentifier!.validate(venue.taxId);
    expect(validation).toEqual({ valid: true, normalized: venue.taxId, kind: "entity" });
    const returned = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo", venue },
      defaults,
    });
    const replay = collect(returned.host);
    q(returned.el, "[data-test=next]")!.click();
    expect((replay[0]!.detail as { patch: ProvisionBody }).patch.venue).toEqual(venue);
  });
  it("explains each missing text field and provides help and visible required markers", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { defaults });
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    for (const field of ["taxId", "legalName", "name", "addressLine1", "postalCode", "city"]) {
      const input = q(el, `[data-test=${field}]`)!;
      expect(input.getAttribute("error")).not.toBe("");
      expect(input.hasAttribute("required")).toBe(true);
      expect(input.querySelector("wt-help-tooltip")).not.toBeNull();
    }
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "wt-form-actions")).not.toBeNull();
  });
});

it.each(["prepare", "live"] as const)(
  "never calls the company identity generator in %s",
  async (mode) => {
    const generator = vi.spyOn(getVenueSetupCountryPack("ES")!.demo!, "createCompanyTaxId");
    try {
      const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", { draft: { mode } });
      await type(el, "postalCode", "28013");
      q(el, "[data-test=next]")!.click();
      expect(generator).not.toHaveBeenCalled();
      expect((q(el, "[data-test=taxId]") as HTMLInputElement).value).toBe("");
    } finally {
      generator.mockRestore();
    }
  },
);
it("keeps edited descriptions when defaults arrive late", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "operationDescription", "Venta de comidas");
  el.defaults = { verifactu: { operationDescription: "Venta en establecimiento" } };
  await el.updateComplete;
  expect((q(el, "[data-test=operationDescription]") as HTMLInputElement).value).toBe(
    "Venta de comidas",
  );
});
it("offers a retry when Demo defaults are unavailable, without generating a partial venue", async () => {
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
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(q(el, "[data-test=retry-defaults]")).not.toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(q(el, "[role=alert]"));
});
it("maps a Demo legal-name refusal to the visible location name", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo" },
    invalidField: "legalName",
  });
  const name = q(el, "[data-test=name]")!;
  expect(name.hasAttribute("invalid")).toBe(true);
  expect(name.getAttribute("error")).toContain("characters");
});

it.each([
  ["seriesCode", "server_fields.series_code"],
  ["rectificativeSeriesCode", "server_fields.series_code"],
  ["location.operationDescription", "server_fields.operation_description"],
] as const)(
  "shows a Demo refusal of the hidden %s above Next, and pressing Next tries again",
  async (invalidField, message) => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
      defaults: { verifactu: { operationDescription: "Venta en establecimiento" } },
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

it("explains an unsupported Demo province instead of asking to reload defaults", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo" },
    defaults: { verifactu: { operationDescription: "Venta en establecimiento" } },
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
  expect(q(el, "[data-test=retry-defaults]")).toBeNull();
});

it("derives invoice language from the retained province after leaving Demo", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: {
      mode: "prepare",
      venue: { country: "ES", location: { province: "Barcelona", postalCode: "08001" } },
    },
  });
  expect((q(el, "[data-test=locale-ca-ES]") as HTMLInputElement).checked).toBe(true);
  expect((q(el, "[data-test=locale-es-ES]") as HTMLInputElement).checked).toBe(true);
});

it("shows the fiscal territory under the province, not above the address", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  const nodes = [...el.shadowRoot!.querySelectorAll("[data-test]")].map((n) =>
    n.getAttribute("data-test"),
  );
  expect(nodes.indexOf("fiscalTerritory")).toBeGreaterThan(nodes.indexOf("province"));
  expect(Math.abs(nodes.indexOf("fiscalTerritory") - nodes.indexOf("timeZone"))).toBe(1);
});

it("pre-ticks Spanish alongside a regional language", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "08"); // Barcelona — Catalan
  expect(ticked(el)).toEqual(["es-ES", "ca-ES"]);
});

it("puts Spanish first in the invoice languages it emits", async () => {
  // The checkbox reader above cannot see this: the boxes always render in the pack's own order, so a
  // helper that returned Catalan first would still read as ["es-ES", "ca-ES"]. The emitted patch is
  // where the order is observable.
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  const events = collect(host);
  await fillValid(el, { postalCode: "08001", province: "08", city: "Barcelona" });
  q(el, "[data-test=next]")!.click();
  const patch = (events[0]!.detail as { patch: DeepPartial<ProvisionBody> }).patch;
  expect(patch.venue?.location?.invoiceLocales).toEqual(["es-ES", "ca-ES"]);
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
        location: { province: "Barcelona", invoiceLocales: ["es-ES", "ca-ES"] },
      },
    },
  });
  expect(ticked(el)).toEqual(["es-ES", "ca-ES"]);
  await type(el, "province", "15"); // A Coruña — Galician
  expect(ticked(el)).toEqual(["es-ES", "gl-ES"]);
});

it("keeps languages the draft customised when the province changes", async () => {
  // The other side of the same flag: these are not the province's defaults, so somebody chose them
  // and the province must not overwrite the choice.
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: {
      venue: {
        country: "ES",
        location: { province: "Barcelona", invoiceLocales: ["es-ES", "en-GB"] },
      },
    },
  });
  await type(el, "province", "15");
  expect(ticked(el)).toEqual(["es-ES", "en-GB"]);
});

it("keeps the operator's own choice when the province changes", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "country", "ES");
  await type(el, "province", "08");
  await toggleLocale(el, "ca-ES", false); // the operator unticks Catalan
  await type(el, "province", "17"); // Girona — also Catalan
  expect(ticked(el)).toEqual(["es-ES"]);
});

it("does not move the province while the postcode typed so far is incomplete", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  await type(el, "province", "08");
  await type(el, "postalCode", "2800");
  expect((q(el, "[data-test=province]") as HTMLSelectElement).value).toBe("08");
  expect(ticked(el)).toEqual(["es-ES", "ca-ES"]);
});

it("submits the form when Enter is pressed in a field", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
  const events = collect(host);
  await fillValid(el);
  q(el, "[data-test=city]")!.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Enter}");
  expect(events).toEqual([
    { kind: "patch", detail: { patch: { venue: EXPECTED_VENUE } } },
    { kind: "advance", detail: null },
  ]);
});

it("asks the shell to reload the Demo defaults when the retry is pressed", async () => {
  const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft: { mode: "demo" },
  });
  const requests: Event[] = [];
  host.addEventListener("setup-defaults-requested", (event) => requests.push(event));
  q(el, "[data-test=retry-defaults]")!.click();
  expect(requests).toHaveLength(1);
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
    draft: { venue: { country: "GB", location: { province: "Kent" } } },
    defaults: { verifactu: { operationDescription: "Venta en establecimiento" } },
  });
  const events = collect(host);
  expect((q(el, "[data-test=operationDescription]") as HTMLInputElement).value).toBe("");
  expect(q(el, "[data-test=taxId]")!.getAttribute("label")).toBe("Tax ID");
  expect(el.shadowRoot!.querySelectorAll('input[name="invoiceLocales"]')).toHaveLength(0);
  expect(q(el, "[data-test=province]")!.tagName).toBe("WT-INPUT");
  expect(q(el, "[data-test=fiscalTerritory]")!.textContent).toBe(
    "Fiscal territory: Select province",
  );
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
      name: "Harbour",
      operationDescription: "Groceries",
      addressLine1: "1 Quay",
      postalCode: " zz-9 ",
      city: "Port",
      province: "North Riding",
      dayCutover: "05:00",
      tillName: "Till",
      seriesCode: "A",
      rectificativeSeriesCode: "B",
    }))
      await type(el, field, value);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([
      {
        kind: "patch",
        detail: {
          patch: {
            venue: {
              country: "ZZ",
              taxId: " zz 42 ",
              legalName: "Zed Foods",
              location: {
                name: "Harbour",
                fiscalTerritory: "ZZ-main",
                invoiceLocales: ["zz-ZZ"],
                operationDescription: "Groceries",
                addressLine1: "1 Quay",
                addressLine2: null,
                postalCode: " zz-9 ",
                city: "Port",
                province: "North Riding",
                timeZone: "Etc/GMT-3",
                dayCutover: "05:00",
              },
              tillName: "Till",
              seriesCode: "A",
              rectificativeSeriesCode: "B",
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
    expect(q(el, "[data-test=legalName] wt-help-tooltip")!.getAttribute("aria-label")).toBe(
      "Ayuda sobre la razón social",
    );
    expect(q(el, "[data-test=timeZone]")!.textContent).toBe("Zona horaria: Europe/Madrid");
    expect(q(el, "[data-test=back]")!.textContent).toBe("Volver");
  });

  it("names English in Spanish followed by its own name, as it does the other languages", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {});
    expect(q(el, "[data-test=locale-en-GB]")!.parentElement!.textContent!.trim()).toBe(
      "Inglés (English)",
    );
  });

  it("redraws a Demo legal-name refusal, shown on the location name, in Spanish", async () => {
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      draft: { mode: "demo" },
      invalidField: "legalName",
    });
    const english = q(el, "[data-test=name]")!.getAttribute("error");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "[data-test=name]")!.getAttribute("error")).toBe(t("server_fields.legal_name"));
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
