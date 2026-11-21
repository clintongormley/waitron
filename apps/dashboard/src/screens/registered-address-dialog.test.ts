import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  AddressLookupProvider,
  AddressLookupResult,
  WtAddressLookup,
  WtButton,
  WtCombobox,
  WtDialog,
  WtFormActions,
  WtInput,
  WtSwitch,
} from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi, VenueDetailValues, VenueDetailsModel } from "../api/client.js";
import "./venue-details-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];

const OLD = "Calle Fiscal 8, 28013 Madrid";
/** The line the parts of NEW_PARTS join into; the postcode fills the province. */
const NEW = "Carrer de Mallorca 1, 08010 Barcelona, Barcelona";
const NEW_PARTS = {
  registeredStreet: "Carrer de Mallorca 1",
  registeredPostalCode: "08010",
  registeredCity: "Barcelona",
} as const;

type Part =
  | "registeredStreet"
  | "registeredLine2"
  | "registeredPostalCode"
  | "registeredCity"
  | "registeredProvince";
const PARTS: readonly Part[] = [
  "registeredStreet",
  "registeredLine2",
  "registeredPostalCode",
  "registeredCity",
  "registeredProvince",
];

/** The fixture venue's own address, joined as the registered address is. */
const VENUE = "Calle Mayor 1, 28001 Madrid, Madrid";

interface Venue {
  details?: Partial<VenueDetailValues>;
  country?: string;
}

const moved = (taxpayerDomicile: string | null, venue: Venue = {}): VenueDetailsModel => {
  const base = venueDetailsFixture(venue.details);
  return {
    ...base,
    issuer: { ...base.issuer, country: venue.country ?? base.issuer.country },
    taxpayerDomicile,
  };
};

function stubApi(stored: string | null = OLD, venue: Venue = {}) {
  let current = moved(stored, venue);
  return {
    liveData: new LiveData(),
    getVenueDetails: vi.fn(async () => structuredClone(current)),
    getVenueClockPreview: vi.fn(),
    patchVenueDetails: vi.fn(),
    renameTaxpayer: vi.fn(),
    changeTaxpayerDomicile: vi.fn(
      async ({ taxpayerDomicile }: { taxpayerDomicile: string; expected: string }) => {
        current = moved(taxpayerDomicile, venue);
        return { model: moved(taxpayerDomicile, venue) };
      },
    ),
  };
}
type Api = ReturnType<typeof stubApi>;

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(api: Api, readOnly = false): Promise<Panel> {
  const { el } = await mountWidget<Panel>("dashboard-venue-details-panel", {
    api: api as unknown as DashboardApi,
    readOnly,
  });
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=issuer]")).toBeTruthy();
  return el;
}

const button = (panel: Panel) =>
  panel.shadowRoot!.querySelector<WtButton>("[data-test=change-taxpayer-domicile]");
const dialogHost = (panel: Panel) =>
  panel.shadowRoot!.querySelector("dashboard-registered-address-dialog")!;
const dialog = (panel: Panel) =>
  dialogHost(panel).shadowRoot!.querySelector<WtDialog>(
    "wt-dialog[data-test=taxpayer-domicile-dialog]",
  )!;
const part = (panel: Panel, name: Part) =>
  dialog(panel).querySelector<WtInput | WtCombobox>(`:is(wt-input,wt-combobox)[name=${name}]`)!;
const values = (panel: Panel) => PARTS.map((name) => part(panel, name).value);
const errors = (panel: Panel) => PARTS.map((name) => part(panel, name).error);
const save = (panel: Panel) =>
  dialog(panel).querySelector<WtButton>("wt-button[data-test=save-taxpayer-domicile]")!;
const same = (panel: Panel) =>
  dialog(panel).querySelector<WtSwitch>("wt-switch[name=registeredSameAsVenue]")!;
const shownParts = (panel: Panel) =>
  dialog(panel).querySelectorAll(PARTS.map((name) => `[name=${name}]`).join(",")).length;
const actions = (panel: Panel) => dialog(panel).querySelector<WtFormActions>("wt-form-actions")!;

async function open(panel: Panel): Promise<void> {
  button(panel)!.click();
  await dialogHost(panel).updateComplete;
  await expect.poll(() => dialog(panel)?.open).toBe(true);
}

async function type(panel: Panel, parts: Partial<Record<Part, string>>): Promise<void> {
  for (const [name, value] of Object.entries(parts)) {
    part(panel, name as Part).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await dialogHost(panel).updateComplete;
  }
}

async function turn(panel: Panel, checked: boolean): Promise<void> {
  same(panel).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await dialogHost(panel).updateComplete;
}

