import { countryNameFor, getCountryPack, type CloudAddressOperation } from "@waitron/country-packs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type {
  AddressLookupProvider,
  AddressLookupResult,
  WtAddressLookup,
} from "@waitron/ui/src/components/wt-address-lookup.js";
import { cleanupWidgets, mountWidget, resetPage } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import "./invoice-recipient-dialog.js";
import type {
  InvoiceRecipientDetail,
  TillInvoiceRecipientDialog,
} from "./invoice-recipient-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const MADRID: AddressLookupResult = {
  lines: ["Calle Mayor 1"],
  locality: "Madrid",
  administrativeAreaCode: "28",
  postalCode: "28013",
  countryCode: "ES",
};

const provider: AddressLookupProvider = {
  suggest: async () => [{ id: "s1", label: "Calle Mayor 1", secondaryLabel: "28013 Madrid" }],
  resolve: async () => MADRID,
};

type Dialog = TillInvoiceRecipientDialog & { addressProvider?: AddressLookupProvider };

async function mountDialog(props: Partial<Dialog> = { addressProvider: provider }) {
  const { el } = await mountWidget<Dialog>("till-invoice-recipient-dialog", props);
  return el;
}

const q = <T extends HTMLElement = HTMLElement>(el: Dialog, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const lookup = (el: Dialog) => q<WtAddressLookup>(el, "wt-address-lookup");
const value = (el: Dialog, name: string) =>
  q<HTMLElement & { value: string }>(el, `[name=${name}]`)!.value;
const save = (el: Dialog) => q<HTMLElement & { disabled: boolean }>(el, "[data-invoice-save]")!;
const flush = async (el: Dialog) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};

