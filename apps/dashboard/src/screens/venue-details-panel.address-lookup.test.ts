import { LiveData } from "@waitron/dashboard-kit";
import type { LitElement } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  AddressLookupProvider,
  AddressLookupResult,
  WtAddressLookup,
  WtButton,
  WtInput,
} from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import type { VenueDetailsModel, VenueDetailWrite } from "../api/venue-api.js";
import "./venue-details-panel.js";

type Panel = LitElement & {
  api: DashboardApi;
  readOnly: boolean;
  addressProvider?: AddressLookupProvider;
};

const MADRID: AddressLookupResult = {
  lines: ["Calle Mayor 2"],
  locality: "Madrid",
  administrativeAreaCode: "28",
  postalCode: "28013",
  countryCode: "ES",
};

const provider: AddressLookupProvider = {
  suggest: async () => [{ id: "s1", label: "Calle Mayor 2", secondaryLabel: "28013 Madrid" }],
  resolve: async () => MADRID,
};

const q = <T extends HTMLElement = HTMLElement>(el: Panel, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const field = (el: Panel, name: string) => q<WtInput>(el, `[name="${name}"]`)!;
const lookup = (el: Panel) => q<WtAddressLookup>(el, "wt-address-lookup");
const flush = async (el: Panel) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};
const click = async (el: Panel, selector: string) => {
  q(el, selector)!.click();
  await flush(el);
};

function apiFor(model: VenueDetailsModel = venueDetailsFixture()) {
  let current = model;
  return {
    liveData: new LiveData(),
    getVenueDetails: vi.fn(async () => structuredClone(current)),
    getVenueClockPreview: vi.fn(),
    patchVenueDetails: vi.fn(async (body: VenueDetailWrite) => {
      current = { ...current, details: { ...current.details, ...body.changes } };
      return { changed: true, model: structuredClone(current) };
    }),
  } as unknown as DashboardApi & {
    patchVenueDetails: ReturnType<typeof vi.fn>;
  };
}

async function editing(
  api: DashboardApi,
  addressProvider: AddressLookupProvider | null = provider,
): Promise<Panel> {
  const { el } = await mountWidget<Panel>("dashboard-venue-details-panel", {
    api,
    addressProvider: addressProvider ?? undefined,
  });
  await flush(el);
  await click(el, "[data-test=edit]");
  return el;
}

async function choose(el: Panel, address: AddressLookupResult): Promise<void> {
  lookup(el)!.dispatchEvent(
    new CustomEvent("wt-address-chosen", { detail: { address }, bubbles: true, composed: true }),
  );
  await flush(el);
}

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("es-ES");
});

it("shows a manual street field without a provider", async () => {
  const el = await editing(apiFor(), null);
  expect(lookup(el)!.provider).toBeUndefined();
  expect(lookup(el)!.getBoundingClientRect().height).toBeGreaterThan(0);
});

it("checks Cloud on each opening and keeps manual entry while a reply is pending", async () => {
  const answers: ((value: { available: boolean }) => void)[] = [];
  const addressLookup = vi.fn(
    () => new Promise<{ available: boolean }>((resolve) => answers.push(resolve)),
  );
  const el = await editing(Object.assign(apiFor(), { addressLookup }), null);
  expect(field(el, "addressLine1").value).toBe("Calle Mayor 1");
  expect(lookup(el)!.provider).toBeUndefined();
  expect(addressLookup.mock.calls).toEqual([[{ kind: "available" }]]);
  await click(el, "[data-test=cancel]");
  await click(el, "[data-test=edit]");
  expect(addressLookup.mock.calls).toEqual([[{ kind: "available" }], [{ kind: "available" }]]);
  answers[0]!({ available: true });
  await flush(el);
  expect(lookup(el)!.provider).toBeUndefined();
  answers[1]!({ available: true });
  await expect.poll(() => lookup(el)!.provider).toBeDefined();
});

it("opens the address fields without asking Cloud at a venue outside Spain", async () => {
  const model = venueDetailsFixture();
  const addressLookup = vi.fn(async () => ({ available: true }));
  const api = apiFor({ ...model, issuer: { ...model.issuer, country: "PT" } });
  const el = await editing(Object.assign(api, { addressLookup }), null);
  expect(field(el, "addressLine1").disabled).toBe(false);
  expect(lookup(el)!.provider).toBeUndefined();
  expect(addressLookup).not.toHaveBeenCalled();
});

