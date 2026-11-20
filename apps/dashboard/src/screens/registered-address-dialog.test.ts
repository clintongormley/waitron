import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { WtButton, WtDialog, WtFormActions, WtInput } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi, VenueDetailsModel } from "../api/client.js";
import "./venue-details-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];

const OLD = "Calle Fiscal 8, 28013 Madrid";
const NEW = "Carrer de Mallorca 1, 08010 Barcelona";

const moved = (taxpayerDomicile: string | null): VenueDetailsModel => ({
  ...venueDetailsFixture(),
  taxpayerDomicile,
});

function stubApi(stored: string | null = OLD) {
  let current = moved(stored);
  return {
    liveData: new LiveData(),
    getVenueDetails: vi.fn(async () => structuredClone(current)),
    getVenueClockPreview: vi.fn(),
    patchVenueDetails: vi.fn(),
    renameTaxpayer: vi.fn(),
    changeTaxpayerDomicile: vi.fn(
      async ({ taxpayerDomicile }: { taxpayerDomicile: string; expected: string }) => {
        current = moved(taxpayerDomicile);
        return { model: moved(taxpayerDomicile) };
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
const input = (panel: Panel) =>
  dialog(panel).querySelector<WtInput>("wt-input[name=taxpayerDomicile]")!;
const save = (panel: Panel) =>
  dialog(panel).querySelector<WtButton>("wt-button[data-test=save-taxpayer-domicile]")!;
const actions = (panel: Panel) => dialog(panel).querySelector<WtFormActions>("wt-form-actions")!;

async function open(panel: Panel): Promise<void> {
  button(panel)!.click();
  await dialogHost(panel).updateComplete;
  await expect.poll(() => dialog(panel)?.open).toBe(true);
}

async function type(panel: Panel, value: string): Promise<void> {
  input(panel).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
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

it("opens prefilled, with the hint and the note, and keeps Save quiet until the address changes and again when changed back", async () => {
  const panel = await mount(stubApi());
  await open(panel);
  const field = input(panel);
  expect(field.value).toBe(OLD);
  expect(field.required).toBe(true);
  expect(field.hint).toBe(t("venue_details.taxpayer_domicile_hint"));
  expect(dialog(panel).textContent).toContain(t("venue_details.taxpayer_domicile_note"));
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
  await type(panel, NEW);
  expect(save(panel).variant).toBe("primary");
  expect(save(panel).disabled).toBe(false);
  await type(panel, OLD);
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
});

it("opens empty when no address was saved, and sends an empty expected address", async () => {
  const api = stubApi(null);
  const panel = await mount(api);
  await open(panel);
  expect(input(panel).value).toBe("");
  await type(panel, NEW);
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

it("an emptied address is marked under the field and at the bottom, and blocks Save until filled", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await type(panel, "  ");
  await press(panel);
  expect(api.changeTaxpayerDomicile).not.toHaveBeenCalled();
  expect(input(panel).error).toBe(t("venue_details.required"));
  expect(actions(panel).error).toBe(t("form.fix_fields"));
  expect(save(panel).disabled).toBe(true);
  await type(panel, NEW);
  expect(input(panel).error).toBe("");
  expect(actions(panel).error).toBe("");
  expect(save(panel).disabled).toBe(false);
});

for (const [reason, key] of [
  ["required", "venue_details.required"],
  ["unchanged", "venue_details.taxpayer_domicile_unchanged"],
  ["shape", "venue_details.invalid"],
] as const) {
  it(`a ${reason} refusal shows under the field with the bottom message, and leaves Save enabled`, async () => {
    for (const locale of ["en-GB", "es-ES"]) {
      setLocale(locale);
      const api = stubApi();
      api.changeTaxpayerDomicile.mockRejectedValue({
        code: "venue.detail_invalid",
        params: { field: "taxpayerDomicile", reason },
      });
      const panel = await mount(api);
      await open(panel);
      await type(panel, NEW);
      await press(panel);
      expect(api.changeTaxpayerDomicile).toHaveBeenCalledWith({
        taxpayerDomicile: NEW,
        expected: OLD,
      });
      expect(input(panel).error).toBe(t(key));
      expect(actions(panel).error).toBe(t("form.fix_fields"));
      expect(save(panel).disabled).toBe(false);
      expect(dialog(panel).open).toBe(true);
      await type(panel, `${NEW} 2`);
      expect(input(panel).error).toBe("");
      expect(actions(panel).error).toBe("");
      cleanupWidgets();
    }
  });
}

it("an address changed in another session is the bottom message, and Save stays enabled", async () => {
  const api = stubApi();
  api.changeTaxpayerDomicile.mockRejectedValue({
    code: "venue.detail_changed",
    params: { field: "taxpayerDomicile" },
  });
  const panel = await mount(api);
  await open(panel);
  await type(panel, NEW);
  await press(panel);
  expect(actions(panel).error).toBe(t("venue_details.taxpayer_domicile_changed"));
  expect(input(panel).error).toBe("");
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
  await type(panel, NEW);
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
  await type(panel, NEW);
  await press(panel);
  dialogHost(panel).dismiss();
  refuse({ code: "venue.detail_changed", params: { field: "taxpayerDomicile" } });
  await expect.poll(() => address.mock.calls.length).toBe(1);
  expect(legal).not.toHaveBeenCalled();
});