async function press(panel: Panel): Promise<void> {
  save(panel).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dialogHost(panel).updateComplete;
}

it("shows the saved registered address in the Business card, or Not set when none was saved", async () => {
  setLocale("en-GB");
  const saved = await mount(stubApi());
  expect(
    saved.shadowRoot!.querySelector("[data-test=saved-taxpayerDomicile]")!.textContent!.trim(),
  ).toBe(OLD);
  const none = await mount(stubApi(null));
  expect(
    none.shadowRoot!.querySelector("[data-test=saved-taxpayerDomicile]")!.textContent!.trim(),
  ).toBe(t("venue_details.unset"));
});

it("offers Change registered address in the Business card's header only when the panel can be edited", async () => {
  setLocale("en-GB");
  const editable = await mount(stubApi());
  const shown = button(editable)!;
  expect(shown.textContent!.trim()).toBe("Change registered address");
  expect(shown.closest("header")?.parentElement?.matches("[data-test=issuer]")).toBe(true);
  expect(shown.variant).toBe(
    editable.shadowRoot!.querySelector<WtButton>("[data-test=change-legal-name]")!.variant,
  );
  const readOnly = await mount(stubApi(), true);
  expect(button(readOnly)).toBeNull();
});

it("opens prefilled in parts, with the province from the postcode and the note, and keeps Save quiet until the address changes and again when changed back", async () => {
  const panel = await mount(stubApi());
  await open(panel);
  expect(same(panel).checked).toBe(false);
  expect(values(panel)).toEqual(["Calle Fiscal 8", "", "28013", "Madrid", "Madrid"]);
  expect(PARTS.map((name) => part(panel, name).required)).toEqual([true, false, true, true, false]);
  expect(PARTS.map((name) => part(panel, name).label)).toEqual(
    (
      [
        "venue_details.addressLine1",
        "venue_details.addressLine2",
        "venue_details.postalCode",
        "venue_details.city",
        "venue_details.registered_province",
      ] as const
    ).map((key) => t(key)),
  );
  expect(dialog(panel).textContent).toContain(t("venue_details.taxpayer_domicile_note"));
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
  await type(panel, NEW_PARTS);
  expect(save(panel).variant).toBe("primary");
  expect(save(panel).disabled).toBe(false);
  await type(panel, {
    registeredStreet: "Calle Fiscal 8",
    registeredPostalCode: "28013",
    registeredCity: "Madrid",
  });
  expect(values(panel)).toEqual(["Calle Fiscal 8", "", "28013", "Madrid", "Madrid"]);
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
});

it("a postcode typed fills the province it lies in", async () => {
  const panel = await mount(stubApi());
  await open(panel);
  await type(panel, { registeredPostalCode: "08010" });
  expect(part(panel, "registeredProvince").value).toBe("Barcelona");
  await type(panel, { registeredPostalCode: "0801" });
  expect(part(panel, "registeredProvince").value).toBe("Barcelona");
});

it("opens with Same as the venue's address on, and the parts hidden, when the saved line is the venue's address", async () => {
  for (const stored of [VENUE, "  Calle Mayor 1, 28001 Madrid  "]) {
    const api = stubApi(stored);
    const panel = await mount(api);
    await open(panel);
    expect(same(panel).checked).toBe(true);
    expect(shownParts(panel)).toBe(0);
    expect(save(panel).disabled).toBe(true);
    await press(panel);
    expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
    await turn(panel, false);
    expect(values(panel)).toEqual(["Calle Mayor 1", "", "28001", "Madrid", "Madrid"]);
    expect(save(panel).disabled).toBe(true);
    cleanupWidgets();
  }
});

it("opens with the switch off when the saved line is another address, or none", async () => {
  for (const stored of [OLD, null, "Calle Mayor 1, 28002 Madrid, Madrid"]) {
    const panel = await mount(stubApi(stored));
    await open(panel);
    expect(same(panel).checked).toBe(false);
    expect(shownParts(panel)).toBe(PARTS.length);
    cleanupWidgets();
  }
});

it("turning the switch on hides the parts and sends the venue's address, joined with the province's own name", async () => {
  const api = stubApi(OLD, { details: { addressLine2: "Piso 2", province: "madrid" } });
  const panel = await mount(api);
  await open(panel);
  await turn(panel, true);
  expect(shownParts(panel)).toBe(0);
  expect(save(panel).variant).toBe("primary");
  await press(panel);
  expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
    taxpayerDomicile: "Calle Mayor 1, Piso 2, 28001 Madrid, Madrid",
    expected: OLD,
  });
});