it.each(["Alicante", "03"])(
  "accepts a suggestion in the venue's stored province %s",
  async (province) => {
    const el = await editing(
      apiFor({
        ...venueDetailsFixture({ province }),
        provinces: [{ code: "03", name: "Alicante/Alacant" }],
      }),
    );
    await choose(el, {
      ...MADRID,
      lines: ["New Street 2"],
      locality: "Alicante",
      administrativeAreaCode: "03",
      postalCode: "03001",
    });
    expect(field(el, "addressLine1").value).toBe("New Street 2");
    expect(lookup(el)!.message).toBe("");
  },
);

it("offers a suggestion while you type Street and saves a manually edited street on Enter", async () => {
  const api = apiFor();
  const el = await editing(api);
  const street = field(el, "addressLine1") as WtAddressLookup;
  street.delay = 0;
  const input = street.shadowRoot!.querySelector("input")!;
  await userEvent.fill(input, "Calle Mayo");
  const option = () => street.shadowRoot!.querySelector<HTMLElement>('[role="option"]');
  await expect.poll(option).not.toBeNull();
  await userEvent.click(option()!);
  await expect.poll(() => street.value).toBe("Calle Mayor 2");
  await userEvent.fill(input, "Calle Mayor 5");
  await click(el, "[data-test=acknowledge]");
  input.focus();
  await userEvent.keyboard("{Enter}");
  expect(api.patchVenueDetails).toHaveBeenCalledExactlyOnceWith({
    changes: { addressLine1: "Calle Mayor 5", postalCode: "28013" },
    expected: venueDetailsFixture().details,
  });
});

it("fills the street, postcode and city from a chosen address, and Save sends them", async () => {
  const api = apiFor();
  const el = await editing(api);
  await choose(el, MADRID);
  expect(field(el, "addressLine1").value).toBe("Calle Mayor 2");
  expect(field(el, "postalCode").value).toBe("28013");
  expect(field(el, "city").value).toBe("Madrid");
  // A changed postcode asks for the same review a typed one does.
  expect(q(el, "[data-test=warnings]")).not.toBeNull();
  await click(el, "[data-test=acknowledge]");
  await click(el, "[data-test=save]");
  expect(api.patchVenueDetails).toHaveBeenCalledExactlyOnceWith({
    changes: { addressLine1: "Calle Mayor 2", postalCode: "28013" },
    expected: venueDetailsFixture().details,
  });
});

it("keeps the venue's own address line 2 unless the chosen address brings one", async () => {
  const el = await editing(apiFor(venueDetailsFixture({ addressLine2: "Local 3" })));
  await choose(el, MADRID);
  expect(field(el, "addressLine2").value).toBe("Local 3");
  await choose(el, { ...MADRID, lines: ["Calle Mayor 2", "Escalera B", "Local 4"] });
  expect(field(el, "addressLine2").value).toBe("Escalera B, Local 4");
});

it("refuses an address in another country, filling nothing and saying why", async () => {
  const el = await editing(apiFor());
  await choose(el, { ...MADRID, countryCode: "PT" });
  expect(field(el, "addressLine1").value).toBe("Calle Mayor 1");
  expect(lookup(el)!.message).toBe(
    "That address is not in Spain. Choose another or edit the street address.",
  );
  await choose(el, MADRID);
  expect(lookup(el)!.message).toBe("");
});

it("refuses an address in another province, because the province cannot change here", async () => {
  const model = venueDetailsFixture();
  model.provinces = [
    { code: "28", name: "Madrid" },
    { code: "08", name: "Barcelona" },
  ];
  const el = await editing(apiFor(model));
  for (const area of ["08", "Barcelona"]) {
    await choose(el, { ...MADRID, administrativeAreaCode: area, postalCode: "08001" });
    expect(field(el, "postalCode").value).toBe("28001");
    expect(lookup(el)!.message).toBe(
      "That address is in another province, and the province cannot change here. Choose another or edit the street address.",
    );
  }
});