async function fill(el: Dialog, name: string, text: string) {
  const input = q(el, `:is(wt-input,wt-address-lookup)[name=${name}]`)!.shadowRoot!.querySelector(
    "input",
  )!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function chooseCountry(el: Dialog, code: string) {
  q(el, "wt-combobox[name=countryCode]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: code }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function choose(el: Dialog, address: AddressLookupResult) {
  lookup(el)!.dispatchEvent(
    new CustomEvent("wt-address-chosen", { detail: { address }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

function confirmed(el: Dialog): InvoiceRecipientDetail[] {
  const saved: InvoiceRecipientDetail[] = [];
  el.addEventListener("invoice-recipient-confirm", (event) =>
    saved.push((event as CustomEvent<InvoiceRecipientDetail>).detail),
  );
  return saved;
}

async function startChoosing(el: Dialog, query = "Calle Mayor") {
  const search = lookup(el)!;
  search.delay = 0;
  const input = search.shadowRoot!.querySelector("input")!;
  await userEvent.fill(input, query);
  await vi.waitFor(() =>
    expect(search.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
  );
  await userEvent.click(search.shadowRoot!.querySelector('[role="option"]')!);
}

function deferredProvider() {
  const answers: ((address: AddressLookupResult) => void)[] = [];
  const resolving: AddressLookupProvider = {
    ...provider,
    resolve: () => new Promise((resolve) => answers.push(resolve)),
  };
  return { resolving, answers };
}

describe("the invoice recipient dialog's address search", () => {
  it("keeps suggestions off if a Spanish availability answer arrives in another country", async () => {
    let answer!: (reply: { available: boolean }) => void;
    const availability = new Promise<{ available: boolean }>((resolve) => {
      answer = resolve;
    });
    const lookupAddress = vi.fn<NonNullable<Dialog["lookupAddress"]>>(() => availability);
    const el = await mountDialog({ lookupAddress });
    await vi.waitFor(() => expect(lookupAddress.mock.calls[0]?.[0]).toEqual({ kind: "available" }));
    await chooseCountry(el, "FR");
    expect(lookupAddress.mock.calls[0]?.[1]?.aborted).toBe(true);
    answer({ available: true });
    await flush(el);
    expect(lookup(el)!.provider).toBeUndefined();
    await fill(el, "address", "2 Rue de Rivoli");
    expect(value(el, "address")).toBe("2 Rue de Rivoli");
  });

  it("frees the box connection when a newer search starts and before Save sends the invoice", async () => {
    const pending: (AbortSignal | null | undefined)[] = [];
    const api = new TillApi("", async (_url, options) => {
      const operation = JSON.parse(options?.body as string) as CloudAddressOperation;
      if (operation.kind === "available") return Response.json({ available: true });
      const signal = options?.signal;
      pending.push(signal);
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const el = await mountDialog({ lookupAddress: api.addressLookup.bind(api) });
    const search = lookup(el)!;
    await vi.waitFor(() => expect(search.provider).toBeDefined());
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await choose(el, MADRID);
    const input = search.shadowRoot!.querySelector("input")!;
    search.delay = 0;
    input.focus();
    for (const [index, query] of ["Calle Mayor", "Calle Mayor 1"].entries()) {
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await vi.waitFor(() => expect(pending).toHaveLength(index + 1));
    }
    expect(pending[0]?.aborted).toBe(true);
    expect(pending[1]?.aborted).toBe(false);
    const abortedWhenSaving: (boolean | undefined)[] = [];
    el.addEventListener("invoice-recipient-confirm", () =>
      abortedWhenSaving.push(pending[1]?.aborted),
    );
    save(el).click();
    await el.updateComplete;
    expect(abortedWhenSaving).toEqual([true]);
  });

  it("frees the suggestion request when staff leave Street address", async () => {
    let pending: AbortSignal | null | undefined;
    const api = new TillApi("", async (_url, options) => {
      const operation = JSON.parse(options?.body as string) as CloudAddressOperation;
      if (operation.kind === "available") return Response.json({ available: true });
      pending = options?.signal;
      return new Promise((_, reject) => {
        pending?.addEventListener("abort", () => reject(pending?.reason), { once: true });
      });
    });
    const el = await mountDialog({ lookupAddress: api.addressLookup.bind(api) });
    const street = lookup(el)!;
    street.delay = 0;
    await vi.waitFor(() => expect(street.provider).toBeDefined());
    await userEvent.fill(street.shadowRoot!.querySelector("input")!, "Calle Mayor");
    await vi.waitFor(() => expect(pending?.aborted).toBe(false));

    await userEvent.keyboard("{Tab}");

    expect(pending?.aborted).toBe(true);
  });

  it("removes the Google Maps credit when the country changes", async () => {
    const el = await mountDialog();
    await choose(el, { ...MADRID, attribution: "Google Maps" });
    const credit = () => lookup(el)!.shadowRoot!.querySelector('[part="attribution"]')?.textContent;
    expect(credit()).toBe("Google Maps");
    await chooseCountry(el, "FR");
    expect(credit()).toBeUndefined();
  });

  it("leaves manual entry available when the box refuses the availability check", async () => {
    const lookupAddress = vi.fn().mockRejectedValue({ code: "cloud.unavailable" });
    const el = await mountDialog({ lookupAddress });
    await vi.waitFor(() =>
      expect(lookupAddress).toHaveBeenCalledWith({ kind: "available" }, expect.any(AbortSignal)),
    );
    await flush(el);
    expect(lookup(el)!.provider).toBeUndefined();
    await fill(el, "address", "Calle Mía 5");
    expect(value(el, "address")).toBe("Calle Mía 5");
  });

  it("shows search when availability returns after manual entry and a refused save", async () => {
    let available!: (reply: { available: boolean }) => void;
    const reply = new Promise<{ available: boolean }>((resolve) => {
      available = resolve;
    });
    const lookupAddress = vi.fn<NonNullable<Dialog["lookupAddress"]>>(() => reply);
    const el = await mountDialog({ lookupAddress });
    const saved = confirmed(el);
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await fill(el, "address", "Calle Mayor 1");
    await fill(el, "postalCode", "28013");
    await fill(el, "locality", "Madrid");
    await fill(el, "province", "Madrid");
    save(el).click();
    expect(saved).toHaveLength(1);
    el.refusal = "Try again";
    available({ available: true });
    await flush(el);
    expect(lookupAddress.mock.calls[0]?.[1]?.aborted).toBe(false);
    expect(lookup(el)!.provider).toBeDefined();
  });

  it("keeps a manual street field without a provider", async () => {
    const el = await mountDialog({});
    expect(lookup(el)!.provider).toBeUndefined();
    expect(lookup(el)!.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it("Escape closes an open list and leaves the dialog open", async () => {
    const el = await mountDialog();
    let cancelled = false;
    el.addEventListener("invoice-recipient-cancel", () => (cancelled = true));
    const search = lookup(el)!;
    search.delay = 0;
    await userEvent.fill(search.shadowRoot!.querySelector("input")!, "Calle Mayor");
    await vi.waitFor(() =>
      expect(search.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
    );
    await userEvent.keyboard("{Escape}");
    await flush(el);
    expect(search.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(cancelled).toBe(false);
    expect(q(el, "wt-dialog")!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  });

  it("uses Street address and asks in the chosen country", async () => {
    const el = await mountDialog();
    const search = lookup(el)!;
    expect(search.provider).toBeDefined();
    expect(search.countryCode).toBe("ES");
    expect(search.name).toBe("address");
    await chooseCountry(el, "FR");
    expect(search.countryCode).toBe("FR");
  });

  it("offers a suggestion from Street address and saves a hand-edited street on Enter", async () => {
    const el = await mountDialog();
    const saved = confirmed(el);
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    const street = q<WtAddressLookup>(el, '[name="address"]')!;
    street.delay = 0;
    const input = street.shadowRoot!.querySelector("input")!;
    await userEvent.fill(input, "Calle Mayo");
    const option = () => street.shadowRoot!.querySelector<HTMLElement>('[role="option"]');
    await expect.poll(option).not.toBeNull();
    await userEvent.click(option()!);
    await expect.poll(() => street.value).toBe("Calle Mayor 1");
    await userEvent.fill(input, "Calle Mayor 8");
    await userEvent.keyboard("{Enter}");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.recipient).toMatchObject({ address: "Calle Mayor 8, 28013 Madrid, Madrid" });
  });

  it("saves a manually entered street on the first click while suggestions are visible", async () => {
    const el = await mountDialog();
    const saved = confirmed(el);
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await fill(el, "postalCode", "28013");
    await fill(el, "locality", "Madrid");
    await fill(el, "province", "Madrid");
    const street = lookup(el)!;
    street.delay = 0;
    await userEvent.fill(street.shadowRoot!.querySelector("input")!, "Calle Mayor 8");
    await expect.poll(() => street.shadowRoot!.querySelector('[role="option"]')).not.toBeNull();

    await userEvent.click(save(el));

    expect(saved).toHaveLength(1);
    expect(saved[0]?.recipient.address).toBe("Calle Mayor 8, 28013 Madrid, Madrid");
  });

  it("keeps Save tappable on a phone while all five suggestions are visible", async () => {
    await page.viewport(390, 844);
    try {
      const el = await mountDialog({
        addressProvider: {
          ...provider,
          suggest: async () =>
            [1, 2, 3, 4, 5].map((number) => ({
              id: String(number),
              label: `Calle Mayor ${number}`,
              secondaryLabel: "28013 Madrid",
            })),
        },
      });
      const saved = confirmed(el);
      await fill(el, "taxId", "12345678Z");
      await fill(el, "legalName", "Ana García");
      await fill(el, "postalCode", "28013");
      await fill(el, "locality", "Madrid");
      await fill(el, "province", "Madrid");
      const street = lookup(el)!;
      street.delay = 0;
      await userEvent.fill(street.shadowRoot!.querySelector("input")!, "Calle Mayor 8");
      await expect
        .poll(() => street.shadowRoot!.querySelectorAll('[role="option"]').length)
        .toBe(5);

      await commands.touchGesture({ at: "[data-invoice-save]" });

      await expect
        .poll(() => saved.map(({ recipient }) => recipient.address))
        .toEqual(["Calle Mayor 8, 28013 Madrid, Madrid"]);
    } finally {
      await commands.parkTouch();
      await resetPage();
    }
  });

  it("fills the street, postcode, locality and province, and Save choice sends them", async () => {
    const el = await mountDialog();
    const saved = confirmed(el);
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await choose(el, MADRID);
    expect(value(el, "address")).toBe("Calle Mayor 1");
    expect(value(el, "postalCode")).toBe("28013");
    expect(value(el, "locality")).toBe("Madrid");
    expect(value(el, "province")).toBe("Madrid");
    save(el).click();
    await el.updateComplete;
    expect(saved[0]?.recipient).toMatchObject({
      address: "Calle Mayor 1, 28013 Madrid, Madrid",
      countryCode: "ES",
    });
  });

  it("takes the province from the area code over the postcode", async () => {
    const el = await mountDialog();
    await choose(el, { ...MADRID, administrativeAreaCode: "08" });
    expect(value(el, "province")).toBe("Barcelona");
  });

  it("takes the province from the postcode when the address has no area code", async () => {
    const el = await mountDialog();
    await choose(el, {
      lines: ["Carrer de Pelai 1"],
      locality: "Barcelona",
      postalCode: "08001",
      countryCode: "ES",
    });
    expect(value(el, "province")).toBe("Barcelona");
  });

  it("joins every line of the address into the one street field", async () => {
    const el = await mountDialog();
    await choose(el, { ...MADRID, lines: ["Calle Mayor 1", "3º B"] });
    expect(value(el, "address")).toBe("Calle Mayor 1, 3º B");
  });

  it.each([
    ["07", "07001", "Palma", "Illes Balears"],
    ["15", "15001", "A Coruña", "A Coruña"],
    ["26", "26001", "Logroño", "La Rioja"],
    ["35", "35001", "Las Palmas de Gran Canaria", "Las Palmas"],
  ])(
    "fills area %s with a name the server's address check accepts",
    async (code, postalCode, locality, province) => {
      const el = await mountDialog();
      const saved = confirmed(el);
      await fill(el, "taxId", "12345678Z");
      await fill(el, "legalName", "Ana García");
      await choose(el, { ...MADRID, administrativeAreaCode: code, postalCode, locality });
      expect(value(el, "province")).toBe(province);
      save(el).click();
      await el.updateComplete;
      expect(getCountryPack("ES")!.postalAddress!.isComplete(saved[0]!.recipient.address)).toBe(
        true,
      );
    },
  );

  it("empties the province when Waitron knows no area for the address", async () => {
    const el = await mountDialog();
    await fill(el, "province", "Madrid");
    await chooseCountry(el, "FR");
    await choose(el, {
      lines: ["2 Rue de Rivoli"],
      locality: "Paris",
      administrativeAreaCode: "IDF",
      postalCode: "75001",
      countryCode: "FR",
    });
    expect(value(el, "address")).toBe("2 Rue de Rivoli");
    expect(value(el, "postalCode")).toBe("75001");
    expect(value(el, "province")).toBe("");
    expect(value(el, "countryCode")).toBe("FR");
  });

  it("fills nothing from an address in another country and says why", async () => {
    const el = await mountDialog();
    await fill(el, "address", "Calle Mía 5");
    await choose(el, { ...MADRID, countryCode: "PT" });
    expect(value(el, "address")).toBe("Calle Mía 5");
    expect(value(el, "postalCode")).toBe("");
    expect(lookup(el)!.message).toBe(
      "That address is not in Spain. Choose another or edit the street address.",
    );
    await chooseCountry(el, "PT");
    expect(lookup(el)!.message).toBe("");
  });

  it("clears the other-country line once a matching address is chosen", async () => {
    const el = await mountDialog();
    await choose(el, { ...MADRID, countryCode: "PT" });
    await choose(el, MADRID);
    expect(lookup(el)!.message).toBe("");
  });

  it("says so in Spanish", async () => {
    setLocale("es-ES");
    const spain = countryNameFor("ES", "es-ES");
    expect(spain).not.toBe(countryNameFor("ES", "en"));
    const el = await mountDialog();
    expect(lookup(el)!.label).toBe(es["invoice.street_address"]);
    await choose(el, { ...MADRID, countryCode: "PT" });
    expect(lookup(el)!.message).toBe(
      es["invoice.address_lookup.other_country"].replace("{country}", spain),
    );
  });

  it("marks the draft changed, so Save choice can be pressed", async () => {
    const el = await mountDialog();
    expect(save(el).disabled).toBe(true);
    await choose(el, MADRID);
    expect(save(el).disabled).toBe(false);
  });

  it("counts as an edit of a refused address", async () => {
    const el = await mountDialog();
    el.refusal = "Check the address";
    el.refusalField = "address";
    await el.updateComplete;
    const edits: string[] = [];
    el.addEventListener("invoice-recipient-edit", (event) =>
      edits.push((event as CustomEvent<{ field: string }>).detail.field),
    );
    await choose(el, MADRID);
    expect(edits).toEqual(["address"]);
  });

  it("does not count as an edit of a refused field it does not fill", async () => {
    const el = await mountDialog();
    el.refusal = "Check the customer name";
    el.refusalField = "legalName";
    await el.updateComplete;
    const edits: string[] = [];
    el.addEventListener("invoice-recipient-edit", (event) =>
      edits.push((event as CustomEvent<{ field: string }>).detail.field),
    );
    await choose(el, MADRID);
    expect(edits).toEqual([]);
  });

  it.each(["address", "postalCode", "locality", "province"])(
    "drops an address still on its way once %s is edited",
    async (field) => {
      const { resolving, answers } = deferredProvider();
      const el = await mountDialog({ addressProvider: resolving });
      await startChoosing(el);
      await vi.waitFor(() => expect(answers).toHaveLength(1));
      await fill(el, field, "Typed");
      answers[0]!(MADRID);
      await flush(el);
      expect(value(el, field)).toBe("Typed");
      expect(value(el, "address")).toBe(field === "address" ? "Typed" : "Calle Mayor");
    },
  );

  it("drops an address still on its way once Save choice sends", async () => {
    const { resolving, answers } = deferredProvider();
    const el = await mountDialog({ addressProvider: resolving });
    const saved = confirmed(el);
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await fill(el, "postalCode", "28001");
    await fill(el, "locality", "Madrid");
    await fill(el, "province", "Madrid");
    await startChoosing(el, "Calle Mía 5");
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    save(el).click();
    await el.updateComplete;
    expect(saved[0]?.recipient.address).toBe("Calle Mía 5, 28001 Madrid, Madrid");
    answers[0]!(MADRID);
    await flush(el);
    expect(value(el, "address")).toBe("Calle Mía 5");
  });

  it("drops an address still on its way once Simplified invoice instead is pressed", async () => {
    const { resolving, answers } = deferredProvider();
    const el = await mountDialog({ addressProvider: resolving, offerSimplified: true });
    let sent = 0;
    el.addEventListener("invoice-recipient-simplified", () => sent++);
    await startChoosing(el);
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    q(el, "[data-invoice-simplified]")!.click();
    expect(sent).toBe(1);
    answers[0]!(MADRID);
    await flush(el);
    expect(value(el, "address")).toBe("Calle Mayor");
  });

  it("ignores a chosen address once the dialog has closed", async () => {
    const el = await mountDialog();
    let cancelled = false;
    el.addEventListener("invoice-recipient-cancel", () => (cancelled = true));
    q(el, "wt-button[slot=cancel]")!.click();
    await vi.waitFor(() => expect(cancelled).toBe(true));
    await choose(el, MADRID);
    expect(value(el, "address")).toBe("");
  });

  it("Enter on a suggestion fills the fields without pressing Save choice", async () => {
    const el = await mountDialog();
    const saved = confirmed(el);
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    const search = lookup(el)!;
    search.delay = 0;
    await userEvent.fill(search.shadowRoot!.querySelector("input")!, "Calle Mayor");
    await vi.waitFor(() =>
      expect(search.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
    );
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(value(el, "address")).toBe("Calle Mayor 1"));
    expect(saved).toEqual([]);
  });

  it("waits for a chosen suggestion before Enter confirms an invoice", async () => {
    const { resolving, answers } = deferredProvider();
    const el = await mountDialog({ addressProvider: resolving });
    const saved = confirmed(el);
    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await fill(el, "postalCode", "08001");
    await fill(el, "locality", "Barcelona");
    await fill(el, "province", "Barcelona");

    const street = lookup(el)!;
    street.delay = 0;
    const input = street.shadowRoot!.querySelector("input")!;
    await userEvent.fill(input, "Calle May");
    await expect.poll(() => street.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect.poll(() => answers).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(saved).toEqual([]);

    answers[0]!(MADRID);
    await expect.poll(() => street.value).toBe("Calle Mayor 1");
    await userEvent.keyboard("{Enter}");
    expect(saved[0]?.recipient.address).toBe("Calle Mayor 1, 28013 Madrid, Madrid");
  });
});