it("says, at the bottom, that the venue's address could not be used when it would not read back, and sends nothing", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi(OLD, { details: { city: "Madrid, Centro" } });
    const panel = await mount(api);
    await open(panel);
    await turn(panel, true);
    await press(panel);
    expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
    expect(actions(panel).error).toBe(t("venue_details.registered_same_unusable"));
    expect(save(panel).disabled).toBe(true);
    await expect
      .poll(() => dialog(panel).querySelector(":focus")?.getAttribute("name"))
      .toBe("registeredSameAsVenue");
    await turn(panel, false);
    expect(actions(panel).error).toBe("");
    expect(errors(panel)).toEqual(["", "", "", "", ""]);
    cleanupWidgets();
  }
});

it("says the venue's address could not be used when it has no postcode", async () => {
  const api = stubApi(OLD, { details: { postalCode: null } });
  const panel = await mount(api);
  await open(panel);
  await turn(panel, true);
  await press(panel);
  expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
  expect(actions(panel).error).toBe(t("venue_details.registered_same_unusable"));
});

it("a refusal of the venue's address is the bottom message, and turning the switch off drops it", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi(OLD);
    api.changeTaxpayerDomicile.mockRejectedValue({
      code: "venue.detail_invalid",
      params: { field: "taxpayerDomicile", reason: "postcode" },
    });
    const panel = await mount(api);
    await open(panel);
    await turn(panel, true);
    await press(panel);
    expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
      taxpayerDomicile: VENUE,
      expected: OLD,
    });
    expect(actions(panel).error).toBe(t("venue_details.registered_same_unusable"));
    expect(save(panel).disabled).toBe(false);
    await turn(panel, false);
    expect(actions(panel).error).toBe("");
    expect(errors(panel)).toEqual(["", "", "", "", ""]);
    await turn(panel, true);
    expect(actions(panel).error).toBe("");
    cleanupWidgets();
  }
});

it("an unchanged refusal with the switch on says, at the bottom, that this is already the registered address", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi(OLD);
    api.changeTaxpayerDomicile.mockRejectedValue({
      code: "venue.detail_invalid",
      params: { field: "taxpayerDomicile", reason: "unchanged" },
    });
    const panel = await mount(api);
    await open(panel);
    await turn(panel, true);
    await press(panel);
    expect(actions(panel).error).toBe(t("venue_details.taxpayer_domicile_unchanged"));
    expect(shownParts(panel)).toBe(0);
    cleanupWidgets();
  }
});

it("the switch's note says it copies the venue's address when saved, read with the switch too", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const panel = await mount(stubApi());
    await open(panel);
    expect(same(panel).label).toBe(t("venue_details.registered_same"));
    expect(same(panel).description).toBe(t("venue_details.registered_same_hint"));
    expect(
      dialog(panel).querySelector("[data-test=registered-same-hint]")!.textContent!.trim(),
    ).toBe(t("venue_details.registered_same_hint"));
    cleanupWidgets();
  }
});

it("in a country whose pack has no postcode rule, the postcode is still required and a city with a comma is sent", async () => {
  const api = stubApi("10 High Street, London", {
    country: "GB",
    details: { postalCode: "SW1A 1AA", city: "London", province: null },
  });
  const panel = await mount(api);
  await open(panel);
  expect(same(panel).checked).toBe(false);
  expect(values(panel)).toEqual(["10 High Street, London", "", "", "", ""]);
  expect(part(panel, "registeredProvince").localName).toBe("wt-input");
  await type(panel, { registeredStreet: "10 High Street", registeredCity: "London, Westminster" });
  await press(panel);
  expect(errors(panel)).toEqual(["", "", t("venue_details.required"), "", ""]);
  await type(panel, { registeredPostalCode: "SW1A 1AA" });
  await press(panel);
  expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
    taxpayerDomicile: "10 High Street, SW1A 1AA London, Westminster",
    expected: "10 High Street, London",
  });
});

it("in a country with no pack, the line opens in Street and the required parts are still asked for", async () => {
  const api = stubApi("1 Rue de Rivoli, 75001 Paris", { country: "FR" });
  const panel = await mount(api);
  await open(panel);
  expect(values(panel)).toEqual(["1 Rue de Rivoli, 75001 Paris", "", "", "", ""]);
  expect(part(panel, "registeredProvince").localName).toBe("wt-input");
  await type(panel, { registeredLine2: "Bâtiment A" });
  await press(panel);
  const required = t("venue_details.required");
  expect(errors(panel)).toEqual(["", "", required, required, ""]);
  await type(panel, {
    registeredStreet: "1 Rue de Rivoli",
    registeredPostalCode: "75001",
    registeredCity: "Paris",
  });
  await press(panel);
  expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
    taxpayerDomicile: "1 Rue de Rivoli, Bâtiment A, 75001 Paris",
    expected: "1 Rue de Rivoli, 75001 Paris",
  });
});