it("matches the chosen address's province ignoring accents, case and spacing", async () => {
  const model = venueDetailsFixture();
  model.provinces = [
    { code: "28", name: "Madrid" },
    { code: "05", name: "Ávila" },
    { code: "38", name: "Santa Cruz de Tenerife" },
  ];
  const el = await editing(apiFor(model));
  for (const area of ["Avila", " ÁVILA ", "santa  cruz de tenerife"]) {
    await choose(el, { ...MADRID, administrativeAreaCode: area, postalCode: "05001" });
    expect(field(el, "postalCode").value, area).toBe("28001");
    expect(lookup(el)!.message, area).not.toBe("");
  }
  await choose(el, { ...MADRID, administrativeAreaCode: " MADRID " });
  expect(field(el, "postalCode").value).toBe("28013");
  expect(lookup(el)!.message).toBe("");
});

it("fills an address whose area the venue's list does not name, leaving the postcode to the server's check", async () => {
  const el = await editing(apiFor());
  await choose(el, { ...MADRID, administrativeAreaCode: undefined });
  expect(field(el, "postalCode").value).toBe("28013");
  await choose(el, { ...MADRID, administrativeAreaCode: "ES-M", postalCode: "28014" });
  expect(field(el, "postalCode").value).toBe("28014");
});

it.each(["postalCode", "city"] as const)(
  "offers no address search while the %s is locked",
  async (locked) => {
    const model = venueDetailsFixture();
    model.policy[locked] = { decision: "refuse", reasons: ["sales"] };
    const el = await editing(apiFor(model));
    expect(lookup(el)!.provider).toBeUndefined();
  },
);

it("clears a field's error once a chosen address fills it", async () => {
  const el = await editing(apiFor());
  field(el, "addressLine1").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );
  await flush(el);
  await click(el, "[data-test=save]");
  expect(field(el, "addressLine1").error).not.toBe("");
  await choose(el, MADRID);
  expect(field(el, "addressLine1").error).toBe("");
});

it("ignores a chosen address while a save is on its way", async () => {
  let fail!: (error: unknown) => void;
  const api = apiFor();
  api.patchVenueDetails.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
  const el = await editing(api);
  field(el, "addressLine1").dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Calle Mía 5" },
      bubbles: true,
      composed: true,
    }),
  );
  await flush(el);
  await click(el, "[data-test=save]");
  expect(lookup(el)!.disabled).toBe(true);
  await choose(el, MADRID);
  fail(new Error("offline"));
  await flush(el);
  expect(field(el, "addressLine1").value).toBe("Calle Mía 5");
  expect(field(el, "postalCode").value).toBe("28001");
});

it("Enter on a suggestion fills the fields without pressing Save", async () => {
  const api = apiFor();
  const el = await editing(api);
  const search = lookup(el)!;
  search.delay = 0;
  const input = search.shadowRoot!.querySelector("input")!;
  input.focus();
  await userEvent.fill(input, "Calle Mayor");
  await vi.waitFor(() =>
    expect(search.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
  );
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(field(el, "addressLine1").value).toBe("Calle Mayor 2"));
  expect(api.patchVenueDetails).not.toHaveBeenCalled();
  expect(q<WtButton>(el, "[data-test=save]")).not.toBeNull();
});

it("speaks Spanish", async () => {
  setLocale("es-ES");
  const model = venueDetailsFixture();
  model.provinces = [
    { code: "28", name: "Madrid" },
    { code: "08", name: "Barcelona" },
  ];
  const el = await editing(apiFor(model));
  expect(lookup(el)!.label).toBe(t("venue_details.addressLine1"));
  await choose(el, { ...MADRID, countryCode: "PT" });
  expect(lookup(el)!.message).toBe("Esa dirección no está en España. Elige otra o edita la calle.");
  await choose(el, { ...MADRID, administrativeAreaCode: "08" });
  expect(lookup(el)!.message).toBe(
    "Esa dirección está en otra provincia, y la provincia no se puede cambiar aquí. Elige otra o edita la calle.",
  );
});

it("names the street field addressLine1", async () => {
  const el = await editing(apiFor());
  expect(lookup(el)!.shadowRoot!.querySelector("input")!.getAttribute("name")).toBe("addressLine1");
});

