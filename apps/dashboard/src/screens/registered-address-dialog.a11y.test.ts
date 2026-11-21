import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import type {
  AddressLookupProvider,
  WtAddressLookup,
  WtDialog,
  WtFormActions,
  WtInput,
  WtSwitch,
} from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import type { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import "./venue-details-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const refusals = {
  open: undefined,
  refused: {
    code: "venue.detail_invalid",
    params: { field: "taxpayerDomicile", reason: "unchanged" },
  },
  stale: { code: "venue.detail_changed", params: { field: "taxpayerDomicile" } },
  search: undefined,
  foreign: undefined,
  same: undefined,
  sameRefused: {
    code: "venue.detail_invalid",
    params: { field: "taxpayerDomicile", reason: "postal_code" },
  },
  postcode: undefined,
};

/** The fixture venue's own address, joined as the registered address is. */
const VENUE = "Calle Mayor 1, 28001 Madrid, Madrid";

const foreign = {
  lines: ["Rua Augusta 1"],
  locality: "Lisboa",
  postalCode: "1100-048",
  countryCode: "PT",
};
const provider: AddressLookupProvider = {
  suggest: async () => [],
  resolve: async () => foreign,
};

const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    (
      ["open", "refused", "stale", "search", "foreign", "same", "sameRefused", "postcode"] as const
    ).map((state) => ({
      theme,
      locale,
      state,
    })),
  ),
);

it.each(cases)(
  "the registered-address dialog has no accessibility violations: $state, $locale, $theme",
  async ({ theme, locale, state }) => {
    setLocale(locale);
    const api = {
      liveData: new LiveData(),
      getVenueDetails: vi.fn(async () => ({
        ...venueDetailsFixture(),
        ...(state === "same" ? { taxpayerDomicile: VENUE } : {}),
      })),
      getVenueClockPreview: vi.fn(),
      patchVenueDetails: vi.fn(),
      changeTaxpayerDomicile: vi.fn().mockRejectedValue(refusals[state]),
    } as unknown as DashboardApi;
    const { el: panel, host } = await mountWidget<Panel>(
      "dashboard-venue-details-panel",
      { api, addressProvider: state === "search" || state === "foreign" ? provider : undefined },
      theme,
    );
    await expect
      .poll(() => panel.shadowRoot!.querySelector("[data-test=change-taxpayer-domicile]"))
      .toBeTruthy();
    panel.shadowRoot!.querySelector<HTMLElement>("[data-test=change-taxpayer-domicile]")!.click();
    const dialogHost = panel.shadowRoot!.querySelector("dashboard-registered-address-dialog")!;
    await dialogHost.updateComplete;
    const dialog = dialogHost.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    const input = dialog.querySelector<WtInput>("wt-input[name=registeredStreet]")!;
    const actions = dialog.querySelector<WtFormActions>("wt-form-actions")!;
    const same = dialog.querySelector<WtSwitch>("wt-switch[name=registeredSameAsVenue]")!;
    const save = () =>
      dialog.querySelector<HTMLElement>("wt-button[data-test=save-taxpayer-domicile]")!.click();
    if (state === "same") {
      expect(same.checked).toBe(true);
      expect(dialog.querySelector("wt-input[name=registeredStreet]")).toBeNull();
    } else if (state === "sameRefused") {
      same.dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
      );
      await dialogHost.updateComplete;
      save();
      await expect.poll(() => actions.error).not.toBe("");
      await actions.updateComplete;
    } else if (state === "postcode") {
      const postcode = dialog.querySelector<WtInput>("wt-input[name=registeredPostalCode]")!;
      postcode.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "2801" }, bubbles: true, composed: true }),
      );
      await dialogHost.updateComplete;
      save();
      await expect.poll(() => postcode.error).not.toBe("");
      await postcode.updateComplete;
      await actions.updateComplete;
    } else if (state === "foreign") {
      const lookup = dialog.querySelector<WtAddressLookup>("wt-address-lookup")!;
      lookup.dispatchEvent(
        new CustomEvent("wt-address-chosen", {
          detail: { address: foreign },
          bubbles: true,
          composed: true,
        }),
      );
      await expect.poll(() => lookup.message).not.toBe("");
      await lookup.updateComplete;
    } else if (state === "search") {
      const lookup = dialog.querySelector<WtAddressLookup>("wt-address-lookup")!;
      await lookup.updateComplete;
      expect(lookup.hidden).toBe(false);
    } else if (state !== "open") {
      input.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Carrer de Mallorca 1" },
          bubbles: true,
          composed: true,
        }),
      );
      await dialogHost.updateComplete;
      save();
      await expect.poll(() => actions.error).not.toBe("");
      if (state === "refused") await expect.poll(() => input.error).not.toBe("");
      await input.updateComplete;
      await actions.updateComplete;
    }
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    await expectNoA11yViolations(host);
  },
);