it("opens empty when no address was saved, and sends an empty expected address", async () => {
  const api = stubApi(null);
  const panel = await mount(api);
  await open(panel);
  expect(values(panel)).toEqual(["", "", "", "", ""]);
  await type(panel, NEW_PARTS);
  await press(panel);
  expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
    taxpayerDomicile: NEW,
    expected: "",
  });
});

it("does not send an unchanged address even when Save is clicked", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await press(panel);
  expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
  expect(dialog(panel).open).toBe(true);
});

it("emptied required parts are marked under each and at the bottom, and block Save until filled", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await type(panel, { registeredStreet: "  ", registeredPostalCode: "", registeredCity: " " });
  await press(panel);
  expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
  const required = t("venue_details.required");
  expect(errors(panel)).toEqual([required, "", required, required, ""]);
  expect(actions(panel).error).toBe(t("form.fix_fields"));
  expect(save(panel).disabled).toBe(true);
  await expect
    .poll(() => dialog(panel).querySelector(":focus")?.getAttribute("name"))
    .toBe("registeredStreet");
  await type(panel, NEW_PARTS);
  expect(errors(panel)).toEqual(["", "", "", "", ""]);
  expect(actions(panel).error).toBe("");
  expect(save(panel).disabled).toBe(false);
});

it("a postcode the country does not have, or a province the postcode is not in, is marked and not sent", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi();
    const panel = await mount(api);
    await open(panel);
    await type(panel, { registeredPostalCode: "2801" });
    await press(panel);
    expect(errors(panel)).toEqual(["", "", t("venue_details.registered_postal_code"), "", ""]);
    await type(panel, { registeredPostalCode: "28013", registeredProvince: "Barcelona" });
    await press(panel);
    expect(errors(panel)).toEqual([
      "",
      "",
      "",
      "",
      t("venue_details.registered_province_mismatch"),
    ]);
    expect(actions(panel).error).toBe(t("form.fix_fields"));
    expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
    cleanupWidgets();
  }
});

it("a city with a comma, which the server would read back otherwise, marks City once the other parts pass", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi();
    const panel = await mount(api);
    await open(panel);
    await type(panel, { registeredCity: "Madrid, Centro", registeredPostalCode: "2801" });
    await press(panel);
    expect(errors(panel)).toEqual(["", "", t("venue_details.registered_postal_code"), "", ""]);
    await type(panel, { registeredPostalCode: "28013" });
    await press(panel);
    expect(errors(panel)).toEqual(["", "", "", t("venue_details.registered_city_comma"), ""]);
    expect(actions(panel).error).toBe(t("form.fix_fields"));
    expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
    cleanupWidgets();
  }
});

it("a saved line without a postcode, like the box's 2º 1ª, opens in Street with the rest empty, and Save marks postcode and city", async () => {
  const api = stubApi("2º 1ª");
  const panel = await mount(api);
  await open(panel);
  expect(values(panel)).toEqual(["2º 1ª", "", "", "", ""]);
  expect(errors(panel)).toEqual(["", "", "", "", ""]);
  expect(save(panel).disabled).toBe(true);
  await type(panel, { registeredLine2: "Puerta 3" });
  await press(panel);
  const required = t("venue_details.required");
  expect(errors(panel)).toEqual(["", "", required, required, ""]);
  expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
});

for (const [reason, key] of [
  ["required", "venue_details.required"],
  ["unchanged", "venue_details.taxpayer_domicile_unchanged"],
  ["shape", "venue_details.invalid"],
  ["incomplete", "venue_details.taxpayer_domicile_incomplete"],
] as const) {
  it(`a ${reason} refusal shows under Street with the bottom message, and leaves Save enabled`, async () => {
    for (const locale of ["en-GB", "es-ES"]) {
      setLocale(locale);
      const api = stubApi();
      api.changeTaxpayerDomicile.mockRejectedValue({
        code: "venue.detail_invalid",
        params: { field: "taxpayerDomicile", reason },
      });
      const panel = await mount(api);
      await open(panel);
      await type(panel, NEW_PARTS);
      await press(panel);
      expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
        taxpayerDomicile: NEW,
        expected: OLD,
      });
      expect(errors(panel)).toEqual([t(key), "", "", "", ""]);
      expect(actions(panel).error).toBe(t("form.fix_fields"));
      expect(save(panel).disabled).toBe(false);
      expect(dialog(panel).open).toBe(true);
      await type(panel, { registeredStreet: "Carrer de Mallorca 2" });
      expect(errors(panel)).toEqual(["", "", "", "", ""]);
      expect(actions(panel).error).toBe("");
      cleanupWidgets();
    }
  });
}

