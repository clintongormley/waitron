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
import { setLocale } from "../i18n/t.js";
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
const lookup = (el: SetupVenueScreen, which = "address-lookup") =>
  q(el, `[data-test=${which}]`) as WtAddressLookup | null;

async function mount(
  props: Partial<SetupVenueScreen> = {},
  draft: DeepPartial<ProvisionBody> = {},
): Promise<SetupVenueScreen> {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    defaults: { verifactu: { operationDescription: "Venta en establecimiento" } },
    draft,
    ...props,
  } as Partial<SetupVenueScreen>);
  return el;
}

async function choose(
  el: SetupVenueScreen,
  address: AddressLookupResult,
  which = "address-lookup",
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
  q(el, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

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
    taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
    name: "Calle Mayor",
  }))
    await type(el, key, text);
}

describe("the venue screen's address search", () => {
  it("is hidden without a provider, so the form is its manual fields alone", async () => {
    const el = await mount();
    for (const which of ["address-lookup", "domicile-lookup"]) {
      expect(lookup(el, which)!.hidden).toBe(true);
      expect(lookup(el, which)!.getBoundingClientRect().height).toBe(0);
    }
  });

  it("asks for addresses in the chosen country, above address line 1", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const field = lookup(el)!;
    expect(field.hidden).toBe(false);
    expect(field.countryCode).toBe("ES");
    const tests = [...el.shadowRoot!.querySelectorAll("[data-test]")].map((n) =>
      n.getAttribute("data-test"),
    );
    expect(tests.indexOf("address-lookup")).toBe(tests.indexOf("addressLine1") - 1);
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
    expect(patches[0]!.venue!.location).toMatchObject({
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
    });
  });

  it("keeps the person's own address line 2 when the chosen address has one line", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await type(el, "addressLine2", "3º B");
    await choose(el, MADRID);
    expect(value(el, "addressLine2")).toBe("3º B");
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
      { venue: { country: "ES", location: { province: "Barcelona", invoiceLocales: ["ca-ES"] } } },
    );
    await choose(el, { ...MADRID, administrativeAreaCode: "15", postalCode: "15001" });
    const ticked = [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]'),
    ]
      .filter((input) => input.checked)
      .map((input) => input.value);
    expect(ticked).toEqual(["es-ES"]);
  });

  it("moves an automatic Demo location name with the chosen province", async () => {
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
    expect(q(el, "[data-test=taxpayerDomicile]")!.hasAttribute("invalid")).toBe(true);
    await choose(el, MADRID, "domicile-lookup");
    expect(q(el, "[data-test=taxpayerDomicile]")!.hasAttribute("invalid")).toBe(false);
  });

  it("refuses an address in another country, filling nothing and saying why", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await type(el, "addressLine1", "Mine");
    await choose(el, { ...MADRID, countryCode: "PT", postalCode: "1100-148" });
    expect(value(el, "addressLine1")).toBe("Mine");
    expect(value(el, "postalCode")).toBe("");
    expect(lookup(el)!.message).toBe(
      "That address is not in Spain. Choose another or type it below.",
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
    await userEvent.keyboard("Calle Mayor");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await field.updateComplete;
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await el.updateComplete;
    expect(value(el, "addressLine1")).toBe("Calle Mayor 1");
    expect(patches).toEqual([]);
  });

  it("fills the registered business address as one line, outside Demo only", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const domicile = lookup(el, "domicile-lookup")!;
    expect(domicile.hidden).toBe(false);
    const tests = [...el.shadowRoot!.querySelectorAll("[data-test]")].map((n) =>
      n.getAttribute("data-test"),
    );
    expect(tests.indexOf("domicile-lookup")).toBe(tests.indexOf("taxpayerDomicile") - 1);
    await choose(el, { ...MADRID, lines: ["Calle Mayor 1", "3º B"] }, "domicile-lookup");
    expect(value(el, "taxpayerDomicile")).toBe("Calle Mayor 1, 3º B, 28013 Madrid, Madrid");
    expect(value(el, "addressLine1")).toBe("");
    const demo = await mount({ addressProvider: providerFor(MADRID) }, { mode: "demo" });
    expect(lookup(demo, "domicile-lookup")).toBeNull();
  });

  it("refuses a registered address in another country on its own line", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    await choose(el, { ...MADRID, countryCode: "PT" }, "domicile-lookup");
    expect(value(el, "taxpayerDomicile")).toBe("");
    expect(lookup(el, "domicile-lookup")!.message).not.toBe("");
    expect(lookup(el)!.message).toBe("");
  });

  it("names its two search fields for the address each fills", async () => {
    const el = await mount({ addressProvider: providerFor(MADRID) });
    const nameOf = (which: string) =>
      lookup(el, which)!.shadowRoot!.querySelector("input")!.getAttribute("name");
    expect(nameOf("address-lookup")).toBe("address-search");
    expect(nameOf("domicile-lookup")).toBe("domicile-search");
  });

  async function startChoosing(el: SetupVenueScreen, which: string): Promise<void> {
    const field = lookup(el, which)!;
    field.delay = 0;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "Calle Mayor";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await vi.waitFor(() =>
      expect(field.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
    );
    await userEvent.click(field.shadowRoot!.querySelector('[role="option"]')!);
  }

  it("drops a chosen address still on its way once the person types into a field it fills", async () => {
    for (const [which, edited] of [
      ["address-lookup", "addressLine1"],
      ["address-lookup", "addressLine2"],
      ["address-lookup", "postalCode"],
      ["address-lookup", "city"],
      ["domicile-lookup", "taxpayerDomicile"],
    ] as const) {
      const answers: ((address: AddressLookupResult) => void)[] = [];
      const el = await mount({
        addressProvider: {
          ...providerFor(MADRID),
          resolve: () => new Promise((resolve) => answers.push(resolve)),
        },
      });
      await startChoosing(el, which);
      await type(el, edited, "Typed by hand");
      answers[0]!(MADRID);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(value(el, edited), edited).toBe("Typed by hand");
      if (which === "address-lookup") expect(value(el, "city"), edited).not.toBe("Madrid");
      cleanupWidgets();
    }
  });

  it("drops a chosen address still on its way once the person picks a province", async () => {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    const el = await mount({
      addressProvider: {
        ...providerFor(BARCELONA),
        resolve: () => new Promise((resolve) => answers.push(resolve)),
      },
    });
    await startChoosing(el, "address-lookup");
    q(el, "[data-test=province]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "28" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    answers[0]!(BARCELONA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(value(el, "province")).toBe("28");
    expect(value(el, "addressLine1")).toBe("");
  });

  it("still fills from a chosen address when a field it does not fill was edited meanwhile", async () => {
    const answers: ((address: AddressLookupResult) => void)[] = [];
    const el = await mount({
      addressProvider: {
        ...providerFor(MADRID),
        resolve: () => new Promise((resolve) => answers.push(resolve)),
      },
    });
    await startChoosing(el, "address-lookup");
    await type(el, "legalName", "Deli del Sol SL");
    answers[0]!(MADRID);
    await vi.waitFor(() => expect(value(el, "addressLine1")).toBe("Calle Mayor 1"));
  });

  it("a new search with no results shows its own line in place of an earlier refusal", async () => {
    const el = await mount({
      addressProvider: { ...providerFor(MADRID), suggest: async () => [] },
    });
    await choose(el, { ...MADRID, countryCode: "PT" });
    const field = lookup(el)!;
    const status = () =>
      field.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim() ?? "";
    expect(status()).toBe("That address is not in Spain. Choose another or type it below.");
    field.delay = 0;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "Nowhere street";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await vi.waitFor(() => expect(status()).toBe("No address found. Type it below."));
  });

  it("speaks Spanish", async () => {
    setLocale("es-ES");
    const el = await mount({ addressProvider: providerFor(MADRID) });
    expect(lookup(el)!.label).toBe("Buscar la dirección");
    await choose(el, { ...MADRID, countryCode: "PT" });
    expect(lookup(el)!.message).toBe(
      "Esa dirección no está en España. Elige otra o escríbela abajo.",
    );
  });
});
