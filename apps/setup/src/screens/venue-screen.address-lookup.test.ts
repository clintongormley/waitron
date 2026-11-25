import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { AddressAutocompleteProvider } from "@waitron/country";
import type {
  AddressLookupProvider,
  AddressLookupResult,
  WtAddressLookup,
} from "@waitron/ui/src/components/wt-address-lookup.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-screen.js";
import type { SetupVenueScreen } from "./venue-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

// The country package's seam and the field's provider must stay the same shape.
const seam: AddressLookupProvider = {} as AddressAutocompleteProvider;
void seam;

const MADRID: AddressLookupResult = {
  lines: ["Calle Mayor 1"],
  locality: "Madrid",
  administrativeAreaCode: "28",
  postalCode: "28013",
  countryCode: "ES",
};
const BARCELONA: AddressLookupResult = {
  lines: ["Carrer de Pelai 1"],
  locality: "Barcelona",
  administrativeAreaCode: "08",
  postalCode: "08001",
  countryCode: "ES",
};

function providerFor(address: AddressLookupResult): AddressLookupProvider {
  return {
    suggest: async () => [{ id: "s1", label: address.lines[0]! }],
    resolve: async () => address,
  };
}

const q = (el: SetupVenueScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const value = (el: SetupVenueScreen, key: string) =>
  (q(el, `[data-test=${key}]`) as HTMLElement & { value: string }).value;
const lookup = (el: SetupVenueScreen, which = "addressLine1") =>
  q(el, `[data-test=${which}]`) as WtAddressLookup | null;

async function mount(
  props: Partial<SetupVenueScreen> = {},
  draft: DeepPartial<ProvisionBody> = {},
): Promise<SetupVenueScreen> {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    draft,
    ...props,
  } as Partial<SetupVenueScreen>);
  return el;
}