it("a postal_code refusal shows under Postal code with the bottom message, and leaves Save enabled", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi();
    api.changeTaxpayerDomicile.mockRejectedValue({
      code: "venue.detail_invalid",
      params: { field: "taxpayerDomicile", reason: "postcode" },
    });
    const panel = await mount(api);
    await open(panel);
    await type(panel, NEW_PARTS);
    await press(panel);
    expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
      taxpayerDomicile: NEW,
      expected: OLD,
    });
    expect(errors(panel)).toEqual(["", "", t("venue_details.taxpayer_domicile_postcode"), "", ""]);
    expect(actions(panel).error).toBe(t("form.fix_fields"));
    expect(save(panel).disabled).toBe(false);
    await type(panel, { registeredPostalCode: "08011" });
    expect(errors(panel)).toEqual(["", "", "", "", ""]);
    expect(actions(panel).error).toBe("");
    cleanupWidgets();
  }
});

it("an address changed in another session is the bottom message, and Save stays enabled", async () => {
  const api = stubApi();
  api.changeTaxpayerDomicile.mockRejectedValue({
    code: "venue.detail_changed",
    params: { field: "taxpayerDomicile" },
  });
  const panel = await mount(api);
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  expect(actions(panel).error).toBe(t("venue_details.taxpayer_domicile_changed"));
  expect(errors(panel)).toEqual(["", "", "", "", ""]);
  expect(save(panel).disabled).toBe(false);
  expect(dialog(panel).open).toBe(true);
});

it("a successful change closes the dialog, shows the new address and tells the page the identity changed", async () => {
  const api = stubApi();
  const panel = await mount(api);
  const told: Event[] = [];
  const listen = (event: Event) => told.push(event);
  document.body.addEventListener("venue-identity-changed", listen);
  onTestFinished(() => document.body.removeEventListener("venue-identity-changed", listen));
  await open(panel);
  await type(panel, NEW_PARTS);
  const closed = dialogClosed(dialog(panel));
  await press(panel);
  await closed;
  expect(dialog(panel).open).toBe(false);
  expect(api.renameTaxpayer).not.toHaveBeenCalled();
  await panel.updateComplete;
  expect(
    panel.shadowRoot!.querySelector("[data-test=saved-taxpayerDomicile]")!.textContent!.trim(),
  ).toBe(NEW);
  expect(told).toHaveLength(1);
  expect(told[0]!.bubbles && told[0]!.composed).toBe(true);
});

it("a refusal that arrives after the dialog was dismissed is reported through the panel's own reporter", async () => {
  const api = stubApi();
  let refuse!: (error: unknown) => void;
  api.changeTaxpayerDomicile.mockImplementation(
    () => new Promise((_resolve, reject) => (refuse = reject)),
  );
  const panel = await mount(api);
  const legal = vi.fn();
  const address = vi.fn();
  panel.lateRefusalFor = (key) =>
    key === "venue_details.taxpayer_domicile_not_saved" ? address : legal;
  await panel.updateComplete;
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  dialogHost(panel).dismiss();
  refuse({ code: "venue.detail_changed", params: { field: "taxpayerDomicile" } });
  await expect.poll(() => address.mock.calls.length).toBe(1);
  expect(legal).not.toHaveBeenCalled();
});

it("a saved address with surrounding spaces or another Unicode spelling keeps Save quiet, and a change still names the stored spelling", async () => {
  const stored = "  Pla\u00e7a Major 1, 08002 Barcelona  ";
  const api = stubApi(stored);
  const panel = await mount(api);
  await open(panel);
  expect(values(panel)).toEqual(["Pla\u00e7a Major 1", "", "08002", "Barcelona", "Barcelona"]);
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
  await type(panel, { registeredStreet: "Plac\u0327a Major 1" });
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
  await type(panel, NEW_PARTS);
  expect(save(panel).variant).toBe("primary");
  await press(panel);
  expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
    taxpayerDomicile: NEW,
    expected: stored,
  });
});

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { promise, resolve };
}

