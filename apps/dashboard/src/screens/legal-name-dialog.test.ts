import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { WtButton, WtDialog, WtFormActions, WtInput } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi, VenueDetailsModel } from "../api/client.js";
import "./venue-details-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];

const renamed = (legalName: string): VenueDetailsModel => {
  const model = venueDetailsFixture();
  return { ...model, issuer: { ...model.issuer, legalName } };
};

function stubApi() {
  return {
    liveData: new LiveData(),
    getVenueDetails: vi.fn(async () => venueDetailsFixture()),
    getVenueClockPreview: vi.fn(),
    patchVenueDetails: vi.fn(),
    renameTaxpayer: vi.fn(async ({ legalName }: { legalName: string; expected: string }) => ({
      model: renamed(legalName),
    })),
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
  panel.shadowRoot!.querySelector<WtButton>("[data-test=change-legal-name]");
const dialogHost = (panel: Panel) =>
  panel.shadowRoot!.querySelector("dashboard-legal-name-dialog")!;
const dialog = (panel: Panel) =>
  dialogHost(panel).shadowRoot!.querySelector<WtDialog>("wt-dialog[data-test=legal-name-dialog]")!;
const input = (panel: Panel) => dialog(panel).querySelector<WtInput>("wt-input[name=legalName]")!;
const save = (panel: Panel) =>
  dialog(panel).querySelector<WtButton>("wt-button[data-test=save-legal-name]")!;
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

it("offers Change legal name beside the identity line only when the panel can be edited", async () => {
  setLocale("en-GB");
  const editable = await mount(stubApi());
  const shown = button(editable)!;
  expect(shown.textContent!.trim()).toBe("Change legal name");
  expect(shown.closest(".identity")?.querySelector("[data-test=issuer]")).toBeTruthy();
  expect(shown.variant).toBe(
    editable.shadowRoot!.querySelector<WtButton>("[data-test=edit]")!.variant,
  );
  const readOnly = await mount(stubApi(), true);
  expect(button(readOnly)).toBeNull();
});

it("opens prefilled, with the note, and keeps Save quiet until the name changes and again when changed back", async () => {
  const panel = await mount(stubApi());
  await open(panel);
  const field = input(panel);
  expect(field.value).toBe("Issuer SL");
  expect(field.required).toBe(true);
  expect(dialog(panel).textContent).toContain(t("venue_details.legal_name_note"));
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
  await type(panel, "Nuevo SL");
  expect(save(panel).variant).toBe("primary");
  expect(save(panel).disabled).toBe(false);
  await type(panel, "Issuer SL");
  expect(save(panel).variant).toBe("secondary");
  expect(save(panel).disabled).toBe(true);
});

it("does not send an unchanged name even when Save is clicked", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await press(panel);
  expect(api.renameTaxpayer).not.toHaveBeenCalled();
  expect(dialog(panel).open).toBe(true);
});

it("an emptied name is marked under the field and at the bottom, and blocks Save until filled", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await type(panel, "  ");
  await press(panel);
  expect(api.renameTaxpayer).not.toHaveBeenCalled();
  expect(input(panel).error).toBe(t("venue_details.required"));
  expect(actions(panel).error).toBe(t("form.fix_fields"));
  expect(save(panel).disabled).toBe(true);
  await type(panel, "Nuevo SL");
  expect(input(panel).error).toBe("");
  expect(actions(panel).error).toBe("");
  expect(save(panel).disabled).toBe(false);
});

for (const [reason, key] of [
  ["required", "venue_details.required"],
  ["unchanged", "venue_details.legal_name_unchanged"],
  ["fiscal_format", "venue_details.legal_name_format"],
  ["shape", "venue_details.invalid"],
] as const) {
  it(`a ${reason} refusal shows under the field with the bottom message, and leaves Save enabled`, async () => {
    for (const locale of ["en-GB", "es-ES"]) {
      setLocale(locale);
      const api = stubApi();
      api.renameTaxpayer.mockRejectedValue({
        code: "venue.detail_invalid",
        params: { field: "legalName", reason },
      });
      const panel = await mount(api);
      await open(panel);
      await type(panel, "Nuevo SL");
      await press(panel);
      expect(api.renameTaxpayer).toHaveBeenCalledWith({
        legalName: "Nuevo SL",
        expected: "Issuer SL",
      });
      expect(input(panel).error).toBe(t(key));
      expect(actions(panel).error).toBe(t("form.fix_fields"));
      expect(save(panel).disabled).toBe(false);
      expect(dialog(panel).open).toBe(true);
      await type(panel, "Nuevo SL 2");
      expect(input(panel).error).toBe("");
      expect(actions(panel).error).toBe("");
      cleanupWidgets();
    }
  });
}

it("a name changed in another session is the bottom message, and Save stays enabled", async () => {
  const api = stubApi();
  api.renameTaxpayer.mockRejectedValue({
    code: "venue.detail_changed",
    params: { field: "legalName" },
  });
  const panel = await mount(api);
  await open(panel);
  await type(panel, "Nuevo SL");
  await press(panel);
  expect(actions(panel).error).toBe(t("venue_details.legal_name_changed"));
  expect(input(panel).error).toBe("");
  expect(save(panel).disabled).toBe(false);
  expect(dialog(panel).open).toBe(true);
});

it("a successful rename closes the dialog, shows the new name and tells the page the identity changed", async () => {
  const api = stubApi();
  const panel = await mount(api);
  const told: Event[] = [];
  const listen = (event: Event) => told.push(event);
  document.body.addEventListener("venue-identity-changed", listen);
  onTestFinished(() => document.body.removeEventListener("venue-identity-changed", listen));
  await open(panel);
  await type(panel, "Nuevo SL");
  const closed = dialogClosed(dialog(panel));
  await press(panel);
  await closed;
  expect(dialog(panel).open).toBe(false);
  await panel.updateComplete;
  expect(panel.shadowRoot!.querySelector("[data-test=issuer]")!.textContent).toContain("Nuevo SL");
  expect(told).toHaveLength(1);
  expect(told[0]!.bubbles && told[0]!.composed).toBe(true);
});