function deferredProvider() {
  const answers: ((address: AddressLookupResult) => void)[] = [];
  const resolving: AddressLookupProvider = {
    ...provider,
    resolve: () => new Promise((resolve) => answers.push(resolve)),
  };
  return { resolving, answers };
}

async function search(el: Panel, text: string): Promise<WtAddressLookup> {
  const found = lookup(el)!;
  found.delay = 0;
  const input = found.shadowRoot!.querySelector("input")!;
  await userEvent.fill(input, text);
  await flush(el);
  return found;
}

async function startChoosing(el: Panel): Promise<void> {
  const found = await search(el, "Calle Mayor");
  await vi.waitFor(() =>
    expect(found.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
  );
  await userEvent.click(found.shadowRoot!.querySelector('[role="option"]')!);
}

async function typeInto(el: Panel, name: string, value: string): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await flush(el);
}

it("drops a chosen address still on its way once the person edits an address field", async () => {
  for (const edited of ["addressLine1", "addressLine2", "postalCode", "city"]) {
    const { resolving, answers } = deferredProvider();
    const el = await editing(apiFor(), resolving);
    await startChoosing(el);
    await typeInto(el, edited, "Typed by hand");
    answers[0]!(MADRID);
    await flush(el);
    expect(field(el, edited).value, edited).toBe("Typed by hand");
    expect(field(el, "addressLine1").value, edited).toBe(
      edited === "addressLine1" ? "Typed by hand" : "Calle Mayor",
    );
    cleanupWidgets();
  }
});

it("still fills from a chosen address when only the venue name was edited meanwhile", async () => {
  const { resolving, answers } = deferredProvider();
  const el = await editing(apiFor(), resolving);
  await startChoosing(el);
  await typeInto(el, "venueName", "New House");
  answers[0]!(MADRID);
  await vi.waitFor(() => expect(field(el, "addressLine1").value).toBe("Calle Mayor 2"));
});

it("drops a chosen address still on its way after Cancel, so a reopened edit starts clean", async () => {
  const { resolving, answers } = deferredProvider();
  const el = await editing(apiFor(), resolving);
  await startChoosing(el);
  await click(el, "[data-test=cancel]");
  await click(el, "[data-test=edit]");
  answers[0]!(MADRID);
  await flush(el);
  expect(field(el, "addressLine1").value).toBe("Calle Mayor 1");
});

it("drops a chosen address still on its way when a save begins, even if the save then fails", async () => {
  const { resolving, answers } = deferredProvider();
  let fail!: (error: unknown) => void;
  const api = apiFor();
  api.patchVenueDetails.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
  const el = await editing(api, resolving);
  await startChoosing(el);
  await typeInto(el, "venueName", "New House");
  await click(el, "[data-test=acknowledge]");
  await click(el, "[data-test=save]");
  expect(lookup(el)!.disabled).toBe(true);
  fail(new Error("offline"));
  await flush(el);
  expect(lookup(el)!.disabled).toBe(false);
  answers[0]!(MADRID);
  await flush(el);
  expect(field(el, "addressLine1").value).toBe("Calle Mayor");
});

it("typing a new street clears an earlier suggestion refusal", async () => {
  const el = await editing(apiFor(), { ...provider, suggest: async () => [] });
  await choose(el, { ...MADRID, countryCode: "PT" });
  const status = () =>
    lookup(el)!.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim() ?? "";
  expect(status()).toBe("That address is not in Spain. Choose another or edit the street address.");
  await search(el, "Nowhere street");
  await vi.waitFor(() => expect(status()).toBe(""));
});

it("credits the filled venue address until the person changes an address field", async () => {
  const el = await editing(apiFor());
  await choose(el, { ...MADRID, attribution: "Google Maps" });
  const credit = () => lookup(el)!.shadowRoot!.querySelector('[part="attribution"]')?.textContent;
  expect(credit()).toBe("Google Maps");
  await typeInto(el, "venueName", "New House");
  expect(credit()).toBe("Google Maps");
  await typeInto(el, "addressLine1", "My street");
  expect(credit()).toBeUndefined();
});