it("an address answer that arrives after a later legal-name answer keeps the new legal name, even when the follow-up reads fail", async () => {
  const api = stubApi();
  const panel = await mount(api);
  const addressAnswer = held<{ model: VenueDetailsModel }>();
  const nameAnswer = held<{ model: VenueDetailsModel }>();
  api.changeTaxpayerDomicile.mockImplementationOnce(() => addressAnswer.promise);
  api.renameTaxpayer.mockImplementationOnce(() => nameAnswer.promise);
  api.getVenueDetails.mockRejectedValue({ code: "connection.failed" });

  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  dialogHost(panel).dismiss();

  const legalHost = panel.shadowRoot!.querySelector("dashboard-legal-name-dialog")!;
  panel.shadowRoot!.querySelector<WtButton>("[data-test=change-legal-name]")!.click();
  await legalHost.updateComplete;
  const legalDialog = legalHost.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => legalDialog.open).toBe(true);
  legalDialog
    .querySelector<WtInput>("wt-input[name=legalName]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "New SL" }, bubbles: true, composed: true }),
    );
  await legalHost.updateComplete;
  legalDialog.querySelector<WtButton>("wt-button[data-test=save-legal-name]")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const base = venueDetailsFixture();
  nameAnswer.resolve({ model: { ...moved(OLD), issuer: { ...base.issuer, legalName: "New SL" } } });
  const shown = (name: string) =>
    panel.shadowRoot!.querySelector(`[data-test=saved-${name}]`)!.textContent!.trim();
  await expect.poll(() => shown("legalName")).toBe("New SL");
  addressAnswer.resolve({ model: moved(NEW) });
  await expect.poll(() => shown("taxpayerDomicile")).toBe(NEW);
  await panel.updateComplete;
  expect(shown("legalName")).toBe("New SL");

  panel.shadowRoot!.querySelector<WtButton>("[data-test=change-legal-name]")!.click();
  await legalHost.updateComplete;
  await expect.poll(() => legalDialog.open).toBe(true);
  expect(legalDialog.querySelector<WtInput>("wt-input[name=legalName]")!.value).toBe("New SL");
});

it("after an address changed in another session, the typed address stays, and reopening shows the stored one", async () => {
  const STORED = "Calle del Sol 2, 28013 Madrid";
  const api = stubApi();
  api.changeTaxpayerDomicile.mockRejectedValue({
    code: "venue.detail_changed",
    params: { field: "taxpayerDomicile" },
  });
  const panel = await mount(api);
  api.getVenueDetails.mockResolvedValue(moved(STORED));
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  expect(actions(panel).error).toBe(t("venue_details.taxpayer_domicile_changed"));
  expect(values(panel)).toEqual(["Carrer de Mallorca 1", "", "08010", "Barcelona", "Barcelona"]);
  await expect
    .poll(() =>
      panel.shadowRoot!.querySelector("[data-test=saved-taxpayerDomicile]")!.textContent!.trim(),
    )
    .toBe(STORED);
  await dialogHost(panel).updateComplete;
  expect(values(panel)).toEqual(["Carrer de Mallorca 1", "", "08010", "Barcelona", "Barcelona"]);
  dialogHost(panel).dismiss();
  await dialogHost(panel).updateComplete;
  await open(panel);
  expect(values(panel)).toEqual(["Calle del Sol 2", "", "28013", "Madrid", "Madrid"]);
});

it("a venue-details save sent before an address answer arrived, answering the old address later, keeps the new address", async () => {
  const api = stubApi();
  const panel = await mount(api);
  const formAnswer = held<{ changed: boolean; model: VenueDetailsModel }>();
  api.patchVenueDetails.mockImplementationOnce(() => formAnswer.promise);
  api.getVenueDetails.mockRejectedValue({ code: "connection.failed" });
  panel.shadowRoot!.querySelector<WtButton>("[data-test=edit]")!.click();
  await panel.updateComplete;
  panel.shadowRoot!.querySelector<WtInput>('[name="addressLine2"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Floor 2" },
      bubbles: true,
      composed: true,
    }),
  );
  await panel.updateComplete;
  panel.shadowRoot!.querySelector<WtButton>("[data-test=save]")!.click();
  await expect.poll(() => api.patchVenueDetails.mock.calls.length).toBe(1);
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  const shown = (name: string) =>
    panel.shadowRoot!.querySelector(`[data-test=saved-${name}]`)!.textContent!.trim();
  await expect.poll(() => shown("taxpayerDomicile")).toBe(NEW);
  const before = moved(OLD);
  formAnswer.resolve({
    changed: true,
    model: { ...before, details: { ...before.details, addressLine2: "Floor 2" } },
  });
  await expect
    .poll(() => panel.shadowRoot!.querySelector("[data-test=address]")?.textContent)
    .toContain("Floor 2");
  expect(shown("taxpayerDomicile")).toBe(NEW);
});