async function choose(
  el: SetupVenueScreen,
  address: AddressLookupResult,
  which = "addressLine1",
): Promise<void> {
  lookup(el, which)!.dispatchEvent(
    new CustomEvent("wt-address-chosen", {
      detail: { address },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}

async function type(el: SetupVenueScreen, field: string, text: string): Promise<void> {
  const detail = field === "registeredSameAsVenue" ? { checked: text === "on" } : { value: text };
  q(el, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

const sameAsVenue = (el: SetupVenueScreen) =>
  (q(el, "[data-test=registeredSameAsVenue]") as HTMLElement & { checked: boolean }).checked;

function collect(el: SetupVenueScreen): DeepPartial<ProvisionBody>[] {
  const patches: DeepPartial<ProvisionBody>[] = [];
  el.addEventListener("setup-patch", (event) =>
    patches.push((event as CustomEvent<{ patch: DeepPartial<ProvisionBody> }>).detail.patch),
  );
  return patches;
}

async function fillTheRest(el: SetupVenueScreen): Promise<void> {
  for (const [key, text] of Object.entries({
    taxId: "b 1234567 4",
    legalName: "Deli del Sol SL",
    name: "Calle Mayor",
  }))
    await type(el, key, text);
}

describe("the venue screen's address search", () => {
  it("keeps both manual street fields without a provider", async () => {
    const el = await mount();
    await type(el, "registeredSameAsVenue", "off");
    for (const which of ["addressLine1", "registeredStreet"]) {
      expect(lookup(el, which)!.provider).toBeUndefined();
      expect(lookup(el, which)!.getBoundingClientRect().height).toBeGreaterThan(0);
    }
  });

  it("keeps address suggestions off until Spain is selected", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) }, { venue: { country: "" } });
    await type(el, "registeredSameAsVenue", "off");
    for (const which of ["addressLine1", "registeredStreet"])
      expect(lookup(el, which)!.provider).toBeUndefined();
    await type(el, "country", "ES");
    for (const which of ["addressLine1", "registeredStreet"])
      expect(lookup(el, which)!.provider).toBeDefined();
  });

  it("skips generic street words from Spain's pack with or without accents", async () => {
    const ask = vi.fn(providerFor(MADRID).suggest);
    const el = await mount({ addressProvider: { ...providerFor(MADRID), suggest: ask } });
    const street = lookup(el)!;
    street.delay = 0;
    const input = street.shadowRoot!.querySelector("input")!;
    for (const text of ["PLAÇA ", "placa,", "C/ ", "Carrer de la ", "rúa ", "kalea ", "12 "]) {
      await userEvent.fill(input, text);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(ask).not.toHaveBeenCalled();
    await userEvent.fill(input, "Kale Nagusia ");
    await expect
      .poll(() => ask.mock.calls.map(([request]) => request.query))
      .toEqual(["Kale Nagusia"]);
    const options = () => street.shadowRoot!.querySelectorAll('[role="option"]');
    await expect.poll(options).toHaveLength(1);
    await userEvent.fill(input, "Kale Nagusia, ");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options()).toHaveLength(1);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("offers a suggestion from the street and advances with a hand-edited street on Enter", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const patches = collect(el);
    await fillTheRest(el);
    const street = q(el, "[data-test=addressLine1]") as WtAddressLookup;
    street.delay = 0;
    const input = street.shadowRoot!.querySelector("input")!;
    await userEvent.fill(input, "Calle Mayo");
    const option = () => street.shadowRoot!.querySelector<HTMLElement>('[role="option"]');
    await expect.poll(option).not.toBeNull();
    await userEvent.click(option()!);
    await expect.poll(() => street.value).toBe("Calle Mayor 1");
    await userEvent.fill(input, "Calle Mayor 8");
    await userEvent.keyboard("{Enter}");
    expect(patches[0]?.venue).toMatchObject({
      addressLine1: "Calle Mayor 8",
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
    });
  });

  it("fills the address fields from a chosen address, and Next sends them", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const patches = collect(el);
    await fillTheRest(el);
    await choose(el, MADRID);
    expect(value(el, "addressLine1")).toBe("Calle Mayor 1");
    expect(value(el, "postalCode")).toBe("28013");
    expect(value(el, "city")).toBe("Madrid");
    expect(value(el, "province")).toBe("28");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(patches[0]!.venue!).toMatchObject({
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
    });
  });

  it("keeps the credit with each chosen address until that address is edited", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const address = { ...MADRID, attribution: "Google Maps" };
    const credit = (which?: string) =>
      lookup(el, which)?.shadowRoot!.querySelector('[part="attribution"]')?.textContent;
    await choose(el, address);
    await type(el, "registeredSameAsVenue", "off");
    await choose(el, address, "registeredStreet");
    expect(credit()).toBe("Google Maps");
    expect(credit("registeredStreet")).toBe("Google Maps");

    await type(el, "registeredSameAsVenue", "on");
    expect(credit("registeredStreet")).toBeUndefined();
    await type(el, "registeredSameAsVenue", "off");
    expect(credit("registeredStreet")).toBe("Google Maps");
    await type(el, "registeredStreet", "My registered street");
    expect(credit("registeredStreet")).toBeUndefined();
    expect(credit()).toBe("Google Maps");
    await type(el, "addressLine1", "My street");
    expect(credit()).toBeUndefined();
  });

  it("keeps the person's own address line 2 when the chosen address has one line", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await type(el, "addressLine2", "3º B");
    await choose(el, MADRID);
    expect(value(el, "addressLine2")).toBe("3º B");
  });

  it("leaves blank later lines out, so they neither replace nor pad either line 2", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await type(el, "addressLine2", "3º B");
    await choose(el, { ...MADRID, lines: ["Calle Mayor 1", " ", ""] });
    expect(value(el, "addressLine2")).toBe("3º B");
    await choose(el, { ...MADRID, lines: ["Calle Mayor 1", "", "Puerta 4"] });
    expect(value(el, "addressLine2")).toBe("Puerta 4");
    await type(el, "registeredSameAsVenue", "off");
    await choose(el, { ...MADRID, lines: ["Calle Mayor 1", "Escalera 2"] }, "registeredStreet");
    await choose(el, { ...MADRID, lines: ["Calle Mayor 1", " "] }, "registeredStreet");
    expect(value(el, "registeredLine2")).toBe("Escalera 2");
  });

  it("replaces address line 2 with the chosen address's later lines", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await type(el, "addressLine2", "3º B");
    await choose(el, { ...MADRID, lines: ["Calle Mayor 1", "Escalera 2", "Puerta 4"] });
    expect(value(el, "addressLine2")).toBe("Escalera 2, Puerta 4");
  });

  it("takes the province from the postcode when the address names none the country knows", async () => {
    const el = await mount({ addressProvider: providerFor(BARCELONA) });
    await choose(el, { ...BARCELONA, administrativeAreaCode: undefined });
    expect(value(el, "province")).toBe("08");
    await choose(el, { ...MADRID, administrativeAreaCode: "XX" });
    expect(value(el, "province")).toBe("28");
  });

  it("takes the province by its name as well as its code", async () => {
    const el = await mount({ addressProvider: providerFor(BARCELONA) });
    await choose(el, { ...BARCELONA, administrativeAreaCode: "Barcelona" });
    expect(value(el, "province")).toBe("08");
  });

  it("lets the area code win a disagreement with the postcode, marking both on Next", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const patches = collect(el);
    await fillTheRest(el);
    await choose(el, { ...MADRID, administrativeAreaCode: "08" });
    expect(value(el, "province")).toBe("08");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(patches).toEqual([]);
    expect(q(el, "[data-test=postalCode]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=province]")!.hasAttribute("invalid")).toBe(true);
  });

  it("moves the receipt language and the fiscal territory with the chosen province", async () => {
    const el = await mount({ addressProvider: providerFor(BARCELONA) });
    await choose(el, BARCELONA);
    const ticked = [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]'),
    ]
      .filter((input) => input.checked)
      .map((input) => input.value);
    expect(ticked).toEqual(["ca-ES"]);
    expect(q(el, "[data-test=fiscalTerritory]")!.textContent).toContain("ES-common");
  });

  it("re-seeds receipt languages that still follow the province, as choosing the province does", async () => {
    const el = await mount(
      { addressProvider: providerFor(MADRID) },
      { venue: { country: "ES", province: "Barcelona", invoiceLocales: ["ca-ES"] } },
    );
    await choose(el, { ...MADRID, administrativeAreaCode: "15", postalCode: "15001" });
    const ticked = [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]'),
    ]
      .filter((input) => input.checked)
      .map((input) => input.value);
    expect(ticked).toEqual(["es-ES"]);
  });

  it("moves an automatic Demo venue name with the chosen province", async () => {
    const el = await mount({ addressProvider: providerFor(BARCELONA) }, { mode: "demo" });
    expect(value(el, "name")).toBe("Casa Delgado");
    await choose(el, BARCELONA);
    expect(value(el, "name")).toBe("Can Delgado");
  });

  it("clears the server's mark on the registered address once a chosen address fills it", async () => {
    const el = await mount({
      addressProvider: providerFor(MADRID),
      invalidField: "taxpayerDomicile",
    });
    await type(el, "registeredSameAsVenue", "off");
    expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("invalid")).toBe(true);
    await choose(el, MADRID, "registeredStreet");
    expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("invalid")).toBe(false);
  });

  it("shows no refusal of the venue's address on the parts a chosen registered address fills", async () => {
    const el = await mount({
      addressProvider: providerFor(MADRID),
      invalidField: "taxpayerDomicile",
    });
    expect(sameAsVenue(el)).toBe(true);
    await type(el, "registeredSameAsVenue", "off");
    await choose(el, BARCELONA, "registeredStreet");
    expect(sameAsVenue(el)).toBe(false);
    expect(q(el, "[data-test=registeredStreet]")!.hasAttribute("invalid")).toBe(false);
    expect(el.shadowRoot!.querySelectorAll("[invalid]")).toHaveLength(0);
  });

  it("refuses an address in another country, filling nothing and saying why", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await type(el, "addressLine1", "Mine");
    await choose(el, { ...MADRID, countryCode: "PT", postalCode: "1100-148" });
    expect(value(el, "addressLine1")).toBe("Mine");
    expect(value(el, "postalCode")).toBe("");
    expect(lookup(el)!.message).toBe(
      "That address is not in Spain. Choose another or edit the street address.",
    );
    await choose(el, MADRID);
    expect(lookup(el)!.message).toBe("");
  });

  it("Enter on a suggestion fills the fields and does not press Next", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const patches = collect(el);
    await fillTheRest(el);
    const field = lookup(el)!;
    field.delay = 0;
    const input = field.shadowRoot!.querySelector("input")!;
    input.focus();
    await userEvent.fill(input, "Calle Mayor");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await field.updateComplete;
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await el.updateComplete;
    expect(value(el, "addressLine1")).toBe("Calle Mayor 1");
    expect(patches).toEqual([]);
  });

  it("shows the registered street below the switch only when a separate address is needed", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const control = q(el, "[data-test=registeredSameAsVenue]")!;
    const toggle = control.shadowRoot!.querySelector("input")!;
    const domicile = lookup(el, "registeredStreet")!;
    expect(domicile.getBoundingClientRect().height).toBe(0);
    expect(lookup(el)!.hidden).toBe(false);

    toggle.focus();
    await userEvent.keyboard(" ");
    await domicile.updateComplete;
    const searchBox = domicile.getBoundingClientRect();
    expect(searchBox.height).toBeGreaterThan(0);
    expect(searchBox.top).toBeGreaterThanOrEqual(control.getBoundingClientRect().bottom);
    expect(searchBox.bottom).toBeLessThanOrEqual(
      q(el, "[data-test=registeredLine2]")!.getBoundingClientRect().top,
    );

    await userEvent.keyboard(" ");
    await domicile.updateComplete;
    expect(domicile.getBoundingClientRect().height).toBe(0);
  });

  it("fills the separate registered business address in its parts, outside Demo only", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const patches = collect(el);
    await type(el, "registeredSameAsVenue", "off");
    await choose(
      el,
      { ...MADRID, lines: ["Calle Mayor 1", "3º B"], administrativeAreaCode: "Madrid" },
      "registeredStreet",
    );
    expect(sameAsVenue(el)).toBe(false);
    expect(value(el, "registeredStreet")).toBe("Calle Mayor 1");
    expect(value(el, "registeredLine2")).toBe("3º B");
    expect(value(el, "registeredPostalCode")).toBe("28013");
    expect(value(el, "registeredCity")).toBe("Madrid");
    expect(value(el, "registeredProvince")).toBe("28");
    expect(value(el, "addressLine1")).toBe("");
    await fillTheRest(el);
    await choose(el, BARCELONA);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(patches[0]!.venue!.taxpayerDomicile).toBe("Calle Mayor 1, 3º B, 28013 Madrid, Madrid");
    const demo = await mount({ addressProvider: providerFor(MADRID) }, { mode: "demo" });
    expect(lookup(demo, "registeredStreet")).toBeNull();
  });

  it("refuses a registered address in another country on its own line", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await type(el, "registeredSameAsVenue", "off");
    await choose(el, { ...MADRID, countryCode: "PT" }, "registeredStreet");
    expect(sameAsVenue(el)).toBe(false);
    for (const part of ["registeredStreet", "registeredPostalCode", "registeredCity"])
      expect(value(el, part), part).toBe("");
    expect(lookup(el, "registeredStreet")!.message).not.toBe("");
    expect(lookup(el)!.message).toBe("");
  });

  it("names its two street fields for the address each fills", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const nameOf = (which: string) =>
      lookup(el, which)!.shadowRoot!.querySelector("input")!.getAttribute("name");
    expect(nameOf("addressLine1")).toBe("addressLine1");
    expect(nameOf("registeredStreet")).toBe("registeredStreet");
  });

  async function startChoosing(
    el: SetupVenueScreen,
    which: string,
    query = "Calle Mayor",
  ): Promise<void> {
    const field = lookup(el, which)!;
    field.delay = 0;
    const input = field.shadowRoot!.querySelector("input")!;
    await userEvent.fill(input, query);
    await vi.waitFor(() =>
      expect(field.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
    );
    await userEvent.click(field.shadowRoot!.querySelector('[role="option"]')!);
  }

  it("drops a chosen address still on its way once the person types into a field it fills", async () => {
    for (const [which, edited] of [
      ["addressLine1", "addressLine1"],
      ["addressLine1", "addressLine2"],
      ["addressLine1", "postalCode"],
      ["addressLine1", "city"],
      ["registeredStreet", "registeredStreet"],
    ] as const) {
      const answers: ((address: AddressLookupResult) => void)[] = [];
      const el = await mount({
        addressProvider: {
          ...providerFor(MADRID),
          resolve: () => new Promise((resolve) => answers.push(resolve)),
        },
      });
      if (which === "registeredStreet") await type(el, "registeredSameAsVenue", "off");
      await startChoosing(el, which);
      await type(el, edited, "Typed by hand");
      answers[0]!(MADRID);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(value(el, edited), edited).toBe("Typed by hand");
      expect(value(el, which === "addressLine1" ? "city" : "registeredCity"), edited).not.toBe(
        "Madrid",
      );
      cleanupWidgets();
    }
  });

  it("keeps the latest switch choice when a registered address arrives after it", async () => {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    const el = await mount({
      addressProvider: {
        ...providerFor(MADRID),
        resolve: () => new Promise((resolve) => answers.push(resolve)),
      },
    });
    await type(el, "registeredSameAsVenue", "off");
    await startChoosing(el, "registeredStreet", "Mine");
    await type(el, "registeredSameAsVenue", "on");
    answers[0]!(MADRID);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(sameAsVenue(el)).toBe(true);
    await type(el, "registeredSameAsVenue", "off");
    expect(value(el, "registeredStreet")).toBe("Mine");
    expect(value(el, "registeredCity")).toBe("");
  });

  it("drops a chosen address still on its way once the person picks a province", async () => {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    const el = await mount({
      addressProvider: {
        ...providerFor(BARCELONA),
        resolve: () => new Promise((resolve) => answers.push(resolve)),
      },
    });
    await startChoosing(el, "addressLine1");
    q(el, "[data-test=province]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "28" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    answers[0]!(BARCELONA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(value(el, "province")).toBe("28");
    expect(value(el, "addressLine1")).toBe("Calle Mayor");
  });

  it("still fills from a chosen address when a field it does not fill was edited meanwhile", async () => {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    const el = await mount({
      addressProvider: {
        ...providerFor(MADRID),
        resolve: () => new Promise((resolve) => answers.push(resolve)),
      },
    });
    await startChoosing(el, "addressLine1");
    await type(el, "legalName", "Deli del Sol SL");
    answers[0]!(MADRID);
    await vi.waitFor(() => expect(value(el, "addressLine1")).toBe("Calle Mayor 1"));
  });

  it("typing a new street clears an earlier suggestion refusal", async () => {
    const el = await mount({
      addressProvider: { ...providerFor(MADRID), suggest: async () => [] },
    });
    await choose(el, { ...MADRID, countryCode: "PT" });
    const field = lookup(el)!;
    const status = () =>
      field.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim() ?? "";
    expect(status()).toBe(
      "That address is not in Spain. Choose another or edit the street address.",
    );
    field.delay = 0;
    const input = field.shadowRoot!.querySelector("input")!;
    await userEvent.fill(input, "Nowhere street");
    await vi.waitFor(() => expect(status()).toBe(""));
  });

  it("speaks Spanish", async () => {
    setLocale("es-ES");
    const el = await mount({ addressProvider: providerFor(MADRID) });
    expect(lookup(el)!.label).toBe(t("venue.label.address_line1"));
    await choose(el, { ...MADRID, countryCode: "PT" });
    expect(lookup(el)!.message).toBe(
      "Esa dirección no está en España. Elige otra o edita la calle.",
    );
  });
});