it("a business-day answer that arrives after an address answer, carrying the old address, keeps the new address", async () => {
  const api = stubApi();
  const panel = await mount(api);
  api.getVenueDetails.mockRejectedValue({ code: "connection.failed" });
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  const shown = () =>
    panel.shadowRoot!.querySelector("[data-test=saved-taxpayerDomicile]")!.textContent!.trim();
  await expect.poll(shown).toBe(NEW);

  const before = moved(OLD);
  const editor = panel.shadowRoot!.querySelector("dashboard-business-day-start-editor")!;
  editor.dispatchEvent(
    new CustomEvent("saved", {
      detail: { ...before, businessDayClock: { ...before.businessDayClock, revision: 1 } },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => editor.model.revision).toBe(1);
  await panel.updateComplete;
  expect(shown()).toBe(NEW);
});

it("an address changed in another session, refused after the dialog was dismissed, still reads the stored address", async () => {
  const STORED = "Calle del Sol 2, 28013 Madrid";
  const api = stubApi();
  let refuse!: (error: unknown) => void;
  api.changeTaxpayerDomicile.mockImplementationOnce(
    () => new Promise<never>((_resolve, reject) => (refuse = reject)),
  );
  const panel = await mount(api);
  api.getVenueDetails.mockResolvedValue(moved(STORED));
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  dialogHost(panel).dismiss();
  refuse({ code: "venue.detail_changed", params: { field: "taxpayerDomicile" } });
  await expect
    .poll(() =>
      panel.shadowRoot!.querySelector("[data-test=saved-taxpayerDomicile]")!.textContent!.trim(),
    )
    .toBe(STORED);
});

const MADRID: AddressLookupResult = {
  lines: ["Calle Mayor 1", "3º B"],
  locality: "Madrid",
  administrativeAreaCode: "28",
  postalCode: "28013",
  countryCode: "ES",
};

const provider: AddressLookupProvider = {
  suggest: async () => [{ id: "s1", label: "Calle Mayor 1" }],
  resolve: async () => MADRID,
};

async function mountSearching(
  api: Api,
  addressProvider: AddressLookupProvider | null = provider,
): Promise<Panel> {
  const { el } = await mountWidget<Panel>("dashboard-venue-details-panel", {
    api: api as unknown as DashboardApi,
    addressProvider: addressProvider ?? undefined,
  });
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=issuer]")).toBeTruthy();
  return el;
}

const search = (panel: Panel) => dialog(panel).querySelector<WtAddressLookup>("wt-address-lookup");

async function choose(panel: Panel, address: AddressLookupResult): Promise<void> {
  search(panel)!.dispatchEvent(
    new CustomEvent("wt-address-chosen", { detail: { address }, bubbles: true, composed: true }),
  );
  await dialogHost(panel).updateComplete;
}

it("puts the address search above the registered address, in the business's country", async () => {
  const panel = await mountSearching(stubApi());
  await open(panel);
  const lookup = search(panel)!;
  await lookup.updateComplete;
  expect(lookup.hidden).toBe(false);
  expect(lookup.countryCode).toBe("ES");
  expect(lookup.label).toBe("Find the address");
  const order = [
    ...dialog(panel).querySelectorAll("wt-address-lookup, wt-switch, wt-input, wt-combobox"),
  ].map((node) => node.getAttribute("name"));
  expect(order).toEqual(["domicile-search", "registeredSameAsVenue", ...PARTS]);
});

it("fills the parts from a chosen address, its second line into Line 2, and Save sends them joined", async () => {
  const api = stubApi();
  const panel = await mountSearching(api);
  await open(panel);
  expect(save(panel).disabled).toBe(true);
  await choose(panel, MADRID);
  expect(values(panel)).toEqual(["Calle Mayor 1", "3º B", "28013", "Madrid", "Madrid"]);
  expect(save(panel).disabled).toBe(false);
  expect(save(panel).variant).toBe("primary");
  await press(panel);
  expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
    taxpayerDomicile: "Calle Mayor 1, 3º B, 28013 Madrid, Madrid",
    expected: OLD,
  });
});

it("a chosen address turns the switch off, keeps a typed Line 2 when it brings none, and takes the province from its area", async () => {
  const api = stubApi(VENUE);
  const panel = await mountSearching(api);
  await open(panel);
  expect(same(panel).checked).toBe(true);
  await choose(panel, {
    lines: ["Carrer de Mallorca 1"],
    locality: "Barcelona",
    administrativeAreaCode: "08",
    postalCode: "08010",
    countryCode: "ES",
  });
  expect(same(panel).checked).toBe(false);
  expect(values(panel)).toEqual(["Carrer de Mallorca 1", "", "08010", "Barcelona", "Barcelona"]);
  await type(panel, { registeredLine2: "Piso 2" });
  await choose(panel, { ...MADRID, lines: ["Calle Mayor 1"] });
  expect(values(panel)).toEqual(["Calle Mayor 1", "Piso 2", "28013", "Madrid", "Madrid"]);
});

it("a chosen address's blank later lines neither replace a typed Line 2 nor pad one", async () => {
  const panel = await mountSearching(stubApi());
  await open(panel);
  await type(panel, { registeredLine2: "Piso 2" });
  await choose(panel, { ...MADRID, lines: ["Calle Mayor 1", " ", ""] });
  expect(values(panel)).toEqual(["Calle Mayor 1", "Piso 2", "28013", "Madrid", "Madrid"]);
  await choose(panel, { ...MADRID, lines: ["Calle Mayor 1", "", "Puerta 4"] });
  expect(values(panel)[1]).toBe("Puerta 4");
});

it("a refusal is not shown once a chosen address replaces the refused one", async () => {
  const api = stubApi();
  api.changeTaxpayerDomicile.mockRejectedValue({
    code: "venue.detail_invalid",
    params: { field: "taxpayerDomicile", reason: "postcode" },
  });
  const panel = await mountSearching(api);
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  expect(errors(panel)[2]).toBe(t("venue_details.taxpayer_domicile_postcode"));
  await choose(panel, MADRID);
  expect(errors(panel)).toEqual(["", "", "", "", ""]);
  expect(actions(panel).error).toBe("");
});

it("fills nothing from an address in another country, and says why on the search's line", async () => {
  const panel = await mountSearching(stubApi());
  await open(panel);
  await choose(panel, { ...MADRID, countryCode: "PT", postalCode: "1100-148" });
  expect(values(panel)).toEqual(["Calle Fiscal 8", "", "28013", "Madrid", "Madrid"]);
  expect(search(panel)!.message).toBe(
    "That address is not in Spain. Choose another or type it below.",
  );
  await choose(panel, MADRID);
  expect(search(panel)!.message).toBe("");
});

it("stops a search still on its way when the person types the address", async () => {
  const panel = await mountSearching(stubApi());
  await open(panel);
  const cancel = vi.spyOn(search(panel)!, "cancelSearch");
  await type(panel, NEW_PARTS);
  expect(cancel).toHaveBeenCalled();
});

it("keeps the latest switch choice when a chosen address arrives after it", async () => {
  const answers: ((address: AddressLookupResult) => void)[] = [];
  const panel = await mountSearching(stubApi(), {
    ...provider,
    resolve: () => new Promise((resolve) => answers.push(resolve)),
  });
  await open(panel);
  expect(same(panel).checked).toBe(false);
  const lookup = search(panel)!;
  lookup.delay = 0;
  const input = lookup.shadowRoot!.querySelector("input")!;
  input.value = "Calle Mayor";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await vi.waitFor(() =>
    expect(lookup.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(1),
  );
  await userEvent.click(lookup.shadowRoot!.querySelector('[role="option"]')!);
  await turn(panel, true);
  answers[0]!(MADRID);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dialogHost(panel).updateComplete;
  expect(same(panel).checked).toBe(true);
  await turn(panel, false);
  expect(values(panel)).toEqual(["Calle Fiscal 8", "", "28013", "Madrid", "Madrid"]);
});

it("shows no address search without a provider, and none in the legal-name dialog", async () => {
  const panel = await mountSearching(stubApi(), null);
  await open(panel);
  const lookup = search(panel)!;
  await lookup.updateComplete;
  expect(lookup.hidden).toBe(true);
  expect(lookup.getBoundingClientRect().height).toBe(0);
  const withProvider = await mountSearching(stubApi());
  withProvider.shadowRoot!.querySelector<HTMLElement>("[data-test=change-legal-name]")!.click();
  const legal = withProvider.shadowRoot!.querySelector("dashboard-legal-name-dialog")!;
  await legal.updateComplete;
  expect(legal.shadowRoot!.querySelector("wt-input[name=legalName]")).not.toBeNull();
  expect(legal.shadowRoot!.querySelector("wt-address-lookup")).toBeNull();
});

it("an address chosen while a save is on its way does not replace the address being saved", async () => {
  const api = stubApi();
  api.changeTaxpayerDomicile.mockImplementationOnce(() => new Promise<never>(() => {}));
  const panel = await mountSearching(api);
  await open(panel);
  await type(panel, NEW_PARTS);
  await press(panel);
  expect(search(panel)!.disabled).toBe(true);
  await choose(panel, MADRID);
  expect(values(panel)).toEqual(["Carrer de Mallorca 1", "", "08010", "Barcelona", "Barcelona"]);
});
